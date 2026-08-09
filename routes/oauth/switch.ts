/**
 * One-click account switcher. Activates a different remembered account
 * by minting a fresh app session bound to its DID. The OAuth refresh
 * token (already stored server-side from a previous callback) is
 * exchanged for a new access token before the session is created, so
 * if the refresh has expired we transparently fall back to /oauth/login
 * for that handle.
 *
 * Accepts the target DID via either:
 *   - POST form body  (form-urlencoded `did=...`) — used by the menu form
 *   - POST JSON body  (`{ "did": "..." }`)        — used by JS callers
 *
 * A safe relative `next` path can optionally preserve deep-link flows
 * such as host claiming.
 *
 * The switch is gated on the DID being present in the device's
 * remembered-accounts cookie. That keeps random DIDs from being
 * promoted into a session even if the OAuth row exists from another
 * browser.
 */
import { define } from "../../utils.ts";
import { proxyAppviewApiResponse } from "../../lib/appview-client.ts";
import { getValidSession, grantedScopeForSession } from "../../lib/oauth.ts";
import {
  buildSessionCookie,
  createSession,
  destroySession,
} from "../../lib/session.ts";
import { readRememberedAccountsFromHeader } from "../../lib/remembered-accounts.ts";
import { getEffectiveAccountType } from "../../lib/account-types.ts";
import { isSafeRelativePath, rejectLargeRequest } from "../../lib/security.ts";
import {
  browserHandoffError,
  browserHandoffResponse,
  wantsBrowserHandoffJson,
} from "../../lib/browser-handoff.ts";
import { devPickerAccountForDid } from "../../lib/dev-picker-demo.ts";
import { IS_DEV } from "../../lib/env.ts";
import {
  hasOAuthCapabilities,
  normalizeOAuthCapabilities,
  type OAuthCapability,
} from "../../lib/oauth-scopes.ts";
import {
  isOAuthAction,
  isOAuthActionCapabilityRequest,
  type OAuthAction,
  safeOAuthTargetName,
} from "../../lib/oauth-action.ts";

const SWITCH_SESSION_TIMEOUT_MS = 5_000;
const MAX_SWITCH_BODY_BYTES = 8_192;

function safeNext(raw: string | null | undefined): string | null {
  return raw && isSafeRelativePath(raw) ? raw : null;
}

async function readInput(
  req: Request,
  url: URL,
): Promise<{
  did: string | null;
  next: string | null;
  intent: "user" | "project" | null;
  capabilities: OAuthCapability[] | null;
  action: OAuthAction | null;
  targetName: string | null;
}> {
  const queryCapabilities = normalizeOAuthCapabilities(
    url.searchParams.getAll("capability"),
  );
  const queryIntent = safeIntent(url.searchParams.get("intent"));
  const rawQueryAction = url.searchParams.get("action");
  const queryAction = isOAuthAction(rawQueryAction) ? rawQueryAction : null;
  const queryTargetName = safeOAuthTargetName(url.searchParams.get("name")) ??
    null;
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null) as
      | {
        did?: string;
        next?: string;
        intent?: string;
        capability?: string | string[];
        action?: string;
        name?: string;
      }
      | null;
    const bodyCapabilities = Array.isArray(body?.capability)
      ? body.capability
      : typeof body?.capability === "string"
      ? [body.capability]
      : null;
    return {
      did: body?.did?.trim() ?? null,
      next: safeNext(body?.next),
      intent: safeIntent(body?.intent) ?? queryIntent,
      capabilities: bodyCapabilities
        ? normalizeOAuthCapabilities(bodyCapabilities)
        : queryCapabilities,
      action: isOAuthAction(body?.action) ? body.action : queryAction,
      targetName: safeOAuthTargetName(body?.name) ?? queryTargetName,
    };
  }
  const form = await req.formData().catch(() => null);
  if (!form) {
    return {
      did: url.searchParams.get("did")?.trim() || null,
      next: safeNext(url.searchParams.get("next")),
      intent: queryIntent,
      capabilities: queryCapabilities,
      action: queryAction,
      targetName: queryTargetName,
    };
  }
  const v = form.get("did");
  const next = form.get("next");
  const intent = form.get("intent");
  const formCapabilities = form.getAll("capability");
  const formAction = form.get("action");
  const formTargetName = form.get("name");
  return {
    did: typeof v === "string"
      ? v.trim()
      : url.searchParams.get("did")?.trim() || null,
    next: safeNext(
      typeof next === "string" ? next : url.searchParams.get("next"),
    ),
    intent: safeIntent(typeof intent === "string" ? intent : null) ??
      queryIntent,
    capabilities: formCapabilities.length > 0
      ? normalizeOAuthCapabilities(formCapabilities)
      : queryCapabilities,
    action: isOAuthAction(formAction) ? formAction : queryAction,
    targetName: safeOAuthTargetName(formTargetName) ?? queryTargetName,
  };
}

function safeIntent(
  value: string | null | undefined,
): "user" | "project" | null {
  return value === "user" || value === "project" ? value : null;
}

export function buildSwitchReauthLocation(
  handle: string,
  next: string | null,
  capabilities: readonly OAuthCapability[] = [],
  intent: "user" | "project" | null = null,
  action: OAuthAction | null = null,
  targetName: string | null = null,
): string {
  const location = new URLSearchParams({ handle });
  if (next) location.set("next", next);
  if (intent) location.set("intent", intent);
  if (action) location.set("action", action);
  if (targetName) location.set("name", targetName);
  for (const capability of capabilities) {
    location.append("capability", capability);
  }
  return `/oauth/login?${location.toString()}`;
}

export async function readSwitchInputForTest(
  req: Request,
): Promise<{ did: string | null; next: string | null }> {
  const { did, next } = await readInput(req, new URL(req.url));
  return { did, next };
}

/** Full parser view used by capability-preservation regression tests. */
export async function readSwitchAuthorizationInputForTest(
  req: Request,
): Promise<{
  did: string | null;
  next: string | null;
  intent: "user" | "project" | null;
  capabilities: OAuthCapability[] | null;
  action: OAuthAction | null;
  targetName: string | null;
}> {
  const { did, next, intent, capabilities, action, targetName } =
    await readInput(
      req,
      new URL(req.url),
    );
  return { did, next, intent, capabilities, action, targetName };
}

function redirectToReauth(
  req: Request,
  handle: string,
  next: string | null,
  capabilities: readonly OAuthCapability[],
  intent: "user" | "project" | null,
  action: OAuthAction | null,
  targetName: string | null,
): Response {
  return browserHandoffResponse(
    buildSwitchReauthLocation(
      handle,
      next,
      capabilities,
      intent,
      action,
      targetName,
    ),
    {
      json: wantsBrowserHandoffJson(req),
    },
  );
}

function switchedSessionHeaders(sessionCookie: string): Headers {
  const headers = new Headers();
  headers.append("set-cookie", sessionCookie);
  return headers;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function handle(ctx: { req: Request }): Promise<Response> {
  const url = new URL(ctx.req.url);
  const proxied = await proxyAppviewApiResponse(url, ctx.req).catch((err) =>
    appviewUnavailable("oauth switch", err)
  );
  if (proxied) return proxied;

  const large = rejectLargeRequest(ctx.req, MAX_SWITCH_BODY_BYTES);
  if (large) return large;
  if (url.search.length > MAX_SWITCH_BODY_BYTES) {
    return browserHandoffError(
      "request URL too large",
      414,
      wantsBrowserHandoffJson(ctx.req),
    );
  }
  const wantsJson = wantsBrowserHandoffJson(ctx.req);
  const { did, next, intent, capabilities, action, targetName } =
    await readInput(
      ctx.req,
      url,
    );
  if (!did) return browserHandoffError("missing did", 400, wantsJson);
  if (!capabilities) {
    return browserHandoffError("invalid capability", 400, wantsJson);
  }
  if (!isOAuthActionCapabilityRequest(action, capabilities)) {
    return browserHandoffError(
      "invalid action capability combination",
      400,
      wantsJson,
    );
  }

  const remembered = await readRememberedAccountsFromHeader(
    ctx.req.headers.get("cookie"),
  );
  const target = remembered.find((a) => a.did === did);
  if (!target) {
    return browserHandoffError(
      "account not remembered on this device",
      403,
      wantsJson,
    );
  }

  /**
   * The local picker demo deliberately uses synthetic handles and DIDs. They
   * have no public DNS record or OAuth refresh session, so sending them
   * through the normal re-auth fallback can only end in handle-resolution
   * failure. The remembered-account cookie is signed, and this shortcut is
   * disabled outside local development.
   */
  const devAccount = IS_DEV ? devPickerAccountForDid(target.did) : null;
  if (
    devAccount &&
    devAccount.handle.toLowerCase() === target.handle.toLowerCase()
  ) {
    await destroySession(ctx.req).catch(() => {});
    const cookieValue = await createSession({
      did: devAccount.did,
      handle: devAccount.handle,
    });
    return browserHandoffResponse(next ?? "/account", {
      json: wantsJson,
      headers: switchedSessionHeaders(buildSessionCookie(cookieValue)),
    });
  }

  /** Try refreshing the OAuth tokens for this DID. If anything goes
   *  wrong (revoked refresh token, server-side row evicted, PDS
   *  unreachable) bounce to /oauth/login with a login_hint so the
   *  user gets a one-step re-auth instead of a confusing error. */
  const oauthSession = await withTimeout(
    getValidSession(did, { quiet: true }).catch(() => null),
    SWITCH_SESSION_TIMEOUT_MS,
  );
  if (!oauthSession) {
    return redirectToReauth(
      ctx.req,
      target.handle,
      next,
      capabilities,
      intent,
      action,
      targetName,
    );
  }
  if (
    !hasOAuthCapabilities(
      grantedScopeForSession(oauthSession),
      capabilities,
    )
  ) {
    return redirectToReauth(
      ctx.req,
      target.handle,
      next,
      capabilities,
      intent,
      action,
      targetName,
    );
  }

  /** Drop the previous app session row (if any) so we don't leak
   *  rows in the table — the cookie itself is overwritten below. */
  await destroySession(ctx.req).catch(() => {});

  const cookieValue = await createSession({
    did: oauthSession.did,
    handle: oauthSession.handle,
  });
  const accountType = await getEffectiveAccountType(oauthSession.did).catch(
    () => null,
  );

  return browserHandoffResponse(
    next ??
      (intent === "project" && accountType !== "project"
        ? "/apps/manage?new=1"
        : (accountType === "project"
          ? "/apps/manage"
          : accountType === "user"
          ? "/account"
          : "/account/type")),
    {
      json: wantsJson,
      headers: switchedSessionHeaders(buildSessionCookie(cookieValue)),
    },
  );
}

export const handler = define.handlers({ POST: handle });

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Account switching is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
