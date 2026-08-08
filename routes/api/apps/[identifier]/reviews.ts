import { define } from "../../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../../lib/appview-client.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";
import {
  type AppReviewSort,
  getAppListingByIdentifier,
  getOwnAppReview,
  listAppReviewsForListing,
  upsertAppReview,
} from "../../../../lib/app-directory.ts";
import { enrichAppMirroredReviews } from "../../../../lib/app-review-display.ts";
import {
  type AppReviewDraft,
  ATSTORE_REVIEW_NSID,
  parseAtstoreReview,
} from "../../../../lib/app-lexicons.ts";
import { ensureAtstoreReviewerProfile } from "../../../../lib/atstore-profile.ts";
import { appReviewRkeyForWrite } from "../../../../lib/app-review-write.ts";
import {
  getValidSession,
  grantedScopeForSession,
} from "../../../../lib/oauth.ts";
import {
  getRecordPublic,
  isPdsScopeMissingError,
  putRecord,
} from "../../../../lib/pds.ts";
import {
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../../lib/security.ts";
import { hasOAuthCapabilities } from "../../../../lib/oauth-scopes.ts";
import { appReviewReauthorizationUrl } from "../../../../lib/app-interaction-reauth.ts";

interface ReviewPayload {
  rating?: unknown;
  body?: unknown;
  rkey?: unknown;
}

const MAX_REVIEW_REQUEST_BYTES = 16_384;

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewProxyError(err),
    );
    if (proxied) return proxied;

    const app = await getAppListingByIdentifier(ctx.params.identifier, {
      syncLegacy: false,
    }).catch(() => null);
    if (!app || !app.atstoreListingUri) {
      return jsonError(404, "shared_app_record_not_found");
    }
    const sort = readReviewSort(ctx.url.searchParams.get("sort"));
    const reviews = await listAppReviewsForListing(app.id, {
      limit: 12,
      sort,
    });
    return jsonResponse(200, {
      reviews: await enrichAppMirroredReviews(reviews),
      sort,
    }, {
      "cache-control": "public, max-age=30, stale-while-revalidate=120",
    });
  },
  POST: withRateLimit(async (ctx) => {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewProxyError(err),
    );
    if (proxied) return proxied;

    const large = rejectLargeRequest(ctx.req, MAX_REVIEW_REQUEST_BYTES);
    if (large) return large;

    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const app = await getAppListingByIdentifier(ctx.params.identifier).catch(
      () => null,
    );
    if (!app || !app.atstoreListingUri) {
      return jsonError(404, "shared_app_record_not_found");
    }
    if (
      app.productDid === user.did || app.profileDid === user.did ||
      app.legacyProfileDid === user.did
    ) {
      return jsonError(400, "cannot_review_self");
    }

    let body: ReviewPayload | null;
    try {
      body = await readJsonRequestWithLimit(
        ctx.req,
        MAX_REVIEW_REQUEST_BYTES,
      ) as ReviewPayload | null;
    } catch (error) {
      return jsonError(
        error instanceof RequestBodyTooLargeError ? 413 : 400,
        error instanceof RequestBodyTooLargeError
          ? "request_body_too_large"
          : "invalid_body",
      );
    }
    if (!body) return jsonError(400, "invalid_body");

    const rating = parseRating(body.rating);
    if (!rating) return jsonError(400, "invalid_rating");
    const text = normalizeReviewText(body.body);
    if (text == null) return jsonError(400, "body_too_long");

    let existing = await getOwnAppReview(app.id, user.did).catch(() => null);
    const rkey = appReviewRkeyForWrite(existing?.rkey, body.rkey);
    if (!rkey) return jsonError(400, "invalid_review_rkey");

    const session = await getValidSession(user.did);
    if (!session) {
      return reauthorizationRequired(
        user.handle,
        app,
        existing ? "review_manage" : "review",
      );
    }

    if (!existing) {
      const remote = await readRemoteAppReview(
        session.pdsUrl,
        user.did,
        rkey,
        app.atstoreListingUri,
      ).catch(() => "unavailable" as const);
      if (remote === "unavailable") {
        return jsonError(502, "review_lookup_failed");
      }
      if (remote === "conflict") {
        return jsonError(409, "review_record_conflict");
      }
      if (remote) {
        await upsertAppReview(remote);
        if (remote.rating === rating && remote.body === text) {
          return jsonResponse(200, {
            ok: true,
            uri: remote.uri,
            cid: remote.cid,
          });
        }
        existing = {
          uri: remote.uri,
          rkey: remote.rkey,
          rating: remote.rating,
          body: remote.body,
          createdAt: remote.createdAt,
          updatedAt: remote.updatedAt,
        };
      }
    }

    const capability = existing ? "review_manage" as const : "review" as const;
    if (!hasOAuthCapabilities(grantedScopeForSession(session), [capability])) {
      return reauthorizationRequired(
        user.handle,
        app,
        capability,
      );
    }

    if (!existing) {
      await ensureAtstoreReviewerProfile({
        did: user.did,
        handle: user.handle,
        pdsUrl: session.pdsUrl,
      }).catch(() => {
        console.warn("[apps/reviews] could not ensure ATStore profile");
      });
    }

    const now = Date.now();
    const createdAt = existing?.createdAt
      ? new Date(existing.createdAt).toISOString()
      : new Date(now).toISOString();
    const record = {
      subject: app.atstoreListingUri,
      rating,
      ...(text ? { text } : {}),
      createdAt,
    };

    const result = await putRecord(
      user.did,
      session.pdsUrl,
      ATSTORE_REVIEW_NSID,
      rkey,
      record,
    ).catch((err) => err instanceof Error ? err : new Error(String(err)));
    if (result instanceof Error) {
      if (isPdsScopeMissingError(result)) {
        return reauthorizationRequired(
          user.handle,
          app,
          capability,
        );
      }
      return jsonResponse(502, {
        error: "put_record_failed",
        detail: result.message,
      });
    }

    const uri = result.uri ||
      `at://${user.did}/${ATSTORE_REVIEW_NSID}/${rkey}`;
    await upsertAppReview({
      sourceType: "atstore_review",
      uri,
      cid: result.cid,
      repoDid: user.did,
      rkey,
      subject: app.atstoreListingUri,
      rating,
      body: text,
      createdAt: Date.parse(createdAt) || now,
      updatedAt: now,
    });
    return jsonResponse(200, { ok: true, uri, cid: result.cid });
  }),
});

function parseRating(value: unknown): 1 | 2 | 3 | 4 | 5 | null {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5
    ? value
    : null;
}

function normalizeReviewText(value: unknown): string | null {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text.length <= 8000 ? text : null;
}

function readReviewSort(value: string | null): AppReviewSort {
  return value === "highest" || value === "lowest" ? value : "newest";
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

async function readRemoteAppReview(
  pdsUrl: string,
  did: string,
  rkey: string,
  subject: string,
): Promise<AppReviewDraft | "conflict" | null> {
  const record = await getRecordPublic(
    pdsUrl,
    did,
    ATSTORE_REVIEW_NSID,
    rkey,
  );
  if (!record) return null;
  const review = parseAtstoreReview({
    ...record,
    repoDid: did,
    rkey,
  });
  return review?.subject === subject ? review : "conflict";
}

function reauthorizationRequired(
  handle: string,
  app: { slug: string; name: string },
  capability: "review" | "review_manage",
): Response {
  return jsonResponse(403, {
    error: "reauth_required",
    reauthUrl: appReviewReauthorizationUrl(
      app.slug,
      app.name,
      capability,
    ),
    handle,
  });
}

function appviewProxyError(err: unknown): Response {
  console.warn("[api/apps/reviews] appview proxy failed:", err);
  return jsonResponse(503, { error: "appview_unavailable" });
}
