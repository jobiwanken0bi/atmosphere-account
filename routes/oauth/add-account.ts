/**
 * "Add another account" entry point for the AccountMenu switcher and
 * for the user→project "sign in with your project's account" link in
 * the upgrade modal.
 *
 * Clears the active app session (so /signin renders its sign-in form instead
 * of bouncing back to /account) but
 * leaves both the OAuth refresh tokens and the remembered-accounts
 * cookie intact. After the new sign-in completes the callback will
 * append the new identity to the list and the user can switch back
 * and forth from the menu.
 *
 * Optionally accepts an `intent` query/form param (`user` | `project`)
 * which is forwarded to /apps/create so the next sign-in is
 * auto-classified. Generic account-switch flows can also pass a safe
 * relative `next` path, which is forwarded to /signin.
 */
import { define } from "../../utils.ts";
import { clearSessionCookie, destroySession } from "../../lib/session.ts";
import { isSafeRelativePath, rejectLargeRequest } from "../../lib/security.ts";

const MAX_ADD_ACCOUNT_BODY_BYTES = 8_192;

function readIntent(
  value: string | null | undefined,
): "user" | "project" | null {
  return value === "user" || value === "project" ? value : null;
}

function safeNext(raw: string | null | undefined): string | null {
  return raw && isSafeRelativePath(raw) ? raw : null;
}

async function handle(ctx: { req: Request; url: URL }): Promise<Response> {
  if (ctx.req.method !== "GET") {
    const large = rejectLargeRequest(ctx.req, MAX_ADD_ACCOUNT_BODY_BYTES);
    if (large) return large;
  }
  let intent = readIntent(ctx.url.searchParams.get("intent"));
  let next = safeNext(ctx.url.searchParams.get("next"));
  if (!intent && ctx.req.method === "POST") {
    const ct = (ctx.req.headers.get("content-type") ?? "").toLowerCase();
    if (
      ct.includes("application/x-www-form-urlencoded") ||
      ct.includes("multipart/form-data")
    ) {
      const form = await ctx.req.formData().catch(() => null);
      const raw = form?.get("intent");
      intent = readIntent(typeof raw === "string" ? raw : null);
      const rawNext = form?.get("next");
      next = safeNext(typeof rawNext === "string" ? rawNext : null) ?? next;
    }
  }
  const signin = next ? `/signin?next=${encodeURIComponent(next)}` : "/signin";
  await destroySession(ctx.req).catch(() => {});
  return new Response(null, {
    status: 303,
    headers: {
      location: intent === "project" ? "/apps/create?intent=project" : signin,
      "set-cookie": clearSessionCookie(),
    },
  });
}

export const handler = define.handlers({ GET: handle, POST: handle });
