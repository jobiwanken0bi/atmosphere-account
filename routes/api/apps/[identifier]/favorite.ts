import { define } from "../../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../../lib/appview-client.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";
import {
  deleteAppFavorite,
  getAppListingByIdentifier,
  getOwnAppFavorite,
  upsertAppFavorite,
} from "../../../../lib/app-directory.ts";
import { ATSTORE_FAVORITE_NSID } from "../../../../lib/app-lexicons.ts";
import { getValidSession } from "../../../../lib/oauth.ts";
import { deleteRecord, putRecord } from "../../../../lib/pds.ts";
import { createAtprotoTid } from "../../../../lib/tid.ts";

export const handler = define.handlers({
  POST: withRateLimit(async (ctx) => {
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
    if (
      app.productDid === user.did || app.profileDid === user.did ||
      app.legacyProfileDid === user.did
    ) {
      return jsonError(400, "cannot_favorite_self");
    }

    const existing = await getOwnAppFavorite(app.id, user.did);
    if (existing) return jsonResponse(200, { ok: true, uri: existing.uri });

    const session = await getValidSession(user.did);
    if (!session) return jsonError(401, "oauth_session_expired");

    const now = Date.now();
    const rkey = createAtprotoTid();
    const record = {
      subject: app.atstoreListingUri,
      createdAt: new Date(now).toISOString(),
    };
    const result = await putRecord(
      user.did,
      session.pdsUrl,
      ATSTORE_FAVORITE_NSID,
      rkey,
      record,
    ).catch((err) => err instanceof Error ? err : new Error(String(err)));
    if (result instanceof Error) {
      return jsonResponse(502, {
        error: "put_record_failed",
        detail: result.message,
      });
    }
    const uri = result.uri ||
      `at://${user.did}/${ATSTORE_FAVORITE_NSID}/${rkey}`;
    await upsertAppFavorite({
      sourceType: "atstore_favorite",
      uri,
      cid: result.cid,
      repoDid: user.did,
      rkey,
      subject: app.atstoreListingUri,
      createdAt: now,
    });
    return jsonResponse(200, { ok: true, uri, cid: result.cid });
  }),

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
    const existing = await getOwnAppFavorite(app.id, user.did);
    if (!existing) return jsonResponse(200, { ok: true, removed: false });

    const session = await getValidSession(user.did);
    if (!session) return jsonError(401, "oauth_session_expired");

    const deleted = await deleteRecord(
      user.did,
      session.pdsUrl,
      ATSTORE_FAVORITE_NSID,
      existing.rkey,
    ).then(() => null).catch((err) =>
      err instanceof Error ? err : new Error(String(err))
    );
    if (deleted) {
      return jsonResponse(502, {
        error: "delete_record_failed",
        detail: deleted.message,
      });
    }
    await deleteAppFavorite(existing.uri);
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

function appviewProxyError(err: unknown): Response {
  console.warn("[api/apps/favorite] appview proxy failed:", err);
  return jsonResponse(503, { error: "appview_unavailable" });
}
