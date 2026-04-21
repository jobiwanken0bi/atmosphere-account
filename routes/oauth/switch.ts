/**
 * One-click account switcher. Activates a different remembered account
 * by minting a fresh app session bound to its DID. The OAuth refresh
 * token (already stored server-side from a previous callback) is
 * exchanged for a new access token before the session is created, so
 * if the refresh has expired we transparently fall back to /oauth/login
 * for that handle.
 *
 * Accepts the target DID via either:
 *   - POST form body  (form-urlencoded `did=…`) — used by the menu form
 *   - POST JSON body  (`{ "did": "…" }`)        — used by JS callers
 *
 * The switch is gated on the DID being present in the device's
 * remembered-accounts cookie. That keeps random DIDs from being
 * promoted into a session even if the OAuth row exists from another
 * browser.
 */
import { define } from "../../utils.ts";
import { getValidSession } from "../../lib/oauth.ts";
import {
  buildSessionCookie,
  createSession,
  destroySession,
} from "../../lib/session.ts";
import { readRememberedAccountsFromHeader } from "../../lib/remembered-accounts.ts";

async function readDid(req: Request): Promise<string | null> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null) as
      | { did?: string }
      | null;
    return body?.did?.trim() ?? null;
  }
  const form = await req.formData().catch(() => null);
  if (!form) return null;
  const v = form.get("did");
  return typeof v === "string" ? v.trim() : null;
}

async function handle(ctx: { req: Request }): Promise<Response> {
  const did = await readDid(ctx.req);
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
  const oauthSession = await getValidSession(did).catch(() => null);
  if (!oauthSession) {
    return new Response(null, {
      status: 303,
      headers: {
        location: `/oauth/login?handle=${encodeURIComponent(target.handle)}`,
      },
    });
  }

  /** Drop the previous app session row (if any) so we don't leak
   *  rows in the table — the cookie itself is overwritten below. */
  await destroySession(ctx.req).catch(() => {});

  const cookieValue = await createSession({
    did: oauthSession.did,
    handle: oauthSession.handle,
  });

  return new Response(null, {
    status: 303,
    headers: {
      location: "/explore/manage",
      "set-cookie": buildSessionCookie(cookieValue),
    },
  });
}

export const handler = define.handlers({ POST: handle });
