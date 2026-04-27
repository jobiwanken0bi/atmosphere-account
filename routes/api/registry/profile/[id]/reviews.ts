/**
 * Public list + signed-in create/update for reviews on a registry profile.
 *
 *   GET  /api/registry/profile/:id/reviews
 *   POST /api/registry/profile/:id/reviews { rating, body? }
 */
import { define } from "../../../../../utils.ts";
import { withRateLimit } from "../../../../../lib/rate-limit.ts";
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
  validateReviewRating,
} from "../../../../../lib/reviews.ts";

interface ReviewPayload {
  rating?: unknown;
  body?: unknown;
}

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
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
    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const target = await resolveTarget(ctx.params.id);
    if (!target) return jsonError(404, "not_found");
    if (target.did === user.did) return jsonError(400, "cannot_review_self");

    const body = await ctx.req.json().catch(() => null) as
      | ReviewPayload
      | null;
    if (!body) return jsonError(400, "invalid_body");

    const rating = validateReviewRating(body.rating);
    if (!rating) return jsonError(400, "invalid_rating");

    const reviewBody = normalizeReviewBody(body.body);
    if (reviewBody == null) return jsonError(400, "body_too_long");

    const review = await createOrUpdateReview({
      targetDid: target.did,
      reviewerDid: user.did,
      rating,
      body: reviewBody,
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
