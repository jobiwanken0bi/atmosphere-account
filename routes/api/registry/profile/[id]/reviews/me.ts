/**
 * Signed-in caller actions for their own review on a profile.
 *
 *   DELETE /api/registry/profile/:id/reviews/me
 */
import { define } from "../../../../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../../../../lib/appview-client.ts";
import { withRateLimit } from "../../../../../../lib/rate-limit.ts";
import {
  getValidSession,
  grantedScopeForSession,
} from "../../../../../../lib/oauth.ts";
import {
  deleteReviewRecord,
  isPdsScopeMissingError,
} from "../../../../../../lib/pds.ts";
import {
  getProfileByDid,
  getProfileByHandle,
} from "../../../../../../lib/registry.ts";
import {
  deleteOwnReview,
  getOwnReview,
  getReviewSummary,
} from "../../../../../../lib/reviews.ts";
import { hasOAuthCapabilities } from "../../../../../../lib/oauth-scopes.ts";
import { oauthReauthorizationUrl } from "../../../../../../lib/oauth-action.ts";

export const handler = define.handlers({
  DELETE: withRateLimit(async (ctx) => {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewProxyError(err),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const target = await resolveTarget(ctx.params.id);
    if (!target) return jsonError(404, "not_found");

    const existing = await getOwnReview(target.did, user.did);
    if (existing?.reviewRkey) {
      const session = await getValidSession(user.did);
      if (
        !session ||
        !hasOAuthCapabilities(grantedScopeForSession(session), [
          "legacy_review",
        ])
      ) {
        return reauthorizationRequired(user.handle, target.handle);
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
          return reauthorizationRequired(user.handle, target.handle);
        }
        return jsonResponse(502, {
          error: "delete_record_failed",
          detail: deleted.message,
        });
      }
    }
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

function reauthorizationRequired(handle: string, target: string): Response {
  const next = `/apps/${encodeURIComponent(target)}?review=compose`;
  return jsonResponse(403, {
    error: "reauth_required",
    reauthUrl: oauthReauthorizationUrl({
      next,
      action: "legacy_review_manage",
      capabilities: ["legacy_review"],
      name: target,
    }),
    handle,
  });
}

function appviewProxyError(err: unknown): Response {
  console.warn("[api/registry/profile/reviews/me] appview proxy failed:", err);
  return jsonResponse(503, { error: "appview_unavailable" });
}
