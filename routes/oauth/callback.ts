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
  getAppUser,
  getEffectiveAccountType,
  setAppUserType,
  updateAppUserProfile,
} from "../../lib/account-types.ts";
import { observeAccountHost } from "../../lib/account-hosts.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { isSafeRelativePath } from "../../lib/security.ts";
import { readLoginRequest } from "../../lib/atmosphere-login.ts";
import { createLoginSelectionIntent } from "../../lib/login-selection-intent.ts";
import {
  buildPasskeyManagementCookie,
  clearPasskeyManagementCookie,
  isPasskeyManagementReturnTo,
} from "../../lib/passkey-management.ts";

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

      const [bskyProfile, atmosphereProfile, existingAppUser] = await Promise
        .all([
          getBskyProfile(result.pdsUrl, result.did).catch(() => null),
          getProfileByDid(result.did, {
            includeTakenDown: true,
            profileType: "user",
          }).catch(() => null),
          getAppUser(result.did).catch(() => null),
        ]);

      /**
       * Auto-classify newly signed-in DIDs based on the sign-in intent
       * carried through the OAuth flow:
       *  - `intent === "project"` (clicked "Register an app")
       *      → mark as project, take them to the project dashboard.
       *  - `intent === "user"` or unset (header sign-in, review CTAs)
       *      → mark as user in the local account cache. An Atmosphere user
       *        profile is authoritative when present; the microblog profile
       *        supplies the initial fallback otherwise.
       *
       * If the DID already has a type (re-sign-in or upgrade flows),
       * the intent is ignored and the existing classification stands.
       */
      let accountType: AccountType | null = existingAppUser?.accountType ??
        await getEffectiveAccountType(result.did).catch(() => null);
      if (accountType == null) {
        accountType = result.intent === "project" ? "project" : "user";
      }
      const identityProfile = accountType === "user" && atmosphereProfile
        ? {
          displayName: atmosphereProfile.name,
          bio: atmosphereProfile.description,
          avatarCid: atmosphereProfile.avatarCid,
          avatarMime: atmosphereProfile.avatarMime,
        }
        : bskyProfile
        ? {
          displayName: bskyProfile.displayName ?? null,
          bio: bskyProfile.description ?? null,
          avatarCid: bskyProfile.avatar?.ref.$link ?? null,
          avatarMime: bskyProfile.avatar?.mimeType ?? null,
        }
        : null;

      if (!existingAppUser) {
        await setAppUserType({
          did: result.did,
          handle: result.handle,
          displayName: identityProfile?.displayName ?? null,
          bio: identityProfile?.bio ?? null,
          avatarCid: identityProfile?.avatarCid ?? null,
          avatarMime: identityProfile?.avatarMime ?? null,
          accountType,
        }).catch(() => {});
      } else if (identityProfile) {
        await updateAppUserProfile({
          did: result.did,
          handle: result.handle,
          ...identityProfile,
        }).catch(() => {});
      }
      const returnTo = isSafeRelativePath(result.returnTo)
        ? result.returnTo
        : null;
      const defaultLanding = accountType === "project"
        ? "/apps/manage"
        : "/account";
      let destination = returnTo ?? defaultLanding;
      if (result.continuation === "login_selection" && returnTo) {
        try {
          const requestUrl = new URL(returnTo, ctx.url.origin);
          const request = readLoginRequest(requestUrl);
          const selection = await createLoginSelectionIntent(
            request,
            result.did,
          );
          destination = `/login/select?selection=${
            encodeURIComponent(selection)
          }`;
        } catch {
          // Preserve the picker request if its one-click continuation expired.
        }
      }
      const headers = new Headers({
        location: destination,
      });
      headers.append("set-cookie", sessionCookie);
      for (const cookie of rememberedCookies) {
        headers.append("set-cookie", cookie);
      }
      if (
        isPasskeyManagementReturnTo(returnTo) && result.reauthenticated
      ) {
        headers.append(
          "set-cookie",
          await buildPasskeyManagementCookie(result.did),
        );
      } else {
        // OAuth can switch the active identity. Never carry a previous
        // account's short-lived passkey-management elevation across it.
        headers.append("set-cookie", clearPasskeyManagementCookie());
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
