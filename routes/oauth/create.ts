/**
 * Start a host-owned OAuth account-creation flow.
 *
 * The selected host receives `prompt=create`; Atmosphere keeps only the normal
 * OAuth state and returns the finished account to this site or to the original
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
} from "../../lib/oauth-scopes.ts";
import {
  isOAuthAction,
  isOAuthActionCapabilityRequest,
  type OAuthAction,
  safeOAuthTargetName,
} from "../../lib/oauth-action.ts";
import { oauthActionAllowsAccountCreation } from "../../lib/oauth-action-copy.ts";
import {
  InvalidOAuthRequestInputError,
  optionalEnum,
  optionalSafeRelativePath,
  repeatedSearchValues,
  singleSearchValue,
} from "../../lib/oauth-request-input.ts";
import { readLoginRequest } from "../../lib/atmosphere-login.ts";
import { buildOAuthFlowBindingCookie } from "../../lib/oauth-flow-binding.ts";

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
    (err) => appviewUnavailable("OAuth account creation", err),
  );
  if (proxied) return proxied;

  const limited = await enforceDurableRateLimit(ctx.req, {
    scope: "oauth-account-create-start",
    capacity: 12,
    refillMs: 60_000,
  });
  if (limited) return limited;

  if (ctx.url.search.length > MAX_CREATE_QUERY_BYTES) {
    return publicAccountCreationError(
      "Account-creation link is too large.",
      414,
    );
  }
  let hostName: string;
  let returnTo: string | null;
  let intent: SignInIntent | null;
  let capabilities;
  let action;
  let targetName;
  let continuation: "login_selection" | null;
  try {
    hostName = (singleSearchValue(ctx.url.searchParams, "host") ?? "")
      .trim().toLowerCase();
    returnTo = optionalSafeRelativePath(
      singleSearchValue(ctx.url.searchParams, "next"),
    );
    intent = optionalEnum(
      singleSearchValue(ctx.url.searchParams, "intent"),
      [
        "user",
        "project",
      ] as const,
    );
    capabilities = normalizeOAuthCapabilities(
      repeatedSearchValues(ctx.url.searchParams, "capability"),
    );
    const rawAction = singleSearchValue(ctx.url.searchParams, "action");
    if (rawAction !== null && !isOAuthAction(rawAction)) {
      throw new InvalidOAuthRequestInputError();
    }
    action = rawAction ?? undefined;
    targetName = safeOAuthTargetName(
      singleSearchValue(ctx.url.searchParams, "name"),
    );
    continuation = optionalEnum(
      singleSearchValue(ctx.url.searchParams, "continuation"),
      ["login_selection"] as const,
    );
  } catch {
    return publicAccountCreationError(
      "This account-creation link is invalid. Return to Atmosphere and try again.",
      400,
    );
  }
  if (!hostName || hostName.length > MAX_HOST_LENGTH) {
    return publicAccountCreationError("Choose an available account host.", 400);
  }
  if (!capabilities) {
    return publicAccountCreationError(
      "This account-creation link is invalid. Return to Atmosphere and try again.",
      400,
    );
  }
  if (!isOAuthActionCapabilityRequest(action, capabilities)) {
    return publicAccountCreationError(
      "This account-creation link is invalid. Return to Atmosphere and try again.",
      400,
    );
  }
  const normalizedAction = enforceDirectAccountCreationAction(action);
  if (normalizedAction instanceof Response) return normalizedAction;

  const host = await getAccountHost(hostName).catch(() => null);
  if (
    !host || !host.serviceEndpoint || !host.signupUrl ||
    !isCreateAccountHostEligible(host)
  ) {
    return publicAccountCreationError(
      "This account host isn’t available for signup. Choose another host.",
      404,
    );
  }

  const oauth = oauthClientConfigForRequest(ctx.url, ctx.req.headers);
  const loginSelectionReturn = isLoginSelectionReturn(returnTo);
  if (continuation === "login_selection" && !loginSelectionReturn) {
    return publicAccountCreationError(
      "This account-creation link is invalid. Return to the app and try again.",
      400,
    );
  }
  if (
    returnTo &&
    new URL(returnTo, "https://local.invalid").pathname === "/login/select" &&
    !loginSelectionReturn
  ) {
    return publicAccountCreationError(
      "This account-creation link is invalid. Return to the app and try again.",
      400,
    );
  }
  if (
    loginSelectionReturn &&
    (intent !== null || capabilities.length !== 1 ||
      capabilities[0] !== "identity" ||
      normalizedAction !== "account")
  ) {
    return publicAccountCreationError(
      "This account-creation link is invalid. Return to the app and try again.",
      400,
    );
  }
  const oauthOptions = {
    clientId: oauth.clientId,
    redirectUri: oauth.redirectUri,
    action: normalizedAction,
    targetName,
    ...(loginSelectionReturn
      ? {
        scope: IDENTITY_OAUTH_SCOPE,
        capabilities,
        persistSession: false,
      }
      : { capabilities }),
  };
  if (!isOAuthConfigured(oauthOptions)) {
    return publicAccountCreationError(
      "Account creation isn’t available right now. Try again shortly.",
      503,
    );
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
    return new Response(null, {
      status: 303,
      headers,
    });
  } catch (err) {
    if (err instanceof OAuthAccountCreationUnsupportedError) {
      return publicAccountCreationError(
        "This account host can’t create an account here right now. Choose another host.",
        409,
      );
    }
    // The thrown OAuth error can retain private client-key material.
    console.warn("[oauth] account creation start failed");
    return oauthAccountCreationFailureResponse();
  }
}

export const handler = define.handlers({ GET: handle });

export function oauthAccountCreationFailureResponse(): Response {
  return publicAccountCreationError(
    "Couldn’t create the account with this host. Choose another host or try again.",
    400,
  );
}

/**
 * `/signin` hides account creation for actions that can only be completed by
 * an existing owner. Enforce that same policy at the direct endpoint so a
 * crafted `/oauth/create` URL cannot bypass the chooser. Missing action is the
 * normal account flow and therefore normalizes to `account`.
 */
export function enforceDirectAccountCreationAction(
  action: OAuthAction | undefined,
): OAuthAction | Response {
  const normalized = action ?? "account";
  return oauthActionAllowsAccountCreation(normalized)
    ? normalized
    : publicAccountCreationError(
      "This action requires an existing account. Sign in instead.",
      400,
    );
}

function publicAccountCreationError(
  message: string,
  status: number,
): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Account creation is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
