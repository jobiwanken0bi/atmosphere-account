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
  cancelOAuthFlow,
  completeCallback,
  isOAuthConfigured,
  type SignInIntent,
} from "../../lib/oauth.ts";
import type { OAuthCapability } from "../../lib/oauth-scopes.ts";
import type { OAuthAction } from "../../lib/oauth-action.ts";
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
import { getProfileByDid } from "../../lib/registry.ts";
import { isSafeRelativePath } from "../../lib/security.ts";
import { readLoginRequest } from "../../lib/atmosphere-login.ts";
import { createLoginSelectionIntent } from "../../lib/login-selection-intent.ts";
import {
  buildPasskeyManagementCookie,
  clearPasskeyManagementCookie,
  isPasskeyManagementReturnTo,
} from "../../lib/passkey-management.ts";
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

export function oauthErrorPermission(
  error: string,
): "denied" | "failed" {
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
    // The completed identity may differ from the still-active browser session
    // when local session rotation fails. Force the retry through an explicit
    // account choice so the old identity cannot accidentally resume the new
    // identity's pending action.
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
        "Sign-in isn’t available right now. Try again shortly.",
        {
          status: 503,
        },
      );
    }
    let callback;
    try {
      callback = readOAuthCallbackParameters(ctx.url);
    } catch {
      return new Response(
        "This sign-in link is invalid. Return to Atmosphere and try again.",
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const { state, code, iss, error } = callback;
    const browserBinding = state
      ? readOAuthFlowBindingCookie(ctx.req, state)
      : null;
    if (state && !browserBinding) {
      return new Response(
        "This sign-in link was opened in a different browser or has expired. Return to Atmosphere and try again.",
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    if (error) {
      const permission = oauthErrorPermission(error);
      if (state) {
        const cancelled = await cancelOAuthFlow(state, {
          clientId: oauth.clientId,
          redirectUri: oauth.redirectUri,
        }, browserBinding ?? undefined).catch(() => null);
        if (cancelled) {
          const rawReturnTo = cancelled.returnTo;
          const returnTo = rawReturnTo && isSafeRelativePath(rawReturnTo)
            ? rawReturnTo
            : "/account";
          if (cancelled.continuation === "login_selection") {
            return withClearedOAuthFlowBinding(
              new Response(null, {
                status: 303,
                headers: { location: returnTo },
              }),
              state,
            );
          }
          return withClearedOAuthFlowBinding(
            new Response(null, {
              status: 303,
              headers: {
                location: oauthRetryLocation({
                  next: returnTo,
                  permission,
                  capabilities: cancelled.capabilities ?? ["identity"],
                  intent: cancelled.intent,
                  mode: cancelled.mode,
                  chooseAnotherAccount: cancelled.chooseAnotherAccount,
                  action: cancelled.action,
                  targetName: cancelled.targetName,
                  handle: cancelled.handle,
                }),
              },
            }),
            state,
          );
        }
      }
      // If state expired or the provider omitted it, there is no trustworthy
      // action context to restore. Still return a comprehensible, retryable
      // recovery screen instead of exposing the provider's protocol error.
      return withClearedOAuthFlowBinding(
        new Response(null, {
          status: 303,
          headers: {
            location: oauthRetryLocation({
              next: "/account",
              permission,
              capabilities: ["identity"],
              action: "account",
            }),
            "cache-control": "no-store",
          },
        }),
        state,
      );
    }
    if (!state || !code || !iss) {
      return withClearedOAuthFlowBinding(
        new Response(
          "This sign-in link has expired or is incomplete. Return to Atmosphere and try again.",
          { status: 400 },
        ),
        state,
      );
    }
    let completedResult: Awaited<ReturnType<typeof completeCallback>> | null =
      null;
    try {
      const result = await completeCallback({ state, code, iss }, {
        clientId: oauth.clientId,
        redirectUri: oauth.redirectUri,
      }, browserBinding ?? undefined);
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
      if (!result.authorizationSufficient || result.scopeConflict) {
        destination = oauthRetryLocation({
          next: destination,
          permission: result.scopeConflict ? "concurrent" : "partial",
          capabilities: result.capabilities ?? ["identity"],
          intent: result.intent,
          mode: result.mode,
          chooseAnotherAccount: result.chooseAnotherAccount,
          action: result.action,
          targetName: result.targetName,
          handle: result.handle,
        });
      }
      const passkeyManagementCookie =
        isPasskeyManagementReturnTo(returnTo) && result.reauthenticated
          ? await buildPasskeyManagementCookie(result.did)
          : clearPasskeyManagementCookie();
      const sessionCookie = buildSessionCookie(
        await createSession({ did: result.did, handle: result.handle }),
      );
      // Finish all fallible callback bookkeeping before rotating the browser
      // session. Mint the replacement first so a create failure preserves the
      // current account, then require the old SID to be revoked before the
      // replacement cookie is delivered.
      await destroySession(ctx.req);
      const headers = new Headers({
        location: destination,
      });
      headers.append("set-cookie", sessionCookie);
      for (const cookie of rememberedCookies) {
        headers.append("set-cookie", cookie);
      }
      // OAuth can switch the active identity. A previous account's short-lived
      // passkey-management elevation is replaced or explicitly cleared.
      headers.append("set-cookie", passkeyManagementCookie);
      const clearBinding = clearOAuthFlowBindingCookie(state);
      if (clearBinding) headers.append("set-cookie", clearBinding);
      return new Response(null, { status: 303, headers });
    } catch {
      // Do not serialize OAuth library errors: their cause chain can include
      // private client-key material and token exchange payloads.
      console.error("[oauth] callback failed");
      // `completeCallback` consumes the one-time flow state. Preserve its
      // already-validated action context if later local session/bookkeeping
      // work fails, instead of dropping the person onto a generic account
      // retry that loses their original deep link and requested permission.
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
      const failed = state
        ? await cancelOAuthFlow(state, {
          clientId: oauth.clientId,
          redirectUri: oauth.redirectUri,
        }, browserBinding ?? undefined).catch(() => null)
        : null;
      if (failed) {
        const returnTo = failed.returnTo && isSafeRelativePath(failed.returnTo)
          ? failed.returnTo
          : "/account";
        if (failed.continuation === "login_selection") {
          return withClearedOAuthFlowBinding(
            new Response(null, {
              status: 303,
              headers: { location: returnTo, "cache-control": "no-store" },
            }),
            state,
          );
        }
        return withClearedOAuthFlowBinding(
          new Response(null, {
            status: 303,
            headers: {
              location: oauthRetryLocation({
                next: returnTo,
                permission: "failed",
                capabilities: failed.capabilities ?? ["identity"],
                intent: failed.intent,
                mode: failed.mode,
                chooseAnotherAccount: failed.chooseAnotherAccount,
                action: failed.action,
                targetName: failed.targetName,
                handle: failed.handle,
              }),
              "cache-control": "no-store",
            },
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
  // Proxy errors can include the callback URL and its code, state, and issuer.
  console.error("[appview] OAuth callback proxy failed");
  return new Response("Sign in callback is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
