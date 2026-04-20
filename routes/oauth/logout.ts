/**
 * Clears the app session cookie and removes the session row. Does not
 * revoke the OAuth refresh token (kept so a fresh login is one-click).
 */
import { define } from "../../utils.ts";
import { clearSessionCookie, destroySession } from "../../lib/session.ts";

async function handle(ctx: { req: Request }): Promise<Response> {
  await destroySession(ctx.req);
  return new Response(null, {
    status: 303,
    headers: {
      location: "/explore",
      "set-cookie": clearSessionCookie(),
    },
  });
}

export const handler = define.handlers({ GET: handle, POST: handle });
