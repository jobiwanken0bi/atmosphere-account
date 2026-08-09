/**
 * Initiate the atproto OAuth flow. Accepts a handle (or DID) via either
 *   - GET ?handle=...   (no-JS form submit)
 *   - POST { handle }   (form-urlencoded body or JSON)
 *
 * Resolves the handle, runs PAR against the user's authorization server,
 * and 302s the browser to the consent screen.
 */
import { define } from "../../utils.ts";
import {
  isOAuthConfigured,
  type SignInIntent,
  startLogin,
} from "../../lib/oauth.ts";
import { oauthClientConfigForRequest } from "../../lib/atmosphere-origins.ts";
import { proxyAppviewApiResponse } from "../../lib/appview-client.ts";
import { isSafeRelativePath, rejectLargeRequest } from "../../lib/security.ts";
import { enforceDurableRateLimit } from "../../lib/rate-limit.ts";
import {
  IDENTITY_OAUTH_SCOPE,
  normalizeOAuthCapabilities,
  type OAuthCapability,
} from "../../lib/oauth-scopes.ts";
import {
  isOAuthAction,
  isOAuthActionCapabilityRequest,
  type OAuthAction,
  safeOAuthTargetName,
} from "../../lib/oauth-action.ts";

const MAX_OAUTH_LOGIN_BODY_BYTES = 8_192;

function safeNext(raw: string | null): string | null {
  return isSafeRelativePath(raw) ? raw : null;
}

function safeIntent(raw: string | null | undefined): SignInIntent | null {
  return raw === "user" || raw === "project" ? raw : null;
}

interface LoginInput {
  handle: string | null;
  next: string | null;
  intent: SignInIntent | null;
  continuation: "login_selection" | null;
  capabilities: OAuthCapability[] | null;
  action: OAuthAction | null;
  targetName: string | null;
}

function safeContinuation(
  raw: string | null | undefined,
): "login_selection" | null {
  return raw === "login_selection" ? raw : null;
}

async function getLoginInput(req: Request, url: URL): Promise<LoginInput> {
  const fromQs = url.searchParams.get("handle");
  const nextFromQs = safeNext(url.searchParams.get("next"));
  const intentFromQs = safeIntent(url.searchParams.get("intent"));
  const continuationFromQs = safeContinuation(
    url.searchParams.get("continuation"),
  );
  const capabilitiesFromQs = normalizeOAuthCapabilities(
    url.searchParams.getAll("capability"),
  );
  const queryAction = url.searchParams.get("action");
  const actionFromQs = isOAuthAction(queryAction) ? queryAction : null;
  const targetNameFromQs = safeOAuthTargetName(
    url.searchParams.get("name"),
  ) ?? null;
  if (fromQs) {
    return {
      handle: fromQs.trim(),
      next: nextFromQs,
      intent: intentFromQs,
      continuation: continuationFromQs,
      capabilities: capabilitiesFromQs,
      action: actionFromQs,
      targetName: targetNameFromQs,
    };
  }
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null) as
      | {
        handle?: string;
        next?: string;
        intent?: string;
        continuation?: string;
        capability?: string | string[];
        action?: string;
        name?: string;
      }
      | null;
    const bodyCapabilities = Array.isArray(body?.capability)
      ? body.capability
      : typeof body?.capability === "string"
      ? [body.capability]
      : null;
    return {
      handle: body?.handle?.trim() ?? null,
      next: safeNext(body?.next ?? null) ?? nextFromQs,
      intent: safeIntent(body?.intent) ?? intentFromQs,
      continuation: safeContinuation(body?.continuation) ??
        continuationFromQs,
      capabilities: bodyCapabilities
        ? normalizeOAuthCapabilities(bodyCapabilities)
        : capabilitiesFromQs,
      action: isOAuthAction(body?.action) ? body.action : actionFromQs,
      targetName: safeOAuthTargetName(body?.name) ?? targetNameFromQs,
    };
  }
  if (
    ct.includes("application/x-www-form-urlencoded") ||
    ct.includes("multipart/form-data")
  ) {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return {
        handle: null,
        next: nextFromQs,
        intent: intentFromQs,
        continuation: continuationFromQs,
        capabilities: capabilitiesFromQs,
        action: actionFromQs,
        targetName: targetNameFromQs,
      };
    }
    const v = form.get("handle");
    const next = form.get("next");
    const intent = form.get("intent");
    const continuation = form.get("continuation");
    const formCapabilities = form.getAll("capability").filter((value) =>
      typeof value === "string"
    );
    const formAction = form.get("action");
    const formTargetName = form.get("name");
    return {
      handle: typeof v === "string" ? v.trim() : null,
      next: safeNext(typeof next === "string" ? next : null) ?? nextFromQs,
      intent: safeIntent(typeof intent === "string" ? intent : null) ??
        intentFromQs,
      continuation: safeContinuation(
        typeof continuation === "string" ? continuation : null,
      ) ?? continuationFromQs,
      capabilities: formCapabilities.length > 0
        ? normalizeOAuthCapabilities(formCapabilities)
        : capabilitiesFromQs,
      action: isOAuthAction(formAction) ? formAction : actionFromQs,
      targetName: safeOAuthTargetName(formTargetName) ?? targetNameFromQs,
    };
  }
  return {
    handle: null,
    next: nextFromQs,
    intent: intentFromQs,
    continuation: continuationFromQs,
    capabilities: capabilitiesFromQs,
    action: actionFromQs,
    targetName: targetNameFromQs,
  };
}

export async function readLoginInputForTest(req: Request): Promise<LoginInput> {
  return await getLoginInput(req, new URL(req.url));
}

async function handle(ctx: { req: Request; url: URL }): Promise<Response> {
  const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
    (err) => appviewUnavailable("oauth login", err),
  );
  if (proxied) return proxied;

  const limited = await enforceDurableRateLimit(ctx.req, {
    scope: "oauth-login-start",
    capacity: 20,
    refillMs: 60_000,
  });
  if (limited) return limited;

  if (ctx.req.method !== "GET") {
    const large = rejectLargeRequest(ctx.req, MAX_OAUTH_LOGIN_BODY_BYTES);
    if (large) return large;
  }
  const wantsJson = ctx.req.headers.get("x-atmosphere-login") === "1" ||
    (ctx.req.headers.get("accept") ?? "").includes("application/json");
  const oauth = oauthClientConfigForRequest(ctx.url, ctx.req.headers);
  const oauthOptions = {
    clientId: oauth.clientId,
    redirectUri: oauth.redirectUri,
  };
  if (!isOAuthConfigured(oauthOptions)) {
    const message =
      "OAuth is not configured on this deployment. Run `deno task gen:oauth-key` and set OAUTH_PRIVATE_JWK + OAUTH_KID + OAUTH_PUBLIC_JWK.";
    return wantsJson ? jsonError(message, 503) : new Response(message, {
      status: 503,
    });
  }
  const {
    handle: handleStr,
    next: returnTo,
    intent,
    continuation,
    capabilities,
    action,
    targetName,
  } = await getLoginInput(ctx.req, ctx.url);
  if (!handleStr) {
    return wantsJson
      ? jsonError("missing handle", 400)
      : new Response("missing handle", { status: 400 });
  }
  if (!capabilities) {
    return wantsJson
      ? jsonError("invalid capability", 400)
      : new Response("invalid capability", { status: 400 });
  }
  if (!isOAuthActionCapabilityRequest(action, capabilities)) {
    return wantsJson
      ? jsonError("invalid action capability combination", 400)
      : new Response("invalid action capability combination", {
        status: 400,
      });
  }
  try {
    const { redirectUrl } = await startLogin(
      handleStr,
      returnTo,
      intent,
      {
        ...oauthOptions,
        continuation: continuation ?? undefined,
        action: action ?? undefined,
        targetName: targetName ?? undefined,
        ...(continuation === "login_selection"
          ? { scope: IDENTITY_OAUTH_SCOPE, persistSession: false }
          : { capabilities }),
      },
    );
    if (wantsJson) {
      return new Response(JSON.stringify({ redirectUrl }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    return new Response(null, {
      status: 303,
      headers: { location: redirectUrl },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return wantsJson
      ? jsonError(`login failed: ${message}`, 400)
      : new Response(`login failed: ${message}`, { status: 400 });
  }
}

export const handler = define.handlers({ GET: handle, POST: handle });

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Sign in is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
