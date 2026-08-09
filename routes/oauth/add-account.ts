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
import { proxyAppviewApiResponse } from "../../lib/appview-client.ts";
import { clearSessionCookie, destroySession } from "../../lib/session.ts";
import { isSafeRelativePath, rejectLargeRequest } from "../../lib/security.ts";
import {
  normalizeOAuthCapabilities,
  type OAuthCapability,
} from "../../lib/oauth-scopes.ts";
import {
  isOAuthAction,
  isOAuthActionCapabilityRequest,
  type OAuthAction,
  safeOAuthTargetName,
} from "../../lib/oauth-action.ts";

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
  const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
    (err) => appviewUnavailable("oauth add account", err),
  );
  if (proxied) return proxied;

  if (ctx.req.method !== "GET") {
    const large = rejectLargeRequest(ctx.req, MAX_ADD_ACCOUNT_BODY_BYTES);
    if (large) return large;
  }
  let intent = readIntent(ctx.url.searchParams.get("intent"));
  let next = safeNext(ctx.url.searchParams.get("next"));
  let capabilities: OAuthCapability[] | null = normalizeOAuthCapabilities(
    ctx.url.searchParams.getAll("capability"),
  );
  const rawQueryAction = ctx.url.searchParams.get("action");
  let action: OAuthAction | null = isOAuthAction(rawQueryAction)
    ? rawQueryAction
    : null;
  let targetName = safeOAuthTargetName(ctx.url.searchParams.get("name")) ??
    null;
  if (ctx.req.method === "POST") {
    const ct = (ctx.req.headers.get("content-type") ?? "").toLowerCase();
    if (
      ct.includes("application/x-www-form-urlencoded") ||
      ct.includes("multipart/form-data")
    ) {
      const form = await ctx.req.formData().catch(() => null);
      const raw = form?.get("intent");
      intent = readIntent(typeof raw === "string" ? raw : null) ?? intent;
      const rawNext = form?.get("next");
      next = safeNext(typeof rawNext === "string" ? rawNext : null) ?? next;
      const formCapabilities = form?.getAll("capability") ?? [];
      if (formCapabilities.length > 0) {
        capabilities = normalizeOAuthCapabilities(formCapabilities);
      }
      const rawAction = form?.get("action");
      if (isOAuthAction(rawAction)) action = rawAction;
      targetName = safeOAuthTargetName(form?.get("name")) ?? targetName;
    }
  }
  if (!capabilities) {
    return new Response("invalid capability", { status: 400 });
  }
  if (!isOAuthActionCapabilityRequest(action, capabilities)) {
    return new Response("invalid action capability combination", {
      status: 400,
    });
  }
  const signinParams = new URLSearchParams();
  if (next) signinParams.set("next", next);
  if (action) signinParams.set("action", action);
  if (targetName) signinParams.set("name", targetName);
  for (const capability of capabilities) {
    signinParams.append("capability", capability);
  }
  const signinQuery = signinParams.toString();
  const signin = `/signin${signinQuery ? `?${signinQuery}` : ""}`;
  const appParams = new URLSearchParams({ intent: "project" });
  if (next) appParams.set("next", next);
  if (action) appParams.set("action", action);
  if (targetName) appParams.set("name", targetName);
  for (const capability of capabilities) {
    appParams.append("capability", capability);
  }
  await destroySession(ctx.req).catch(() => {});
  const headers = new Headers({
    location: intent === "project"
      ? `/apps/create?${appParams.toString()}`
      : signin,
  });
  headers.append("set-cookie", clearSessionCookie());
  return new Response(null, {
    status: 303,
    headers,
  });
}

export const handler = define.handlers({ GET: handle, POST: handle });

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Adding another account is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
