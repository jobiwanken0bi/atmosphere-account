/**
 * OAuth redirect target. Exchanges the authorization code for tokens,
 * persists the session, and bounces the user into /explore/manage.
 *
 * Also appends the freshly-authenticated account to the per-device
 * `atmo_accounts` cookie so the AccountMenu switcher can offer
 * one-click sign-in for any account that has previously authorised
 * on this browser.
 */
import { define } from "../../utils.ts";
import { completeCallback, isOAuthConfigured } from "../../lib/oauth.ts";
import { buildSessionCookie, createSession } from "../../lib/session.ts";
import {
  addRememberedAccountCookie,
  readRememberedAccountsFromHeader,
} from "../../lib/remembered-accounts.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (!isOAuthConfigured()) {
      return new Response("OAuth is not configured", { status: 503 });
    }
    const state = ctx.url.searchParams.get("state");
    const code = ctx.url.searchParams.get("code");
    const iss = ctx.url.searchParams.get("iss");
    const error = ctx.url.searchParams.get("error");
    if (error) {
      return new Response(`authorization denied: ${error}`, { status: 400 });
    }
    if (!state || !code || !iss) {
      return new Response("missing state, code, or iss", { status: 400 });
    }
    try {
      const result = await completeCallback({ state, code, iss });
      const sessionCookie = buildSessionCookie(
        await createSession({ did: result.did, handle: result.handle }),
      );

      /** Append to the per-device remembered list so the next visit
       *  can offer this account in the switcher even if the active
       *  session cookie has been cleared. */
      const remembered = await readRememberedAccountsFromHeader(
        ctx.req.headers.get("cookie"),
      );
      const rememberedCookie = await addRememberedAccountCookie(remembered, {
        did: result.did,
        handle: result.handle,
      });

      const headers = new Headers({ location: "/explore/manage" });
      headers.append("set-cookie", sessionCookie);
      headers.append("set-cookie", rememberedCookie);
      return new Response(null, { status: 303, headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(`callback failed: ${message}`, { status: 400 });
    }
  },
});
