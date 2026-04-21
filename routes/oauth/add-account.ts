/**
 * "Add another account" entry point for the AccountMenu switcher.
 *
 * Clears the active app session (so /explore/create renders its
 * sign-in form instead of bouncing back to /explore/manage) but
 * leaves both the OAuth refresh tokens and the remembered-accounts
 * cookie intact. After the new sign-in completes the callback will
 * append the new identity to the list and the user can switch back
 * and forth from the menu.
 */
import { define } from "../../utils.ts";
import { clearSessionCookie, destroySession } from "../../lib/session.ts";

async function handle(ctx: { req: Request }): Promise<Response> {
  await destroySession(ctx.req).catch(() => {});
  return new Response(null, {
    status: 303,
    headers: {
      location: "/explore/create",
      "set-cookie": clearSessionCookie(),
    },
  });
}

export const handler = define.handlers({ GET: handle, POST: handle });
