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
  type CallbackResult,
  type CancelledOAuthFlow,
  cancelOAuthFlow,
  completeCallback,
  isOAuthConfigured,
  type SignInIntent,
} from "../../lib/oauth.ts";
import { oauthClientConfigForRequest } from "../../lib/atmosphere-origins.ts";
import {
  buildSessionCookie,
  createSession,
  destroySession,
} from "../../lib/session.ts";
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
  type OAuthAction,
  oauthCreateAccountUrl,
} from "../../lib/oauth-action.ts";
import type { OAuthCapability } from "../../lib/oauth-scopes.ts";
import {
  InvalidOAuthRequestInputError,
  singleSearchValue,
} from "../../lib/oauth-request-input.ts";
import {
  clearOAuthFlowBindingCookie,
  readOAuthFlowBindingCookie,
} from "../../lib/oauth-flow-binding.ts";

const MAX_OAUTH_CALLBACK_QUERY_BYTES = 16_384;

interface OAuthRetryContext {
  next: string;
  permission: "denied" | "failed" | "partial" | "concurrent";
  capabilities: readonly OAuthCapability[];
  intent?: SignInIntent;
  mode?: "create";
  chooseAnotherAccount?: boolean;
  action?: OAuthAction;
  targetName?: string;
  handle?: string;
}

export function oauthRetryLocation(context: OAuthRetryContext): string {
  const retry = new URLSearchParams({
    next: context.next,
    permission: context.permission,
  });
  if (context.mode) retry.set("mode", context.mode);
  if (context.chooseAnotherAccount) retry.set("choose", "another");
  if (context.handle) retry.set("handle", context.handle);
  if (context.intent) retry.set("intent", context.intent);
  if (context.action) retry.set("action", context.action);
  if (context.targetName) retry.set("name", context.targetName);
  for (const capability of context.capabilities) {
    retry.append("capability", capability);
  }
  return `/signin?${retry.toString()}`;
}

export function oauthErrorPermission(error: string): "denied" | "failed" {
  return error === "access_denied" || error === "user_cancelled"
    ? "denied"
    : "failed";
}

export function oauthCompletedFailureLocation(
  result:
    & Pick<
      CallbackResult,
      | "returnTo"
      | "continuation"
      | "capabilities"
      | "intent"
      | "mode"
      | "chooseAnotherAccount"
      | "action"
      | "targetName"
    >
    & { handle?: string },
): string {
  const returnTo = result.returnTo && isSafeRelativePath(result.returnTo)
    ? result.returnTo
    : "/account";
  if (result.continuation === "login_selection") return returnTo;
  return oauthRetryLocation({
    next: returnTo,
    permission: "failed",
    capabilities: result.capabilities ?? ["identity"],
    intent: result.intent,
    mode: result.mode,
    chooseAnotherAccount: true,
    action: result.action,
    targetName: result.targetName,
    handle: result.handle,
  });
}

export function readOAuthCallbackParameters(url: URL): {
  state: string | null;
  code: string | null;
  iss: string | null;
  error: string | null;
} {
  if (url.search.length > MAX_OAUTH_CALLBACK_QUERY_BYTES) {
    throw new InvalidOAuthRequestInputError();
  }
  const state = singleSearchValue(url.searchParams, "state");
  const code = singleSearchValue(url.searchParams, "code");
  const iss = singleSearchValue(url.searchParams, "iss");
  const error = singleSearchValue(url.searchParams, "error");
  if (error !== null && code !== null) {
    throw new InvalidOAuthRequestInputError();
  }
  return { state, code, iss, error };
}

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      () => appviewUnavailable(),
    );
    if (proxied) return proxied;

    const oauth = oauthClientConfigForRequest(ctx.url, ctx.req.headers);
    if (
      !isOAuthConfigured({
        clientId: oauth.clientId,
        redirectUri: oauth.redirectUri,
      })
    ) {
      return new Response(
        "Login with Atmosphere isn’t available right now. Try again shortly.",
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    let callback;
    try {
      callback = readOAuthCallbackParameters(ctx.url);
    } catch {
      return new Response("This sign-in link is invalid.", {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    const { state, code, iss, error } = callback;
    if (!state) {
      return new Response(
        "This sign-in link has expired or is incomplete. Return to the previous page and try again.",
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const browserBinding = readOAuthFlowBindingCookie(ctx.req, state);
    if (!browserBinding) {
      return new Response(
        "This sign-in link was opened in a different browser or has expired. Return to the previous page and try again.",
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    if (error) {
      const cancelled = await cancelOAuthFlow(
        state,
        { clientId: oauth.clientId, redirectUri: oauth.redirectUri },
        browserBinding,
      ).catch(() => null);
      if (cancelled) {
        const permission = oauthErrorPermission(error);
        const location = permission === "denied"
          ? oauthCancellationRedirect(cancelled)
          : oauthFailureRedirect(cancelled);
        return withClearedOAuthFlowBinding(
          new Response(null, {
            status: 303,
            headers: { location, "cache-control": "no-store" },
          }),
          state,
        );
      }
      return withClearedOAuthFlowBinding(
        new Response(null, {
          status: 303,
          headers: {
            location: oauthRetryLocation({
              next: "/account",
              permission: oauthErrorPermission(error),
              capabilities: ["identity"],
              action: "account",
            }),
            "cache-control": "no-store",
          },
        }),
        state,
      );
    }
    if (!code || !iss) {
      return withClearedOAuthFlowBinding(
        new Response(
          "This sign-in link has expired or is incomplete. Return to the previous page and try again.",
          { status: 400, headers: { "cache-control": "no-store" } },
        ),
        state,
      );
    }
    let completedResult: Awaited<ReturnType<typeof completeCallback>> | null =
      null;
    try {
      const result = await completeCallback(
        { state, code, iss },
        { clientId: oauth.clientId, redirectUri: oauth.redirectUri },
        browserBinding,
      );
      completedResult = result;
      await observeAccountHost(result.pdsUrl).catch(() => {});

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
        destination = oauthRetryLocation({
          next: destination,
          handle: result.handle,
          permission: result.scopeConflict ? "concurrent" : "partial",
          capabilities: result.capabilities ?? ["identity"],
          intent: result.intent,
          mode: result.mode,
          chooseAnotherAccount: result.chooseAnotherAccount,
          action: result.action,
          targetName: result.targetName,
        });
      }
      // Mint the replacement before revoking the old app session. Deliver it
      // only after the old SID has been durably removed.
      const sessionCookie = buildSessionCookie(
        await createSession({ did: result.did, handle: result.handle }),
      );
      await destroySession(ctx.req);
      const headers = new Headers({
        location: destination,
        "cache-control": "no-store",
      });
      headers.append("set-cookie", sessionCookie);
      for (const cookie of rememberedCookies) {
        headers.append("set-cookie", cookie);
      }
      const clearBinding = clearOAuthFlowBindingCookie(state);
      if (clearBinding) headers.append("set-cookie", clearBinding);
      return new Response(null, { status: 303, headers });
    } catch {
      console.error("[oauth] callback failed");
      if (completedResult) {
        return withClearedOAuthFlowBinding(
          new Response(null, {
            status: 303,
            headers: {
              location: oauthCompletedFailureLocation(completedResult),
              "cache-control": "no-store",
            },
          }),
          state,
        );
      }
      const failed = await cancelOAuthFlow(
        state,
        { clientId: oauth.clientId, redirectUri: oauth.redirectUri },
        browserBinding,
      ).catch(() => null);
      return withClearedOAuthFlowBinding(
        new Response(null, {
          status: 303,
          headers: {
            location: failed
              ? oauthFailureRedirect(failed)
              : oauthRetryLocation({
                next: "/account",
                permission: "failed",
                capabilities: ["identity"],
                action: "account",
              }),
            "cache-control": "no-store",
          },
        }),
        state,
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
  if (cancelled.chooseAnotherAccount) retry.set("choose", "another");
  for (const capability of capabilities) {
    retry.append("capability", capability);
  }
  retry.set("action", action);
  if (cancelled.intent) retry.set("intent", cancelled.intent);
  if (cancelled.targetName) retry.set("name", cancelled.targetName);
  if (cancelled.handle) retry.set("handle", cancelled.handle);
  return `/signin?${retry}`;
}

function oauthFailureRedirect(failed: CancelledOAuthFlow): string {
  const returnTo = failed.returnTo && isSafeRelativePath(failed.returnTo)
    ? failed.returnTo
    : "/account";
  const capabilities = failed.capabilities ?? ["identity"];
  const action = failed.action ?? "account";
  if (
    failed.mode === "create" && isAccountCreationAction(action) &&
    isOAuthActionCapabilityRequest(action, capabilities)
  ) {
    return oauthCreateAccountUrl({
      next: returnTo,
      intent: failed.intent,
      capabilities,
      action,
      name: failed.targetName,
      error: "creation_unavailable",
    });
  }
  if (failed.continuation === "login_selection") {
    return appendSafeRelativeQuery(
      returnTo,
      "login_error",
      "authorization_failed",
    );
  }
  return oauthRetryLocation({
    next: returnTo,
    permission: "failed",
    capabilities,
    intent: failed.intent,
    mode: failed.mode,
    chooseAnotherAccount: failed.chooseAnotherAccount,
    action,
    targetName: failed.targetName,
    handle: failed.handle,
  });
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

function withClearedOAuthFlowBinding(
  response: Response,
  state: string | null,
): Response {
  if (!state) return response;
  const cookie = clearOAuthFlowBindingCookie(state);
  if (cookie) response.headers.append("set-cookie", cookie);
  return response;
}

function appviewUnavailable(): Response {
  console.error("[appview] OAuth callback proxy failed");
  return new Response("Sign in callback is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
