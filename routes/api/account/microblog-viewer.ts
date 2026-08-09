import { define } from "../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../lib/appview-client.ts";
import {
  getAppUser,
  getEffectiveAccountType,
  updateAppUserBskyClient,
} from "../../../lib/account-types.ts";
import { isProfileMicroblogViewerId } from "../../../lib/bsky-clients.ts";
import {
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../lib/security.ts";

const MAX_MICROBLOG_VIEWER_BODY_BYTES = 8_192;

export const handler = define.handlers({
  async POST(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("microblog viewer update", err),
    );
    if (proxied) return proxied;

    const large = rejectLargeRequest(ctx.req, MAX_MICROBLOG_VIEWER_BODY_BYTES);
    if (large) return large;

    const user = ctx.state.user;
    if (!user) return new Response("not authenticated", { status: 401 });

    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "user") {
      return new Response("user account required", { status: 403 });
    }

    let body: { bskyClientId?: unknown; visible?: unknown } | null;
    try {
      body = await readJsonRequestWithLimit(
        ctx.req,
        MAX_MICROBLOG_VIEWER_BODY_BYTES,
      ) as typeof body;
    } catch (error) {
      return new Response(
        error instanceof RequestBodyTooLargeError
          ? "request body too large"
          : "invalid request",
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      );
    }
    const clientId = typeof body?.bskyClientId === "string"
      ? body.bskyClientId
      : null;
    if (!isProfileMicroblogViewerId(clientId)) {
      return new Response("invalid microblog viewer", { status: 400 });
    }

    const appUser = await getAppUser(user.did).catch(() => null);
    if (!appUser) return new Response("account not found", { status: 404 });

    const visible = typeof body?.visible === "boolean"
      ? body.visible
      : appUser.bskyButtonVisible;
    await updateAppUserBskyClient(user.did, clientId, visible);

    return Response.json({
      ok: true,
      bskyClientId: clientId,
      visible,
    });
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response(
    "Updating the microblog viewer is temporarily unavailable.",
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    },
  );
}
