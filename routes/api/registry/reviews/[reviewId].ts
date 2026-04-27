/**
 * Signed-in caller actions for one of their own reviews.
 *
 *   DELETE /api/registry/reviews/:reviewId
 */
import { define } from "../../../../utils.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";
import { loadSession } from "../../../../lib/oauth.ts";
import { deleteReviewRecord } from "../../../../lib/pds.ts";
import { deleteOwnReviewById, getReviewById } from "../../../../lib/reviews.ts";

export const handler = define.handlers({
  DELETE: withRateLimit(async (ctx) => {
    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const reviewId = Number(ctx.params.reviewId);
    if (!Number.isFinite(reviewId) || reviewId <= 0) {
      return jsonError(400, "invalid_review_id");
    }

    const existing = await getReviewById(reviewId);
    if (existing && existing.reviewerDid !== user.did) {
      return jsonError(404, "not_found");
    }
    if (existing?.reviewRkey) {
      const session = await loadSession(user.did);
      if (!session) return jsonError(401, "oauth_session_expired");
      const deleted = await deleteReviewRecord(
        user.did,
        session.pdsUrl,
        existing.reviewRkey,
      ).then(() => null).catch((err) =>
        err instanceof Error ? err : new Error(String(err))
      );
      if (deleted) {
        return jsonResponse(502, {
          error: "delete_record_failed",
          detail: deleted.message,
        });
      }
    }
    const removed = await deleteOwnReviewById(reviewId, user.did);
    return jsonResponse(200, { ok: true, removed });
  }),
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}
