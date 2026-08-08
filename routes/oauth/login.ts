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
import {
  readFormDataRequestWithLimit,
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../lib/security.ts";
import { enforceDurableRateLimit } from "../../lib/rate-limit.ts";
import { isPasskeyManagementReturnTo } from "../../lib/passkey-management.ts";
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
import {
  InvalidOAuthRequestInputError,
  optionalEnum,
  optionalJsonString,
  optionalJsonStringList,
  optionalSafeRelativePath,
  plainJsonRecord,
  rejectSearchFormOverlap,
  rejectSearchJsonOverlap,
  repeatedFormStrings,
  repeatedSearchValues,
  singleFormString,
  singleSearchValue,
} from "../../lib/oauth-request-input.ts";
import {
  hasValidLoginSelectionContinuationBinding,
} from "../../lib/oauth-continuation.ts";
import { buildOAuthFlowBindingCookie } from "../../lib/oauth-flow-binding.ts";

export { isValidLoginSelectionContinuation } from "../../lib/oauth-continuation.ts";

const MAX_OAUTH_LOGIN_BODY_BYTES = 8_192;
const LOGIN_CONTEXT_FIELDS = [
  "handle",
  "next",
  "intent",
  "continuation",
  "choose",
  "capability",
  "action",
  "name",
] as const;

interface LoginInput {
  handle: string | null;
  next: string | null;
  intent: SignInIntent | null;
  continuation: "login_selection" | null;
  chooseAnotherAccount: boolean;
  capabilities: OAuthCapability[] | null;
  action: OAuthAction | null;
  targetName: string | null;
}

async function getLoginInput(req: Request, url: URL): Promise<LoginInput> {
  const fromQs = singleSearchValue(url.searchParams, "handle");
  const nextFromQs = optionalSafeRelativePath(
    singleSearchValue(url.searchParams, "next"),
  );
  const intentFromQs = optionalEnum(
    singleSearchValue(url.searchParams, "intent"),
    ["user", "project"] as const,
  );
  const continuationFromQs = optionalEnum(
    singleSearchValue(url.searchParams, "continuation"),
    ["login_selection"] as const,
  );
  const chooseFromQs = optionalEnum(
    singleSearchValue(url.searchParams, "choose"),
    ["another"] as const,
  );
  const capabilitiesFromQs = normalizeOAuthCapabilities(
    repeatedSearchValues(url.searchParams, "capability"),
  );
  const queryAction = singleSearchValue(url.searchParams, "action");
  if (queryAction !== null && !isOAuthAction(queryAction)) {
    throw new InvalidOAuthRequestInputError();
  }
  const actionFromQs = queryAction;
  const targetNameFromQs = safeOAuthTargetName(
    singleSearchValue(url.searchParams, "name"),
  ) ?? null;
  if (req.method === "GET") {
    return {
      handle: fromQs?.trim() || null,
      next: nextFromQs,
      intent: intentFromQs,
      continuation: continuationFromQs,
      chooseAnotherAccount: chooseFromQs === "another",
      capabilities: capabilitiesFromQs,
      action: actionFromQs,
      targetName: targetNameFromQs,
    };
  }
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const body = plainJsonRecord(
      await readJsonRequestWithLimit(req, MAX_OAUTH_LOGIN_BODY_BYTES),
    );
    rejectSearchJsonOverlap(url.searchParams, body, LOGIN_CONTEXT_FIELDS);
    const bodyCapabilities = optionalJsonStringList(body, "capability");
    const bodyAction = optionalJsonString(body, "action");
    if (bodyAction !== null && !isOAuthAction(bodyAction)) {
      throw new InvalidOAuthRequestInputError();
    }
    const bodyIntent = optionalEnum(
      optionalJsonString(body, "intent"),
      [
        "user",
        "project",
      ] as const,
    );
    const bodyContinuation = optionalEnum(
      optionalJsonString(body, "continuation"),
      ["login_selection"] as const,
    );
    const bodyChoose = optionalEnum(
      optionalJsonString(body, "choose"),
      [
        "another",
      ] as const,
    );
    return {
      handle: optionalJsonString(body, "handle")?.trim() || fromQs?.trim() ||
        null,
      next: optionalSafeRelativePath(optionalJsonString(body, "next")) ??
        nextFromQs,
      intent: bodyIntent ?? intentFromQs,
      continuation: bodyContinuation ?? continuationFromQs,
      chooseAnotherAccount: bodyChoose === "another" ||
        chooseFromQs === "another",
      capabilities: bodyCapabilities
        ? normalizeOAuthCapabilities(bodyCapabilities)
        : capabilitiesFromQs,
      action: bodyAction ?? actionFromQs,
      targetName: safeOAuthTargetName(optionalJsonString(body, "name")) ??
        targetNameFromQs,
    };
  }
  if (
    ct.includes("application/x-www-form-urlencoded") ||
    ct.includes("multipart/form-data")
  ) {
    const form = await readFormDataRequestWithLimit(
      req,
      MAX_OAUTH_LOGIN_BODY_BYTES,
    );
    if (!form) throw new InvalidOAuthRequestInputError();
    rejectSearchFormOverlap(url.searchParams, form, LOGIN_CONTEXT_FIELDS);
    const formIntent = optionalEnum(
      singleFormString(form, "intent"),
      [
        "user",
        "project",
      ] as const,
    );
    const formContinuation = optionalEnum(
      singleFormString(form, "continuation"),
      ["login_selection"] as const,
    );
    const formChoose = optionalEnum(
      singleFormString(form, "choose"),
      [
        "another",
      ] as const,
    );
    const formCapabilities = repeatedFormStrings(form, "capability");
    const formAction = singleFormString(form, "action");
    if (formAction !== null && !isOAuthAction(formAction)) {
      throw new InvalidOAuthRequestInputError();
    }
    return {
      handle: singleFormString(form, "handle")?.trim() || fromQs?.trim() ||
        null,
      next: optionalSafeRelativePath(singleFormString(form, "next")) ??
        nextFromQs,
      intent: formIntent ?? intentFromQs,
      continuation: formContinuation ?? continuationFromQs,
      chooseAnotherAccount: formChoose === "another" ||
        chooseFromQs === "another",
      capabilities: formCapabilities.length > 0
        ? normalizeOAuthCapabilities(formCapabilities)
        : capabilitiesFromQs,
      action: formAction ?? actionFromQs,
      targetName: safeOAuthTargetName(singleFormString(form, "name")) ??
        targetNameFromQs,
    };
  }
  throw new InvalidOAuthRequestInputError();
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
  if (ctx.url.search.length > MAX_OAUTH_LOGIN_BODY_BYTES) {
    return publicLoginError(
      "This sign-in link is invalid. Return to Atmosphere and try again.",
      414,
      wantsJson,
    );
  }
  const oauth = oauthClientConfigForRequest(ctx.url, ctx.req.headers);
  const oauthOptions = {
    clientId: oauth.clientId,
    redirectUri: oauth.redirectUri,
  };
  if (!isOAuthConfigured(oauthOptions)) {
    return publicLoginError(
      "Sign-in isn’t available right now. Try again shortly.",
      503,
      wantsJson,
    );
  }
  let input: LoginInput;
  try {
    input = await getLoginInput(ctx.req, ctx.url);
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    return publicLoginError(
      "This sign-in link is invalid. Return to Atmosphere and try again.",
      status,
      wantsJson,
    );
  }
  const {
    handle: handleStr,
    next: returnTo,
    intent,
    continuation,
    chooseAnotherAccount,
    capabilities,
    action,
    targetName,
  } = input;
  if (!handleStr) {
    return publicLoginError(
      "Enter an Atmosphere handle to continue.",
      400,
      wantsJson,
    );
  }
  if (!capabilities) {
    return publicLoginError(
      "This sign-in link is invalid. Return to Atmosphere and try again.",
      400,
      wantsJson,
    );
  }
  if (!isOAuthActionCapabilityRequest(action, capabilities)) {
    return publicLoginError(
      "This sign-in link is invalid. Return to Atmosphere and try again.",
      400,
      wantsJson,
    );
  }
  if (
    !hasValidLoginSelectionContinuationBinding(
      returnTo,
      continuation,
      intent,
      action,
      capabilities,
    )
  ) {
    return publicLoginError(
      "This sign-in link is invalid. Return to Atmosphere and try again.",
      400,
      wantsJson,
    );
  }
  try {
    const { redirectUrl, state, browserBinding } = await startLogin(
      handleStr,
      returnTo,
      intent,
      {
        ...oauthOptions,
        continuation: continuation ?? undefined,
        chooseAnotherAccount,
        reauthenticate: isPasskeyManagementReturnTo(returnTo),
        action: action ?? undefined,
        targetName: targetName ?? undefined,
        ...(continuation === "login_selection"
          ? {
            scope: IDENTITY_OAUTH_SCOPE,
            capabilities,
            persistSession: false,
          }
          : { capabilities }),
      },
    );
    const headers = new Headers();
    headers.append(
      "set-cookie",
      buildOAuthFlowBindingCookie(state, browserBinding),
    );
    if (wantsJson) {
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("cache-control", "no-store");
      return new Response(JSON.stringify({ redirectUrl }), {
        status: 200,
        headers,
      });
    }
    headers.set("location", redirectUrl);
    headers.set("cache-control", "no-store");
    return new Response(null, {
      status: 303,
      headers,
    });
  } catch (err) {
    console.warn("[oauth] sign-in start failed:", err);
    return oauthLoginFailureResponse(wantsJson);
  }
}

export const handler = define.handlers({ GET: handle, POST: handle });

export function oauthLoginFailureResponse(wantsJson: boolean): Response {
  return publicLoginError(
    "Couldn’t start sign-in. Check the handle and try again.",
    400,
    wantsJson,
  );
}

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
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function publicLoginError(
  message: string,
  status: number,
  wantsJson: boolean,
): Response {
  return wantsJson ? jsonError(message, status) : new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
