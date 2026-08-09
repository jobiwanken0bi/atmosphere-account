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
import { ATSTORE_REVIEW_NSID } from "../../../../lib/app-lexicons.ts";
import { ensureAtstoreReviewerProfile } from "../../../../lib/atstore-profile.ts";
import {
  getValidSession,
  grantedScopeForSession,
} from "../../../../lib/oauth.ts";
import { isPdsScopeMissingError, putRecord } from "../../../../lib/pds.ts";
import { createAtprotoTid } from "../../../../lib/tid.ts";
import {
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../../lib/security.ts";
import { hasOAuthCapabilities } from "../../../../lib/oauth-scopes.ts";
import { oauthReauthorizationUrl } from "../../../../lib/oauth-action.ts";

interface ReviewPayload {
  rating?: unknown;
  body?: unknown;
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
      if (error instanceof RequestBodyTooLargeError) {
        return new Response("request body too large", { status: 413 });
      }
      body = null;
    }
    if (!body) return jsonError(400, "invalid_body");

    const rating = parseRating(body.rating);
    if (!rating) return jsonError(400, "invalid_rating");
    const text = normalizeReviewText(body.body);
    if (text == null) return jsonError(400, "body_too_long");

    const existing = await getOwnAppReview(app.id, user.did).catch(() => null);
    const capability = existing ? "review_manage" as const : "review" as const;
    const session = await getValidSession(user.did);
    if (!session) {
      return reauthorizationRequired(user.handle, app.slug, capability);
    }
    if (!hasOAuthCapabilities(grantedScopeForSession(session), [capability])) {
      return reauthorizationRequired(user.handle, app.slug, capability);
    }

    if (!existing) {
      await ensureAtstoreReviewerProfile({
        did: user.did,
        handle: user.handle,
        pdsUrl: session.pdsUrl,
      }).catch((err) => {
        console.warn("[apps/reviews] could not ensure ATStore profile:", err);
      });
    }

    const now = Date.now();
    const rkey = existing?.rkey ?? createAtprotoTid();
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
          app.slug,
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

function reauthorizationRequired(
  handle: string,
  identifier: string,
  capability: "review" | "review_manage",
): Response {
  const next = `/apps/${encodeURIComponent(identifier)}?review=compose`;
  return jsonResponse(403, {
    error: "reauth_required",
    reauthUrl: oauthReauthorizationUrl({
      next,
      action: capability,
      capabilities: [capability],
      name: identifier,
    }),
    handle,
  });
}

function appviewProxyError(err: unknown): Response {
  console.warn("[api/apps/reviews] appview proxy failed:", err);
  return jsonResponse(503, { error: "appview_unavailable" });
}
