import { define } from "../../../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../../../lib/appview-client.ts";
import { withRateLimit } from "../../../../../lib/rate-limit.ts";
import {
  deleteAppReview,
  getAppListingByIdentifier,
  getOwnAppReview,
} from "../../../../../lib/app-directory.ts";
import { ATSTORE_REVIEW_NSID } from "../../../../../lib/app-lexicons.ts";
import {
  getValidSession,
  grantedScopeForSession,
} from "../../../../../lib/oauth.ts";
import {
  deleteRecord,
  isPdsScopeMissingError,
} from "../../../../../lib/pds.ts";
import { hasOAuthCapabilities } from "../../../../../lib/oauth-scopes.ts";
import { oauthReauthorizationUrl } from "../../../../../lib/oauth-action.ts";

export const handler = define.handlers({
  DELETE: withRateLimit(async (ctx) => {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewProxyError(err),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const app = await getAppListingByIdentifier(ctx.params.identifier).catch(
      () => null,
    );
    if (!app || !app.atstoreListingUri) {
      return jsonError(404, "shared_app_record_not_found");
    }
    const existing = await getOwnAppReview(app.id, user.did);
    if (!existing) return jsonResponse(200, { ok: true, removed: false });

    const session = await getValidSession(user.did);
    if (
      !session ||
      !hasOAuthCapabilities(grantedScopeForSession(session), [
        "review_manage",
      ])
    ) {
      return reauthorizationRequired(user.handle, app.slug);
    }

    const deleted = await deleteRecord(
      user.did,
      session.pdsUrl,
      ATSTORE_REVIEW_NSID,
      existing.rkey,
    ).then(() => null).catch((err) =>
      err instanceof Error ? err : new Error(String(err))
    );
    if (deleted) {
      if (isPdsScopeMissingError(deleted)) {
        return reauthorizationRequired(user.handle, app.slug);
      }
      return jsonResponse(502, {
        error: "delete_record_failed",
        detail: deleted.message,
      });
    }
    await deleteAppReview(existing.uri);
    return jsonResponse(200, { ok: true, removed: true });
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

function reauthorizationRequired(handle: string, identifier: string): Response {
  const next = `/apps/${encodeURIComponent(identifier)}?review=compose`;
  return jsonResponse(403, {
    error: "reauth_required",
    reauthUrl: oauthReauthorizationUrl({
      next,
      action: "review_manage",
      capabilities: ["review_manage"],
      name: identifier,
    }),
    handle,
  });
}

function appviewProxyError(err: unknown): Response {
  console.warn("[api/apps/reviews/me] appview proxy failed:", err);
  return jsonResponse(503, { error: "appview_unavailable" });
}
