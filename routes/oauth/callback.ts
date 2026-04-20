/**
 * OAuth redirect target. Exchanges the authorization code for tokens,
 * persists the session, and bounces the user into /explore/manage.
 */
import { define } from "../../utils.ts";
import { completeCallback, isOAuthConfigured } from "../../lib/oauth.ts";
import { buildSessionCookie, createSession } from "../../lib/session.ts";

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
      const cookieValue = await createSession({
        did: result.did,
        handle: result.handle,
      });
      return new Response(null, {
        status: 303,
        headers: {
          location: "/explore/manage",
          "set-cookie": buildSessionCookie(cookieValue),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(`callback failed: ${message}`, { status: 400 });
    }
  },
});
