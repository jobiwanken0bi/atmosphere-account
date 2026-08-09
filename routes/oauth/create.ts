/**
 * Start a host-owned OAuth account-creation flow.
 *
 * The selected host receives `prompt=create`; this site keeps only the normal
 * OAuth state and returns the finished account here or to the original
 * universal account-picker request. Passwords, invite codes, and recovery
 * details stay on the host's origin.
 */
import { define } from "../../utils.ts";
import { getAccountHost } from "../../lib/account-hosts.ts";
import { proxyAppviewApiResponse } from "../../lib/appview-client.ts";
import { isCreateAccountHostEligible } from "../../lib/create-account-hosts.ts";
import { oauthClientConfigForRequest } from "../../lib/atmosphere-origins.ts";
import {
  isOAuthConfigured,
  OAuthAccountCreationUnsupportedError,
  type SignInIntent,
  startHostAccountCreation,
} from "../../lib/oauth.ts";
import { enforceDurableRateLimit } from "../../lib/rate-limit.ts";
import {
  IDENTITY_OAUTH_SCOPE,
  normalizeOAuthCapabilities,
  type OAuthCapability,
} from "../../lib/oauth-scopes.ts";
import {
  type AccountCreationError,
  isAccountCreationAction,
  isOAuthAction,
  isOAuthActionCapabilityRequest,
  type OAuthAction,
  oauthCreateAccountUrl,
  safeOAuthTargetName,
} from "../../lib/oauth-action.ts";
import {
  InvalidOAuthRequestInputError,
  optionalEnum,
  optionalSafeRelativePath,
  repeatedSearchValues,
  singleSearchValue,
} from "../../lib/oauth-request-input.ts";
import { hasValidLoginSelectionContinuationBinding } from "../../lib/oauth-continuation.ts";
import { buildOAuthFlowBindingCookie } from "../../lib/oauth-flow-binding.ts";
import { readLoginRequest } from "../../lib/atmosphere-login.ts";

const MAX_HOST_LENGTH = 253;
const MAX_CREATE_QUERY_BYTES = 16_384;

function isLoginSelectionReturn(path: string | null): boolean {
  if (!path) return false;
  try {
    const url = new URL(path, "https://local.invalid");
    if (
      url.origin !== "https://local.invalid" || url.pathname !== "/login/select"
    ) return false;
    readLoginRequest(url);
    return true;
  } catch {
    return false;
  }
}

async function handle(ctx: { req: Request; url: URL }): Promise<Response> {
  const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
    (err) => accountCreationUnavailable(ctx.url, err),
  );
  if (proxied) return proxied;

  const limited = await enforceDurableRateLimit(ctx.req, {
    scope: "oauth-account-create-start",
    capacity: 12,
    refillMs: 60_000,
  });
  if (limited) return limited;
  if (ctx.url.search.length > MAX_CREATE_QUERY_BYTES) {
    return new Response("account-creation link is too large", { status: 414 });
  }
  let hostName: string;
  let returnTo: string;
  let intent: SignInIntent | null;
  let capabilities;
  let action: OAuthAction;
  let targetName;
  let continuation: "login_selection" | null;
  try {
    hostName = (singleSearchValue(ctx.url.searchParams, "host") ?? "")
      .trim().toLowerCase();
    returnTo = optionalSafeRelativePath(
      singleSearchValue(ctx.url.searchParams, "next"),
    ) ?? "/account";
    intent = optionalEnum(
      singleSearchValue(ctx.url.searchParams, "intent"),
      ["user", "project"] as const,
    );
    capabilities = normalizeOAuthCapabilities(
      repeatedSearchValues(ctx.url.searchParams, "capability"),
    );
    const rawAction = singleSearchValue(ctx.url.searchParams, "action");
    if (rawAction !== null && !isOAuthAction(rawAction)) {
      throw new InvalidOAuthRequestInputError();
    }
    action = rawAction ?? "account";
    targetName = safeOAuthTargetName(
      singleSearchValue(ctx.url.searchParams, "name"),
    );
    continuation = optionalEnum(
      singleSearchValue(ctx.url.searchParams, "continuation"),
      ["login_selection"] as const,
    );
  } catch {
    return new Response("invalid account-creation link", { status: 400 });
  }
  if (!hostName || hostName.length > MAX_HOST_LENGTH) {
    return new Response("missing or invalid account host", { status: 400 });
  }
  if (!capabilities) {
    return new Response("invalid capability", { status: 400 });
  }
  if (!isOAuthActionCapabilityRequest(action, capabilities)) {
    return new Response("invalid action capability combination", {
      status: 400,
    });
  }
  if (!isAccountCreationAction(action)) {
    return new Response("account creation is not available for this action", {
      status: 400,
    });
  }
  const retry = (error: AccountCreationError) =>
    createAccountRetryUrl({
      returnTo,
      intent,
      capabilities,
      action,
      targetName,
      error,
    });

  const host = await getAccountHost(hostName).catch(() => null);
  if (
    !host || !host.serviceEndpoint || !host.signupUrl ||
    !isCreateAccountHostEligible(host)
  ) {
    return new Response(null, {
      status: 303,
      headers: {
        location: retry("host_unavailable"),
        "cache-control": "no-store",
      },
    });
  }

  const oauth = oauthClientConfigForRequest(ctx.url, ctx.req.headers);
  const loginSelectionReturn = isLoginSelectionReturn(returnTo);
  if (
    !hasValidLoginSelectionContinuationBinding(
      returnTo,
      loginSelectionReturn ? continuation ?? "login_selection" : continuation,
      intent,
      action,
      capabilities,
    )
  ) {
    return new Response("invalid account-creation continuation", {
      status: 400,
    });
  }
  const oauthOptions = {
    clientId: oauth.clientId,
    redirectUri: oauth.redirectUri,
    action,
    targetName,
    ...(loginSelectionReturn
      ? { scope: IDENTITY_OAUTH_SCOPE, persistSession: false }
      : { capabilities }),
  };
  if (!isOAuthConfigured(oauthOptions)) {
    return new Response(null, {
      status: 303,
      headers: {
        location: retry("creation_unavailable"),
        "cache-control": "no-store",
      },
    });
  }

  try {
    const { redirectUrl, state, browserBinding } =
      await startHostAccountCreation(
        host.serviceEndpoint,
        returnTo,
        intent,
        oauthOptions,
        loginSelectionReturn ? continuation ?? "login_selection" : null,
      );
    const headers = new Headers({
      location: redirectUrl,
      "cache-control": "no-store",
    });
    headers.append(
      "set-cookie",
      buildOAuthFlowBindingCookie(state, browserBinding),
    );
    return new Response(null, { status: 303, headers });
  } catch (err) {
    if (err instanceof OAuthAccountCreationUnsupportedError) {
      return new Response(null, {
        status: 303,
        headers: {
          location: retry("host_unavailable"),
          "cache-control": "no-store",
        },
      });
    }
    console.error("[oauth] account creation start failed");
    return new Response(null, {
      status: 303,
      headers: {
        location: retry("creation_unavailable"),
        "cache-control": "no-store",
      },
    });
  }
}

export const handler = define.handlers({ GET: handle });

function createAccountRetryUrl(input: {
  returnTo: string;
  intent: SignInIntent | null;
  capabilities: readonly OAuthCapability[];
  action: OAuthAction;
  targetName?: string;
  error: AccountCreationError;
}): string {
  return oauthCreateAccountUrl({
    next: input.returnTo,
    intent: input.intent ?? undefined,
    capabilities: input.capabilities,
    action: input.action,
    name: input.targetName,
    error: input.error,
  });
}

export function accountCreationProxyFailureRedirect(url: URL): string | null {
  try {
    const returnTo = optionalSafeRelativePath(
      singleSearchValue(url.searchParams, "next"),
    ) ?? "/account";
    const intent = optionalEnum(
      singleSearchValue(url.searchParams, "intent"),
      ["user", "project"] as const,
    );
    const capabilities = normalizeOAuthCapabilities(
      repeatedSearchValues(url.searchParams, "capability"),
    );
    const rawAction = singleSearchValue(url.searchParams, "action");
    const action: OAuthAction = isOAuthAction(rawAction)
      ? rawAction
      : "account";
    if (
      !capabilities || (rawAction !== null && !isOAuthAction(rawAction)) ||
      !isAccountCreationAction(action) ||
      !isOAuthActionCapabilityRequest(action, capabilities)
    ) return null;
    return createAccountRetryUrl({
      returnTo,
      intent,
      capabilities,
      action,
      targetName: safeOAuthTargetName(
        singleSearchValue(url.searchParams, "name"),
      ),
      error: "creation_unavailable",
    });
  } catch {
    return null;
  }
}

function accountCreationUnavailable(url: URL, _err: unknown): Response {
  console.error("[appview] OAuth account creation proxy failed");
  const retry = accountCreationProxyFailureRedirect(url);
  if (retry) {
    return new Response(null, {
      status: 303,
      headers: {
        location: retry,
        "cache-control": "no-store",
      },
    });
  }
  return new Response("Account creation is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
