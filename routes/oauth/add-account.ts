/**
 * "Add another account" entry point for the AccountMenu switcher and
 * for the user→project "sign in with your project's account" link in
 * the upgrade modal.
 *
 * Clears the active app session (so /explore/create renders its
 * sign-in form instead of bouncing back to /explore/manage) but
 * leaves both the OAuth refresh tokens and the remembered-accounts
 * cookie intact. After the new sign-in completes the callback will
 * append the new identity to the list and the user can switch back
 * and forth from the menu.
 *
 * Optionally accepts an `intent` query/form param (`user` | `project`)
 * which is forwarded to /explore/create so the next sign-in is
 * auto-classified.
 */
import { define } from "../../utils.ts";
import { clearSessionCookie, destroySession } from "../../lib/session.ts";

function readIntent(
  value: string | null | undefined,
): "user" | "project" | null {
  return value === "user" || value === "project" ? value : null;
}

async function handle(ctx: { req: Request; url: URL }): Promise<Response> {
  let intent = readIntent(ctx.url.searchParams.get("intent"));
  if (!intent && ctx.req.method === "POST") {
    const ct = (ctx.req.headers.get("content-type") ?? "").toLowerCase();
    if (
      ct.includes("application/x-www-form-urlencoded") ||
      ct.includes("multipart/form-data")
    ) {
      const form = await ctx.req.formData().catch(() => null);
      const raw = form?.get("intent");
      intent = readIntent(typeof raw === "string" ? raw : null);
    }
  }
  await destroySession(ctx.req).catch(() => {});
  return new Response(null, {
    status: 303,
    headers: {
      location: intent ? `/explore/create?intent=${intent}` : "/explore/create",
      "set-cookie": clearSessionCookie(),
    },
  });
}

export const handler = define.handlers({ GET: handle, POST: handle });
