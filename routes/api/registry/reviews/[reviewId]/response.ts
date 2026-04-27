/**
 * Profile-owner response to a review.
 *
 *   PUT    /api/registry/reviews/:reviewId/response { body }
 *   DELETE /api/registry/reviews/:reviewId/response
 */
import { define } from "../../../../../utils.ts";
import { withRateLimit } from "../../../../../lib/rate-limit.ts";
import { getProfileByDid } from "../../../../../lib/registry.ts";
import {
  deleteReviewResponse,
  getReviewById,
  normalizeReviewResponseBody,
  upsertReviewResponse,
} from "../../../../../lib/reviews.ts";

interface ResponsePayload {
  body?: unknown;
}

export const handler = define.handlers({
  PUT: withRateLimit(async (ctx) => {
    const gate = await ownerGate(ctx.params.reviewId, ctx.state.user?.did);
    if (!gate.ok) return gate.response;

    const body = await ctx.req.json().catch(() => null) as
      | ResponsePayload
      | null;
    const responseBody = normalizeReviewResponseBody(body?.body);
    if (!responseBody) return jsonError(400, "invalid_body");

    await upsertReviewResponse({
      reviewId: gate.review.id,
      responderDid: gate.did,
      body: responseBody,
    });
    const review = await getReviewById(gate.review.id);
    return jsonResponse(200, { ok: true, review });
  }),

  DELETE: withRateLimit(async (ctx) => {
    const gate = await ownerGate(ctx.params.reviewId, ctx.state.user?.did);
    if (!gate.ok) return gate.response;

    const deleted = await deleteReviewResponse(gate.review.id, gate.did);
    const review = await getReviewById(gate.review.id);
    return jsonResponse(200, { ok: true, deleted, review });
  }),
});

async function ownerGate(
  rawReviewId: string | undefined,
  did: string | undefined,
): Promise<
  | {
    ok: true;
    did: string;
    review: NonNullable<Awaited<ReturnType<typeof getReviewById>>>;
  }
  | { ok: false; response: Response }
> {
  if (!did) return { ok: false, response: jsonError(401, "not_authenticated") };
  const reviewId = Number(rawReviewId);
  if (!Number.isFinite(reviewId) || reviewId <= 0) {
    return { ok: false, response: jsonError(400, "invalid_review_id") };
  }
  const review = await getReviewById(reviewId);
  if (!review || review.status !== "visible") {
    return { ok: false, response: jsonError(404, "not_found") };
  }
  const profile = await getProfileByDid(review.targetDid).catch(() => null);
  if (!profile || profile.did !== did) {
    return { ok: false, response: jsonError(403, "forbidden") };
  }
  return { ok: true, did, review };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}
