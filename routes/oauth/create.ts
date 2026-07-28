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
    (err) => appviewUnavailable("OAuth account creation", err),
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
  const returnTo = safeNext(ctx.url.searchParams.get("next"));
  const intent = safeIntent(ctx.url.searchParams.get("intent"));
  if (!hostName || hostName.length > MAX_HOST_LENGTH) {
    return new Response("missing or invalid account host", { status: 400 });
  }

  const host = await getAccountHost(hostName).catch(() => null);
  if (
    !host || !host.serviceEndpoint || !host.signupUrl ||
    !isCreateAccountHostEligible(host)
  ) {
    return new Response("account host is not available for signup", {
      status: 404,
    });
  }

  const oauth = oauthClientConfigForRequest(ctx.url, ctx.req.headers);
  const loginSelectionReturn = isLoginSelectionReturn(returnTo);
  const oauthOptions = {
    clientId: oauth.clientId,
    redirectUri: oauth.redirectUri,
    scope: loginSelectionReturn ? "atproto" : undefined,
  };
  if (!isOAuthConfigured(oauthOptions)) {
    return new Response("OAuth is not configured", { status: 503 });
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
      return new Response(
        "This host no longer supports direct OAuth account creation.",
        {
          status: 409,
          headers: { "cache-control": "no-store" },
        },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`account creation failed: ${message}`, { status: 400 });
  }
}

export const handler = define.handlers({ GET: handle });

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
