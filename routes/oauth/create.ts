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
import { isSafeRelativePath } from "../../lib/security.ts";
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

const MAX_HOST_LENGTH = 253;

function safeNext(raw: string | null): string | null {
  return isSafeRelativePath(raw) ? raw : null;
}

function safeIntent(raw: string | null): SignInIntent | null {
  return raw === "user" || raw === "project" ? raw : null;
}

function isLoginSelectionReturn(path: string | null): boolean {
  if (!path) return false;
  try {
    return new URL(path, "https://local.invalid").pathname === "/login/select";
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

  const hostName = (ctx.url.searchParams.get("host") ?? "").trim()
    .toLowerCase();
  const returnTo = safeNext(ctx.url.searchParams.get("next")) ?? "/account";
  const intent = safeIntent(ctx.url.searchParams.get("intent"));
  const capabilities = normalizeOAuthCapabilities(
    ctx.url.searchParams.getAll("capability"),
  );
  const rawAction = ctx.url.searchParams.get("action");
  if (rawAction !== null && !isOAuthAction(rawAction)) {
    return new Response("invalid action", { status: 400 });
  }
  const action: OAuthAction = isOAuthAction(rawAction) ? rawAction : "account";
  const targetName = safeOAuthTargetName(ctx.url.searchParams.get("name"));
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
    const { redirectUrl } = await startHostAccountCreation(
      host.serviceEndpoint,
      returnTo,
      intent,
      oauthOptions,
      loginSelectionReturn ? "login_selection" : null,
    );
    return new Response(null, {
      status: 303,
      headers: {
        location: redirectUrl,
        "cache-control": "no-store",
      },
    });
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
  const returnTo = safeNext(url.searchParams.get("next")) ?? "/account";
  const intent = safeIntent(url.searchParams.get("intent"));
  const capabilities = normalizeOAuthCapabilities(
    url.searchParams.getAll("capability"),
  );
  const rawAction = url.searchParams.get("action");
  const action: OAuthAction = isOAuthAction(rawAction) ? rawAction : "account";
  if (
    !capabilities || (rawAction !== null && !isOAuthAction(rawAction)) ||
    !isAccountCreationAction(action) ||
    !isOAuthActionCapabilityRequest(action, capabilities)
  ) {
    return null;
  }
  return createAccountRetryUrl({
    returnTo,
    intent,
    capabilities,
    action,
    targetName: safeOAuthTargetName(url.searchParams.get("name")),
    error: "creation_unavailable",
  });
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
