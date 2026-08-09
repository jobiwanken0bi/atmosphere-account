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
import {
  type CancelledOAuthFlow,
  cancelOAuthFlow,
  completeCallback,
  isOAuthConfigured,
} from "../../lib/oauth.ts";
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
import { microblogAccountIdentity } from "../../lib/microblog-account-identity.ts";
import { isSafeRelativePath } from "../../lib/security.ts";
import { readLoginRequest } from "../../lib/atmosphere-login.ts";
import { createLoginSelectionIntent } from "../../lib/login-selection-intent.ts";
import {
  isAccountCreationAction,
  isOAuthActionCapabilityRequest,
  oauthCreateAccountUrl,
} from "../../lib/oauth-action.ts";

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
      if (state) {
        const cancelled = await cancelOAuthFlow(state).catch(() => null);
        if (cancelled) {
          return new Response(null, {
            status: 303,
            headers: { location: oauthCancellationRedirect(cancelled) },
          });
        }
      }
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

      const [bskyProfile, existingAppUser] = await Promise
        .all([
          getBskyProfile(result.pdsUrl, result.did).catch(() => null),
          getAppUser(result.did).catch(() => null),
        ]);

      /**
       * Auto-classify newly signed-in DIDs based on the sign-in intent
       * carried through the OAuth flow:
       *  - `intent === "project"` (clicked "Register an app")
       *      → mark as project, take them to the project dashboard.
       *  - `intent === "user"` or unset (header sign-in, review CTAs)
       *      → mark as user in the local account cache and use the account's
       *        microblog profile for its display identity.
       *
       * If the DID already has a type (re-sign-in or upgrade flows),
       * the intent is ignored and the existing classification stands.
       */
      let accountType: AccountType | null = existingAppUser?.accountType ??
        await getEffectiveAccountType(result.did).catch(() => null);
      if (accountType == null) {
        accountType = result.intent === "project" ? "project" : "user";
      }
      const identityProfile = microblogAccountIdentity(bskyProfile);

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
      } else {
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
      if (!result.authorizationSufficient || result.scopeConflict) {
        const retry = new URLSearchParams({
          next: destination,
          handle: result.handle,
          permission: result.scopeConflict ? "concurrent" : "partial",
        });
        for (const capability of result.capabilities ?? ["identity"]) {
          retry.append("capability", capability);
        }
        if (result.action) retry.set("action", result.action);
        if (result.intent) retry.set("intent", result.intent);
        if (result.targetName) retry.set("name", result.targetName);
        destination = `/signin?${retry.toString()}`;
      }
      const headers = new Headers({
        location: destination,
      });
      headers.append("set-cookie", sessionCookie);
      for (const cookie of rememberedCookies) {
        headers.append("set-cookie", cookie);
      }
      return new Response(null, { status: 303, headers });
    } catch {
      console.error("[oauth] callback failed");
      return new Response(
        "Login with Atmosphere could not be completed. Return to the previous page and try again.",
        {
          status: 400,
          headers: { "cache-control": "no-store" },
        },
      );
    }
  },
});

export function oauthCancellationRedirect(
  cancelled: CancelledOAuthFlow,
): string {
  const rawReturnTo = cancelled.returnTo;
  const returnTo = rawReturnTo && isSafeRelativePath(rawReturnTo)
    ? rawReturnTo
    : "/account";
  const capabilities = cancelled.capabilities ?? ["identity"];
  const action = cancelled.action ?? "account";

  if (
    cancelled.prompt === "create" && isAccountCreationAction(action) &&
    isOAuthActionCapabilityRequest(action, capabilities)
  ) {
    return oauthCreateAccountUrl({
      next: returnTo,
      intent: cancelled.intent,
      capabilities,
      action,
      name: cancelled.targetName,
      error: "authorization_cancelled",
    });
  }

  if (cancelled.continuation === "login_selection") {
    return appendSafeRelativeQuery(
      returnTo,
      "login_error",
      "authorization_cancelled",
    );
  }

  const retry = new URLSearchParams({
    next: returnTo,
    permission: "denied",
  });
  for (const capability of capabilities) {
    retry.append("capability", capability);
  }
  retry.set("action", action);
  if (cancelled.intent) retry.set("intent", cancelled.intent);
  if (cancelled.targetName) retry.set("name", cancelled.targetName);
  if (cancelled.handle) retry.set("handle", cancelled.handle);
  return `/signin?${retry}`;
}

function appendSafeRelativeQuery(
  path: string,
  key: string,
  value: string,
): string {
  const url = new URL(path, "https://local.invalid");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

function appviewUnavailable(_scope: string, _err: unknown): Response {
  console.error("[appview] OAuth callback proxy failed");
  return new Response("Sign in callback is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
