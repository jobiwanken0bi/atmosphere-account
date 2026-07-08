/**
 * OAuth redirect target. Exchanges the authorization code for tokens,
 * persists the session, and bounces the user into the account/app dashboard.
 *
 * Also appends the freshly-authenticated account to the per-device
 * `atmo_accounts` cookie so the AccountMenu switcher can offer
 * one-click sign-in for any account that has previously authorised
 * on this browser.
 */
import { define } from "../../utils.ts";
import { proxyAppviewApiResponse } from "../../lib/appview-client.ts";
import { completeCallback, isOAuthConfigured } from "../../lib/oauth.ts";
import { oauthClientConfigForRequest } from "../../lib/atmosphere-origins.ts";
import { buildSessionCookie, createSession } from "../../lib/session.ts";
import { getBskyProfile } from "../../lib/pds.ts";
import {
  addRememberedAccountCookies,
  readRememberedAccountsFromHeader,
} from "../../lib/remembered-accounts.ts";
import {
  type AccountType,
  getEffectiveAccountType,
  setAppUserType,
  updateAppUserProfile,
} from "../../lib/account-types.ts";
import { observeAccountHost } from "../../lib/account-hosts.ts";
import { isSafeRelativePath } from "../../lib/security.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("oauth callback", err),
    );
    if (proxied) return proxied;

    const oauth = oauthClientConfigForRequest(ctx.url, ctx.req.headers);
    if (
      !isOAuthConfigured({
        clientId: oauth.clientId,
        redirectUri: oauth.redirectUri,
      })
    ) {
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
      await observeAccountHost(result.pdsUrl).catch(() => {});
      const sessionCookie = buildSessionCookie(
        await createSession({ did: result.did, handle: result.handle }),
      );

      /** Append to the per-device remembered list so the next visit
       *  can offer this account in the switcher even if the active
       *  session cookie has been cleared. */
      const remembered = await readRememberedAccountsFromHeader(
        ctx.req.headers.get("cookie"),
      );
      const rememberedCookies = await addRememberedAccountCookies(remembered, {
        did: result.did,
        handle: result.handle,
        pdsUrl: result.pdsUrl,
      });

      const bskyProfile = await getBskyProfile(result.pdsUrl, result.did).catch(
        () => null,
      );
      await updateAppUserProfile({
        did: result.did,
        handle: result.handle,
        displayName: bskyProfile?.displayName ?? null,
        bio: bskyProfile?.description ?? null,
        avatarCid: bskyProfile?.avatar?.ref.$link ?? null,
        avatarMime: bskyProfile?.avatar?.mimeType ?? null,
      }).catch(() => {});

      /**
       * Auto-classify newly signed-in DIDs based on the sign-in intent
       * carried through the OAuth flow:
       *  - `intent === "project"` (clicked "Register an app")
       *      → mark as project, take them to the project dashboard.
       *  - `intent === "user"` or unset (header sign-in, review CTAs)
       *      → mark as user in the local account cache. Normal reviewer
       *        accounts use their ATProto/Bluesky profile for public identity.
       *
       * If the DID already has a type (re-sign-in or upgrade flows),
       * the intent is ignored and the existing classification stands.
       */
      let accountType: AccountType | null = await getEffectiveAccountType(
        result.did,
      ).catch(() => null);
      if (accountType == null) {
        const desired: AccountType = result.intent === "project"
          ? "project"
          : "user";
        await setAppUserType({
          did: result.did,
          handle: result.handle,
          displayName: bskyProfile?.displayName ?? null,
          bio: bskyProfile?.description ?? null,
          avatarCid: bskyProfile?.avatar?.ref.$link ?? null,
          avatarMime: bskyProfile?.avatar?.mimeType ?? null,
          accountType: desired,
        }).catch(() => {});
        accountType = desired;
      }
      const returnTo = isSafeRelativePath(result.returnTo)
        ? result.returnTo
        : null;
      const defaultLanding = accountType === "project"
        ? "/apps/manage"
        : "/account";
      const headers = new Headers({
        location: returnTo ?? defaultLanding,
      });
      headers.append("set-cookie", sessionCookie);
      for (const cookie of rememberedCookies) {
        headers.append("set-cookie", cookie);
      }
      return new Response(null, { status: 303, headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(`callback failed: ${message}`, { status: 400 });
    }
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Sign in callback is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
