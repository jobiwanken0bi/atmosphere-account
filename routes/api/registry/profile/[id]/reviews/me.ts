/**
 * Signed-in caller actions for their own review on a profile.
 *
 *   DELETE /api/registry/profile/:id/reviews/me
 */
import { define } from "../../../../../../utils.ts";
import { withRateLimit } from "../../../../../../lib/rate-limit.ts";
import {
  getProfileByDid,
  getProfileByHandle,
} from "../../../../../../lib/registry.ts";
import {
  deleteOwnReview,
  getReviewSummary,
} from "../../../../../../lib/reviews.ts";

export const handler = define.handlers({
  DELETE: withRateLimit(async (ctx) => {
    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const target = await resolveTarget(ctx.params.id);
    if (!target) return jsonError(404, "not_found");

    const removed = await deleteOwnReview(target.did, user.did);
    const summary = await getReviewSummary(target.did);
    return jsonResponse(200, { ok: true, removed, summary });
  }),
});

async function resolveTarget(id: string | undefined) {
  const raw = decodeURIComponent(id ?? "").trim();
  if (!raw) return null;
  return raw.startsWith("did:")
    ? await getProfileByDid(raw).catch(() => null)
    : await getProfileByHandle(raw.toLowerCase()).catch(() => null);
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
