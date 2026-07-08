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
import { getValidSession } from "../../lib/oauth.ts";
import {
  buildSessionCookie,
  createSession,
  destroySession,
} from "../../lib/session.ts";
import { readRememberedAccountsFromHeader } from "../../lib/remembered-accounts.ts";
import { getEffectiveAccountType } from "../../lib/account-types.ts";
import { isSafeRelativePath, rejectLargeRequest } from "../../lib/security.ts";

const SWITCH_SESSION_TIMEOUT_MS = 5_000;
const MAX_SWITCH_BODY_BYTES = 8_192;

function safeNext(raw: string | null | undefined): string | null {
  return raw && isSafeRelativePath(raw) ? raw : null;
}

async function readInput(
  req: Request,
): Promise<{ did: string | null; next: string | null }> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null) as
      | { did?: string; next?: string }
      | null;
    return {
      did: body?.did?.trim() ?? null,
      next: safeNext(body?.next),
    };
  }
  const form = await req.formData().catch(() => null);
  if (!form) return { did: null, next: null };
  const v = form.get("did");
  const next = form.get("next");
  return {
    did: typeof v === "string" ? v.trim() : null,
    next: safeNext(typeof next === "string" ? next : null),
  };
}

function redirectToReauth(handle: string, next: string | null): Response {
  const location = new URLSearchParams({ handle });
  if (next) location.set("next", next);
  return new Response(null, {
    status: 303,
    headers: {
      location: `/account?${location.toString()}`,
    },
  });
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
  const { did, next } = await readInput(ctx.req);
  if (!did) return new Response("missing did", { status: 400 });

  const remembered = await readRememberedAccountsFromHeader(
    ctx.req.headers.get("cookie"),
  );
  const target = remembered.find((a) => a.did === did);
  if (!target) {
    return new Response("account not remembered on this device", {
      status: 403,
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
    return redirectToReauth(target.handle, next);
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

  return new Response(null, {
    status: 303,
    headers: {
      location: next ??
        (accountType === "project"
          ? "/apps/manage"
          : accountType === "user"
          ? "/account"
          : "/account/type"),
      "set-cookie": buildSessionCookie(cookieValue),
    },
  });
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
