/**
 * Public list + signed-in create/update for reviews on a registry profile.
 *
 *   GET  /api/registry/profile/:id/reviews
 *   POST /api/registry/profile/:id/reviews { rating, body? }
 */
import { define } from "../../../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../../../lib/appview-client.ts";
import { withRateLimit } from "../../../../../lib/rate-limit.ts";
import {
  getValidSession,
  grantedScopeForSession,
} from "../../../../../lib/oauth.ts";
import {
  isPdsScopeMissingError,
  putReviewRecord,
} from "../../../../../lib/pds.ts";
import {
  getProfileByDid,
  getProfileByHandle,
} from "../../../../../lib/registry.ts";
import {
  createOrUpdateReview,
  getOwnReview,
  getReviewSummary,
  listVisibleReviews,
  normalizeReviewBody,
  reviewRkeyForTarget,
  reviewUriForRkey,
  validateReviewRating,
} from "../../../../../lib/reviews.ts";
import {
  type ReviewRecord,
  validateReview,
} from "../../../../../lib/lexicons.ts";
import {
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../../../lib/security.ts";
import { hasOAuthCapabilities } from "../../../../../lib/oauth-scopes.ts";
import { oauthReauthorizationUrl } from "../../../../../lib/oauth-action.ts";

interface ReviewPayload {
  rating?: unknown;
  body?: unknown;
}

const MAX_REVIEW_REQUEST_BYTES = 16_384;

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewProxyError(err),
    );
    if (proxied) return proxied;

    const target = await resolveTarget(ctx.params.id);
    if (!target) return jsonError(404, "not_found");

    const url = new URL(ctx.req.url);
    const cursorRaw = url.searchParams.get("cursor");
    const cursor = cursorRaw ? Number(cursorRaw) : undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const [summary, reviews, ownReview] = await Promise.all([
      getReviewSummary(target.did),
      listVisibleReviews(target.did, { cursor, limit }),
      ctx.state.user
        ? getOwnReview(target.did, ctx.state.user.did).catch(() => null)
        : Promise.resolve(null),
    ]);

    return jsonResponse(200, {
      summary,
      reviews,
      ownReview: ownReview?.status === "visible" ? ownReview : null,
    }, {
      "cache-control": ctx.state.user
        ? "private, max-age=0"
        : "public, max-age=30, s-maxage=120",
    });
  }),

  POST: withRateLimit(async (ctx) => {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewProxyError(err),
    );
    if (proxied) return proxied;

    const large = rejectLargeRequest(ctx.req, MAX_REVIEW_REQUEST_BYTES);
    if (large) return large;

    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const target = await resolveTarget(ctx.params.id);
    if (!target) return jsonError(404, "not_found");
    if (target.did === user.did) return jsonError(400, "cannot_review_self");
    if (target.profileType !== "project") return jsonError(400, "not_project");

    const existing = await getOwnReview(target.did, user.did).catch(() => null);
    const oauthAction = existing
      ? "legacy_review_manage" as const
      : "legacy_review" as const;
    const session = await getValidSession(user.did);
    if (
      !session ||
      !hasOAuthCapabilities(grantedScopeForSession(session), [
        "legacy_review",
      ])
    ) {
      return reauthorizationRequired(
        user.handle,
        target.handle,
        oauthAction,
      );
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

    const rating = validateReviewRating(body.rating);
    if (!rating) return jsonError(400, "invalid_rating");

    const reviewBody = normalizeReviewBody(body.body);
    if (reviewBody == null) return jsonError(400, "body_too_long");

    const now = new Date();
    const rkey = existing?.reviewRkey ?? await reviewRkeyForTarget(target.did);
    const createdAt = existing
      ? new Date(existing.createdAt).toISOString()
      : now.toISOString();
    const record: ReviewRecord = {
      subject: target.did,
      subjectUri:
        `at://${target.did}/com.atmosphereaccount.registry.profile/self`,
      rating,
      body: reviewBody || undefined,
      createdAt,
      updatedAt: now.toISOString(),
    };
    const validation = validateReview(record);
    if (!validation.ok || !validation.value) {
      return jsonError(400, "invalid_review_record");
    }

    const result = await putReviewRecord(
      user.did,
      session.pdsUrl,
      rkey,
      validation.value,
    ).catch((err) => err instanceof Error ? err : new Error(String(err)));
    if (result instanceof Error) {
      if (isPdsScopeMissingError(result)) {
        return reauthorizationRequired(
          user.handle,
          target.handle,
          oauthAction,
        );
      }
      return jsonResponse(502, {
        error: "put_record_failed",
        detail: result.message,
      });
    }

    const review = await createOrUpdateReview({
      targetDid: target.did,
      reviewerDid: user.did,
      reviewUri: reviewUriForRkey(user.did, rkey),
      reviewCid: result.cid,
      reviewRkey: rkey,
      rating,
      body: reviewBody,
      createdAt: Date.parse(validation.value.createdAt) || Date.now(),
      updatedAt:
        Date.parse(validation.value.updatedAt ?? validation.value.createdAt) ||
        Date.now(),
    });
    const summary = await getReviewSummary(target.did);
    return jsonResponse(200, { ok: true, review, summary });
  }),
});

async function resolveTarget(id: string | undefined) {
  const raw = decodeURIComponent(id ?? "").trim();
  if (!raw) return null;
  return raw.startsWith("did:")
    ? await getProfileByDid(raw).catch(() => null)
    : await getProfileByHandle(raw.toLowerCase()).catch(() => null);
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

function reauthorizationRequired(
  handle: string,
  target: string,
  action: "legacy_review" | "legacy_review_manage",
): Response {
  const next = `/apps/${encodeURIComponent(target)}?review=compose`;
  return jsonResponse(403, {
    error: "reauth_required",
    reauthUrl: oauthReauthorizationUrl({
      next,
      action,
      capabilities: ["legacy_review"],
      name: target,
    }),
    handle,
  });
}

function appviewProxyError(err: unknown): Response {
  console.warn("[api/registry/profile/reviews] appview proxy failed:", err);
  return jsonResponse(503, { error: "appview_unavailable" });
}
