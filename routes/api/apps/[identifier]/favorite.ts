import { define } from "../../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../../lib/appview-client.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";
import {
  deleteAppFavorite,
  getAppListingByIdentifier,
  getOwnAppFavorite,
  upsertAppFavorite,
} from "../../../../lib/app-directory.ts";
import {
  type AppFavoriteDraft,
  ATSTORE_FAVORITE_NSID,
  parseAtstoreFavorite,
} from "../../../../lib/app-lexicons.ts";
import {
  getValidSession,
  grantedScopeForSession,
} from "../../../../lib/oauth.ts";
import {
  createRecord,
  deleteRecord,
  getRecordPublic,
  isPdsScopeMissingError,
} from "../../../../lib/pds.ts";
import { hasOAuthCapabilities } from "../../../../lib/oauth-scopes.ts";
import { oauthReauthorizationUrl } from "../../../../lib/oauth-action.ts";
import {
  type FavoriteResumeIntent,
  favoriteResumeReturnPath,
} from "../../../../lib/favorite-resume.ts";

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
    if (!session) {
      return reauthorizationRequired(user.handle, app.slug, "save");
    }

    const now = Date.now();
    // Mirror ATStore's deterministic one-record-per-listing toggle. If an
    // ATStore-created favorite is already indexed above, its original rkey is
    // preserved instead.
    const rkey = app.id;
    const remote = await readRemoteFavorite(
      session.pdsUrl,
      user.did,
      rkey,
      app.atstoreListingUri,
    );
    if (remote === "conflict") {
      return jsonError(409, "favorite_record_conflict");
    }
    if (remote) return await indexFavorite(remote);

    if (
      !hasOAuthCapabilities(grantedScopeForSession(session), ["favorite"])
    ) {
      return reauthorizationRequired(user.handle, app.slug, "save");
    }

    const record = {
      subject: app.atstoreListingUri,
      createdAt: new Date(now).toISOString(),
    };
    const result = await createRecord(
      user.did,
      session.pdsUrl,
      ATSTORE_FAVORITE_NSID,
      record,
      rkey,
    ).catch((err) => err instanceof Error ? err : new Error(String(err)));
    if (result instanceof Error) {
      if (isPdsScopeMissingError(result)) {
        return reauthorizationRequired(user.handle, app.slug, "save");
      }
      const recovered = await readRemoteFavorite(
        session.pdsUrl,
        user.did,
        rkey,
        app.atstoreListingUri,
      );
      if (recovered === "conflict") {
        return jsonError(409, "favorite_record_conflict");
      }
      if (recovered) return await indexFavorite(recovered);
      return jsonResponse(502, {
        error: "create_record_failed",
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
    if (
      !session ||
      !hasOAuthCapabilities(grantedScopeForSession(session), ["favorite"])
    ) {
      return reauthorizationRequired(user.handle, app.slug, "remove");
    }

    const deleted = await deleteRecord(
      user.did,
      session.pdsUrl,
      ATSTORE_FAVORITE_NSID,
      existing.rkey,
    ).then(() => null).catch((err) =>
      err instanceof Error ? err : new Error(String(err))
    );
    if (deleted) {
      if (isPdsScopeMissingError(deleted)) {
        return reauthorizationRequired(user.handle, app.slug, "remove");
      }
      return jsonResponse(502, {
        error: "delete_record_failed",
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

async function readRemoteFavorite(
  pdsUrl: string,
  did: string,
  rkey: string,
  subject: string,
): Promise<AppFavoriteDraft | "conflict" | null> {
  const record = await getRecordPublic(
    pdsUrl,
    did,
    ATSTORE_FAVORITE_NSID,
    rkey,
  ).catch(() => null);
  if (!record) return null;
  const favorite = parseAtstoreFavorite({
    ...record,
    repoDid: did,
    rkey,
  });
  return favorite?.subject === subject ? favorite : "conflict";
}

async function indexFavorite(favorite: AppFavoriteDraft): Promise<Response> {
  await upsertAppFavorite(favorite);
  return jsonResponse(200, {
    ok: true,
    uri: favorite.uri,
    cid: favorite.cid,
  });
}

function reauthorizationRequired(
  handle: string,
  identifier: string,
  intent: FavoriteResumeIntent,
): Response {
  const next = favoriteResumeReturnPath(identifier, intent);
  return jsonResponse(403, {
    error: "reauth_required",
    reauthUrl: oauthReauthorizationUrl({
      next,
      action: "favorite",
      capabilities: ["favorite"],
      name: identifier,
    }),
    handle,
  });
}

function appviewProxyError(err: unknown): Response {
  console.warn("[api/apps/favorite] appview proxy failed:", err);
  return jsonResponse(503, { error: "appview_unavailable" });
}
