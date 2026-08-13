/** Initiate an AT Protocol OAuth flow from a contextual account chooser. */
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
import { hasValidLoginSelectionContinuationBinding } from "../../lib/oauth-continuation.ts";
import { buildOAuthFlowBindingCookie } from "../../lib/oauth-flow-binding.ts";
import { grantDevPickerHostClaimAuthorization } from "../../lib/dev-picker-oauth.ts";

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
  const targetNameFromQs = safeOAuthTargetName(
    singleSearchValue(url.searchParams, "name"),
  ) ?? null;
  const bodylessHandoff = isExplicitBodylessLoginHandoff(req);
  if (
    req.headers.get("x-atmosphere-login-bodyless") === "1" &&
    !bodylessHandoff
  ) {
    throw new InvalidOAuthRequestInputError();
  }
  if (req.method === "GET" || bodylessHandoff) {
    return {
      handle: fromQs?.trim() || null,
      next: nextFromQs,
      intent: intentFromQs,
      continuation: continuationFromQs,
      chooseAnotherAccount: chooseFromQs === "another",
      capabilities: capabilitiesFromQs,
      action: queryAction,
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
    return {
      handle: optionalJsonString(body, "handle")?.trim() || fromQs?.trim() ||
        null,
      next: optionalSafeRelativePath(optionalJsonString(body, "next")) ??
        nextFromQs,
      intent: optionalEnum(
        optionalJsonString(body, "intent"),
        ["user", "project"] as const,
      ) ?? intentFromQs,
      continuation: optionalEnum(
        optionalJsonString(body, "continuation"),
        ["login_selection"] as const,
      ) ?? continuationFromQs,
      chooseAnotherAccount: optionalEnum(
            optionalJsonString(body, "choose"),
            ["another"] as const,
          ) === "another" || chooseFromQs === "another",
      capabilities: bodyCapabilities
        ? normalizeOAuthCapabilities(bodyCapabilities)
        : capabilitiesFromQs,
      action: bodyAction ?? queryAction,
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
      intent: optionalEnum(
        singleFormString(form, "intent"),
        ["user", "project"] as const,
      ) ?? intentFromQs,
      continuation: optionalEnum(
        singleFormString(form, "continuation"),
        ["login_selection"] as const,
      ) ?? continuationFromQs,
      chooseAnotherAccount: optionalEnum(
            singleFormString(form, "choose"),
            ["another"] as const,
          ) === "another" || chooseFromQs === "another",
      capabilities: formCapabilities.length > 0
        ? normalizeOAuthCapabilities(formCapabilities)
        : capabilitiesFromQs,
      action: formAction ?? queryAction,
      targetName: safeOAuthTargetName(singleFormString(form, "name")) ??
        targetNameFromQs,
    };
  }
  throw new InvalidOAuthRequestInputError();
}

function isExplicitBodylessLoginHandoff(req: Request): boolean {
  const contentLength = req.headers.get("content-length");
  return req.method === "POST" &&
    req.headers.get("x-atmosphere-login") === "1" &&
    req.headers.get("x-atmosphere-login-bodyless") === "1" &&
    !(req.headers.get("content-type") ?? "").trim() &&
    (contentLength === null || contentLength === "0");
}

export async function readLoginInputForTest(req: Request): Promise<LoginInput> {
  return await getLoginInput(req, new URL(req.url));
}

async function handle(ctx: { req: Request; url: URL }): Promise<Response> {
  const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(() =>
    appviewUnavailable()
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
    return publicLoginError("This sign-in link is invalid.", 414, wantsJson);
  }
  const oauth = oauthClientConfigForRequest(ctx.url, ctx.req.headers);
  const oauthOptions = {
    clientId: oauth.clientId,
    redirectUri: oauth.redirectUri,
  };
  if (!isOAuthConfigured(oauthOptions)) {
    return publicLoginError(
      "Login with Atmosphere isn’t available right now. Try again shortly.",
      503,
      wantsJson,
    );
  }
  let input: LoginInput;
  try {
    input = await getLoginInput(ctx.req, ctx.url);
  } catch (error) {
    return publicLoginError(
      "This sign-in link is invalid.",
      error instanceof RequestBodyTooLargeError ? 413 : 400,
      wantsJson,
    );
  }
  const {
    handle,
    next,
    intent,
    continuation,
    chooseAnotherAccount,
    capabilities,
    action,
    targetName,
  } = input;
  if (!handle) {
    return publicLoginError(
      "Enter an Atmosphere handle to continue.",
      400,
      wantsJson,
    );
  }
  if (
    !capabilities || !isOAuthActionCapabilityRequest(action, capabilities) ||
    !hasValidLoginSelectionContinuationBinding(
      next,
      continuation,
      intent,
      action,
      capabilities ?? ["identity"],
    )
  ) return publicLoginError("This sign-in link is invalid.", 400, wantsJson);

  if (continuation === null && next) {
    const devAccount = await grantDevPickerHostClaimAuthorization(ctx.req, {
      identifier: handle,
      action,
      capabilities,
    }).catch(() => null);
    if (devAccount) {
      const headers = new Headers({
        "cache-control": "no-store",
        "location": next,
      });
      if (wantsJson) {
        headers.set("content-type", "application/json; charset=utf-8");
        return new Response(JSON.stringify({ redirectUrl: next }), {
          status: 200,
          headers,
        });
      }
      return new Response(null, { status: 303, headers });
    }
  }

  try {
    const { redirectUrl, state, browserBinding } = await startLogin(
      handle,
      next,
      intent,
      {
        ...oauthOptions,
        continuation: continuation ?? undefined,
        chooseAnotherAccount,
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
    const headers = new Headers({ "cache-control": "no-store" });
    headers.append(
      "set-cookie",
      buildOAuthFlowBindingCookie(state, browserBinding),
    );
    if (wantsJson) {
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify({ redirectUrl }), {
        status: 200,
        headers,
      });
    }
    headers.set("location", redirectUrl);
    return new Response(null, { status: 303, headers });
  } catch {
    console.warn("[oauth] sign-in start failed");
    return publicLoginError(
      "Couldn’t start sign-in. Check the handle and try again.",
      400,
      wantsJson,
    );
  }
}

export const handler = define.handlers({ GET: handle, POST: handle });

function appviewUnavailable(): Response {
  console.error("[appview] OAuth login proxy failed");
  return new Response("Login with Atmosphere is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function publicLoginError(
  message: string,
  status: number,
  wantsJson: boolean,
): Response {
  const headers = {
    "cache-control": "no-store",
    "content-type": wantsJson
      ? "application/json; charset=utf-8"
      : "text/plain; charset=utf-8",
  };
  return new Response(
    wantsJson ? JSON.stringify({ error: message }) : message,
    {
      status,
      headers,
    },
  );
}
