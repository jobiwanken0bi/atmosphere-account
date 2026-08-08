/**
 * One-click account switcher. Activates a different remembered account
 * by minting a fresh app session bound to its DID. The OAuth refresh
 * token (already stored server-side from a previous callback) is
 * exchanged for a new access token before the session is created, so
 * if the refresh has expired we transparently fall back to /oauth/login
 * for that handle.
 *
 * Accepts the target DID via either:
 *   - POST form body  (form-urlencoded `did=...`) — used by the menu form
 *   - POST JSON body  (`{ "did": "..." }`)        — used by JS callers
 *
 * A safe relative `next` path can optionally preserve deep-link flows
 * such as host claiming.
 *
 * The switch is gated on the DID being present in the device's
 * remembered-accounts cookie. That keeps random DIDs from being
 * promoted into a session even if the OAuth row exists from another
 * browser.
 */
import { define } from "../../utils.ts";
import { proxyAppviewApiResponse } from "../../lib/appview-client.ts";
import { getValidSession, grantedScopeForSession } from "../../lib/oauth.ts";
import {
  buildSessionCookie,
  createSession,
  destroySession,
} from "../../lib/session.ts";
import { readRememberedAccountsFromHeader } from "../../lib/remembered-accounts.ts";
import { getEffectiveAccountType } from "../../lib/account-types.ts";
import {
  readFormDataRequestWithLimit,
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../lib/security.ts";
import {
  browserHandoffError,
  browserHandoffResponse,
  wantsBrowserHandoffJson,
} from "../../lib/browser-handoff.ts";
import { devPickerAccountForDid } from "../../lib/dev-picker-demo.ts";
import { IS_DEV } from "../../lib/env.ts";
import { clearPasskeyManagementCookie } from "../../lib/passkey-management.ts";
import {
  hasOAuthCapabilities,
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

const SWITCH_SESSION_TIMEOUT_MS = 5_000;
const MAX_SWITCH_BODY_BYTES = 8_192;
const SWITCH_CONTEXT_FIELDS = [
  "did",
  "next",
  "intent",
  "choose",
  "capability",
  "action",
  "name",
] as const;

async function readInput(
  req: Request,
  url: URL,
): Promise<{
  did: string | null;
  next: string | null;
  intent: "user" | "project" | null;
  chooseAnotherAccount: boolean;
  capabilities: OAuthCapability[] | null;
  action: OAuthAction | null;
  targetName: string | null;
}> {
  const queryCapabilities = normalizeOAuthCapabilities(
    repeatedSearchValues(url.searchParams, "capability"),
  );
  const queryIntent = optionalEnum(
    singleSearchValue(url.searchParams, "intent"),
    ["user", "project"] as const,
  );
  const queryChoose = optionalEnum(
    singleSearchValue(url.searchParams, "choose"),
    ["another"] as const,
  );
  const rawQueryAction = singleSearchValue(url.searchParams, "action");
  if (rawQueryAction !== null && !isOAuthAction(rawQueryAction)) {
    throw new InvalidOAuthRequestInputError();
  }
  const queryAction = rawQueryAction;
  const queryTargetName = safeOAuthTargetName(
    singleSearchValue(url.searchParams, "name"),
  ) ?? null;
  const queryDid = singleSearchValue(url.searchParams, "did")?.trim() || null;
  const queryNext = optionalSafeRelativePath(
    singleSearchValue(url.searchParams, "next"),
  );
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const body = plainJsonRecord(
      await readJsonRequestWithLimit(req, MAX_SWITCH_BODY_BYTES),
    );
    rejectSearchJsonOverlap(url.searchParams, body, SWITCH_CONTEXT_FIELDS);
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
    const bodyChoose = optionalEnum(
      optionalJsonString(body, "choose"),
      [
        "another",
      ] as const,
    );
    return {
      did: optionalJsonString(body, "did")?.trim() || queryDid,
      next: optionalSafeRelativePath(optionalJsonString(body, "next")) ??
        queryNext,
      intent: bodyIntent ?? queryIntent,
      chooseAnotherAccount: bodyChoose === "another" ||
        queryChoose === "another",
      capabilities: bodyCapabilities
        ? normalizeOAuthCapabilities(bodyCapabilities)
        : queryCapabilities,
      action: bodyAction ?? queryAction,
      targetName: safeOAuthTargetName(optionalJsonString(body, "name")) ??
        queryTargetName,
    };
  }
  if (!req.body && !ct) {
    return {
      did: queryDid,
      next: queryNext,
      intent: queryIntent,
      chooseAnotherAccount: queryChoose === "another",
      capabilities: queryCapabilities,
      action: queryAction,
      targetName: queryTargetName,
    };
  }
  const form = await readFormDataRequestWithLimit(req, MAX_SWITCH_BODY_BYTES);
  if (!form) throw new InvalidOAuthRequestInputError();
  rejectSearchFormOverlap(url.searchParams, form, SWITCH_CONTEXT_FIELDS);
  const formIntent = optionalEnum(
    singleFormString(form, "intent"),
    [
      "user",
      "project",
    ] as const,
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
    did: singleFormString(form, "did")?.trim() || queryDid,
    next: optionalSafeRelativePath(singleFormString(form, "next")) ??
      queryNext,
    intent: formIntent ?? queryIntent,
    chooseAnotherAccount: formChoose === "another" ||
      queryChoose === "another",
    capabilities: formCapabilities.length > 0
      ? normalizeOAuthCapabilities(formCapabilities)
      : queryCapabilities,
    action: formAction ?? queryAction,
    targetName: safeOAuthTargetName(singleFormString(form, "name")) ??
      queryTargetName,
  };
}

export function buildSwitchReauthLocation(
  identifier: string,
  next: string | null,
  capabilities: readonly OAuthCapability[] = [],
  intent: "user" | "project" | null = null,
  action: OAuthAction | null = null,
  targetName: string | null = null,
  chooseAnotherAccount = false,
): string {
  const location = new URLSearchParams({ handle: identifier });
  if (next) location.set("next", next);
  if (intent) location.set("intent", intent);
  if (action) location.set("action", action);
  if (targetName) location.set("name", targetName);
  if (chooseAnotherAccount) location.set("choose", "another");
  for (const capability of capabilities) {
    location.append("capability", capability);
  }
  return `/oauth/login?${location.toString()}`;
}

export async function readSwitchInputForTest(
  req: Request,
): Promise<{ did: string | null; next: string | null }> {
  const { did, next } = await readInput(req, new URL(req.url));
  return { did, next };
}

/** Full parser view used by capability-preservation regression tests. */
export async function readSwitchAuthorizationInputForTest(
  req: Request,
): Promise<{
  did: string | null;
  next: string | null;
  intent: "user" | "project" | null;
  capabilities: OAuthCapability[] | null;
  action: OAuthAction | null;
  targetName: string | null;
  chooseAnotherAccount: boolean;
}> {
  const {
    did,
    next,
    intent,
    capabilities,
    action,
    targetName,
    chooseAnotherAccount,
  } = await readInput(
    req,
    new URL(req.url),
  );
  return {
    did,
    next,
    intent,
    capabilities,
    action,
    targetName,
    chooseAnotherAccount,
  };
}

function redirectToReauth(
  req: Request,
  identifier: string,
  next: string | null,
  capabilities: readonly OAuthCapability[],
  intent: "user" | "project" | null,
  action: OAuthAction | null,
  targetName: string | null,
  chooseAnotherAccount: boolean,
): Response {
  const headers = new Headers();
  headers.append("set-cookie", clearPasskeyManagementCookie());
  return browserHandoffResponse(
    buildSwitchReauthLocation(
      identifier,
      next,
      capabilities,
      intent,
      action,
      targetName,
      chooseAnotherAccount,
    ),
    {
      json: wantsBrowserHandoffJson(req),
      headers,
    },
  );
}

function switchedSessionHeaders(sessionCookie: string): Headers {
  const headers = new Headers();
  headers.append("set-cookie", sessionCookie);
  headers.append("set-cookie", clearPasskeyManagementCookie());
  return headers;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function handle(ctx: { req: Request }): Promise<Response> {
  const url = new URL(ctx.req.url);
  const proxied = await proxyAppviewApiResponse(url, ctx.req).catch((err) =>
    appviewUnavailable("oauth switch", err)
  );
  if (proxied) return proxied;

  const large = rejectLargeRequest(ctx.req, MAX_SWITCH_BODY_BYTES);
  if (large) return large;
  if (url.search.length > MAX_SWITCH_BODY_BYTES) {
    return browserHandoffError(
      "request URL too large",
      414,
      wantsBrowserHandoffJson(ctx.req),
    );
  }
  const wantsJson = wantsBrowserHandoffJson(ctx.req);
  let input: Awaited<ReturnType<typeof readInput>>;
  try {
    input = await readInput(ctx.req, url);
  } catch (error) {
    return browserHandoffError(
      error instanceof RequestBodyTooLargeError
        ? "request body too large"
        : "invalid authorization context",
      error instanceof RequestBodyTooLargeError ? 413 : 400,
      wantsJson,
    );
  }
  const {
    did,
    next,
    intent,
    capabilities,
    action,
    targetName,
    chooseAnotherAccount,
  } = input;
  if (!did) return browserHandoffError("missing did", 400, wantsJson);
  if (!capabilities) {
    return browserHandoffError("invalid capability", 400, wantsJson);
  }
  if (!isOAuthActionCapabilityRequest(action, capabilities)) {
    return browserHandoffError(
      "invalid action capability combination",
      400,
      wantsJson,
    );
  }

  const remembered = await readRememberedAccountsFromHeader(
    ctx.req.headers.get("cookie"),
  );
  const target = remembered.find((a) => a.did === did);
  if (!target) {
    return browserHandoffError(
      "account not remembered on this device",
      403,
      wantsJson,
    );
  }

  /**
   * The local picker demo deliberately uses synthetic handles and DIDs. They
   * have no public DNS record or OAuth refresh session, so sending them
   * through the normal re-auth fallback can only end in handle-resolution
   * failure. The remembered-account cookie is signed, and this shortcut is
   * disabled outside local development.
   */
  const devAccount = IS_DEV ? devPickerAccountForDid(target.did) : null;
  if (
    devAccount &&
    devAccount.handle.toLowerCase() === target.handle.toLowerCase()
  ) {
    const cookieValue = await createSession({
      did: devAccount.did,
      handle: devAccount.handle,
    });
    // Mint the replacement before deleting the current row. A transient DB
    // failure must not sign the person out of the account they already had.
    try {
      await destroySession(ctx.req);
    } catch (error) {
      return appviewUnavailable("oauth switch session rotation", error);
    }
    return browserHandoffResponse(next ?? "/account", {
      json: wantsJson,
      headers: switchedSessionHeaders(buildSessionCookie(cookieValue)),
    });
  }

  /** Try refreshing the OAuth tokens for this DID. If anything goes
   *  wrong (revoked refresh token, server-side row evicted, PDS
   *  unreachable) bounce to /oauth/login with a login_hint so the
   *  user gets a one-step re-auth instead of a confusing error. */
  const oauthSession = await withTimeout(
    getValidSession(did, { quiet: true }).catch(() => null),
    SWITCH_SESSION_TIMEOUT_MS,
  );
  if (!oauthSession) {
    return redirectToReauth(
      ctx.req,
      target.did,
      next,
      capabilities,
      intent,
      action,
      targetName,
      chooseAnotherAccount,
    );
  }
  if (
    !hasOAuthCapabilities(
      grantedScopeForSession(oauthSession),
      capabilities,
    )
  ) {
    return redirectToReauth(
      ctx.req,
      target.did,
      next,
      capabilities,
      intent,
      action,
      targetName,
      chooseAnotherAccount,
    );
  }

  const cookieValue = await createSession({
    did: oauthSession.did,
    handle: oauthSession.handle,
  });
  /** Drop the previous app session row only after its replacement exists.
   *  The response cookie points at the new row. */
  try {
    await destroySession(ctx.req);
  } catch (error) {
    return appviewUnavailable("oauth switch session rotation", error);
  }
  const accountType = await getEffectiveAccountType(oauthSession.did).catch(
    () => null,
  );

  return browserHandoffResponse(
    next ??
      (intent === "project" && accountType !== "project"
        ? "/account?upgrade=app"
        : (accountType === "project"
          ? "/apps/manage"
          : accountType === "user"
          ? "/account"
          : "/account/type")),
    {
      json: wantsJson,
      headers: switchedSessionHeaders(buildSessionCookie(cookieValue)),
    },
  );
}

export const handler = define.handlers({ POST: handle });

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Account switching is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
