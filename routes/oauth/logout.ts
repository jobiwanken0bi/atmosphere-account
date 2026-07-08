/**
 * Clears the app session cookie and removes the session row. Does not
 * revoke the OAuth refresh token (kept so a fresh login is one-click).
 */
import { define } from "../../utils.ts";
import { proxyAppviewApiResponse } from "../../lib/appview-client.ts";
import { clearSessionCookie, destroySession } from "../../lib/session.ts";

async function handle(ctx: { req: Request; url: URL }): Promise<Response> {
  const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
    (err) => appviewUnavailable("oauth logout", err),
  );
  if (proxied) return proxied;

  await destroySession(ctx.req);
  return new Response(null, {
    status: 303,
    headers: {
      location: "/apps",
      "set-cookie": clearSessionCookie(),
    },
  });
}

export const handler = define.handlers({
  POST: handle,
  GET: () =>
    new Response("method not allowed", {
      status: 405,
      headers: { allow: "POST" },
    }),
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Signing out is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
