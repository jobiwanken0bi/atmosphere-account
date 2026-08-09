/**
 * Signed-in caller actions for one of their own reviews.
 *
 *   DELETE /api/registry/reviews/:reviewId
 */
import { define } from "../../../../utils.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";
import {
  getValidSession,
  grantedScopeForSession,
} from "../../../../lib/oauth.ts";
import {
  deleteReviewRecord,
  isPdsScopeMissingError,
} from "../../../../lib/pds.ts";
import { deleteOwnReviewById, getReviewById } from "../../../../lib/reviews.ts";
import { hasOAuthCapabilities } from "../../../../lib/oauth-scopes.ts";
import { oauthReauthorizationUrl } from "../../../../lib/oauth-action.ts";
import { getProfileByDid } from "../../../../lib/registry.ts";

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
      const session = await getValidSession(user.did);
      if (
        !session ||
        !hasOAuthCapabilities(grantedScopeForSession(session), [
          "legacy_review",
        ])
      ) {
        return await reauthorizationRequired(user.handle, existing.targetDid);
      }
      const deleted = await deleteReviewRecord(
        user.did,
        session.pdsUrl,
        existing.reviewRkey,
      ).then(() => null).catch((err) =>
        err instanceof Error ? err : new Error(String(err))
      );
      if (deleted) {
        if (isPdsScopeMissingError(deleted)) {
          return await reauthorizationRequired(
            user.handle,
            existing.targetDid,
          );
        }
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

async function reauthorizationRequired(
  handle: string,
  targetDid: string,
): Promise<Response> {
  const target = await getProfileByDid(targetDid, {
    includeTakenDown: true,
  }).catch(() => null);
  return jsonResponse(403, {
    error: "reauth_required",
    reauthUrl: oauthReauthorizationUrl({
      next: "/account/reviews",
      action: "legacy_review_manage",
      capabilities: ["legacy_review"],
      name: target?.name ?? target?.handle,
    }),
    handle,
  });
}
