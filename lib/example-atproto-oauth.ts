import { IS_DEV, sessionSecret } from "./env.ts";
import type { AtmosphereSelectionReplayStore } from "./atmosphere-login-sdk.ts";
import { createDbSelectionReplayStore } from "./atmosphere-login-replay.ts";
import {
  b64uDecode,
  b64uEncode,
  hmacSign,
  hmacVerify,
  randomB64u,
} from "./jose.ts";
import {
  type CallbackResult,
  cancelOAuthFlow,
  completeCallback,
  isOAuthConfigured,
  startLogin,
} from "./oauth.ts";

const EXAMPLE_SESSION_COOKIE = "atmo_example_app";
const EXAMPLE_SESSION_TTL_SEC = 30 * 60;
const EXAMPLE_LOGIN_STATE_TTL_SEC = 15 * 60;
const EXAMPLE_REPLAY_MAX_ENTRIES = 500;
const EXAMPLE_LOGIN_STATE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
export const EXAMPLE_ATPROTO_OAUTH_SCOPE = "atproto";

export interface ExampleAppSession {
  did: string;
  handle: string;
  pdsUrl: string;
  signedInAt: number;
  oauthMode?: "real" | "dev_simulated";
}

const ATMOSPHERE_LOGIN_DYNAMIC_CALLBACK_PARAMS = [
  "selection_token",
  "client_id",
  "state",
  "did",
  "handle",
  "iss",
  "inspect",
  "handoff",
];

export function exampleAtmosphereLoginClientId(origin: string): string {
  return new URL(
    "/examples/atmosphere-login/client-metadata.json",
    origin,
  ).toString();
}

export function exampleAtmosphereLoginCallbackUri(origin: string): string {
  return new URL("/examples/atmosphere-login/callback", origin).toString();
}

export function exampleAtmosphereLoginPopupCallbackUri(
  origin: string,
): string {
  const url = new URL("/examples/atmosphere-login/callback", origin);
  url.searchParams.set("mode", "popup");
  return url.toString();
}

export function exampleAtmosphereLoginVerifiedReturnUri(url: URL): string {
  const out = new URL(url);
  out.hash = "";
  for (const param of ATMOSPHERE_LOGIN_DYNAMIC_CALLBACK_PARAMS) {
    out.searchParams.delete(param);
  }
  return out.toString();
}

export function isExampleAtmosphereLoginPopupCallback(url: URL): boolean {
  return url.searchParams.get("mode") === "popup";
}

export function isExampleAtmosphereLoginPopupHandoff(url: URL): boolean {
  return url.searchParams.get("handoff") === "1";
}

export function createMemorySelectionReplayStore(
  maxEntries = EXAMPLE_REPLAY_MAX_ENTRIES,
  nowSec = () => Math.floor(Date.now() / 1000),
): AtmosphereSelectionReplayStore {
  const seen = new Map<string, number>();
  const prune = () => {
    const now = nowSec();
    for (const [jti, expiresAtSec] of seen) {
      if (expiresAtSec <= now) seen.delete(jti);
    }
    if (seen.size <= maxEntries) return;
    const oldest = [...seen.entries()].sort((a, b) => a[1] - b[1]);
    for (const [jti] of oldest.slice(0, seen.size - maxEntries)) {
      seen.delete(jti);
    }
  };
  return {
    has(jti: string): boolean {
      prune();
      return seen.has(jti);
    },
    add(jti: string, expiresAtSec: number): void {
      prune();
      seen.set(jti, expiresAtSec);
    },
  };
}

export const exampleSelectionReplayStore = createDbSelectionReplayStore();

export function exampleAtprotoOAuthClientId(origin: string): string {
  return new URL(
    "/examples/atmosphere-login/oauth/client-metadata.json",
    origin,
  ).toString();
}

export function exampleAtprotoOAuthCallbackUri(origin: string): string {
  return new URL(
    "/examples/atmosphere-login/oauth/callback",
    origin,
  ).toString();
}

export function buildExampleOAuthStartPath(input: {
  handle?: string | null;
  did?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.handle) params.set("handle", input.handle);
  if (input.did) params.set("did", input.did);
  return `/examples/atmosphere-login/oauth/start?${params.toString()}`;
}

function exampleLoginStateCookieName(state: string): string | null {
  if (!EXAMPLE_LOGIN_STATE_PATTERN.test(state)) return null;
  return `${
    IS_DEV ? "atmo_example_state_" : "__Host-atmo_example_state_"
  }${state}`;
}

function exampleLoginStateCookieFlags(maxAge: number): string[] {
  const flags = [
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (!IS_DEV) flags.push("Secure");
  return flags;
}

/** Server-retained state for the reference relying app. The SDK receives the
 * public state value, while the callback proves that this browser opened it by
 * returning the host-only, HMAC-protected cookie. */
export async function buildExampleLoginState(): Promise<{
  state: string;
  cookie: string;
}> {
  const state = randomB64u(24);
  const name = exampleLoginStateCookieName(state);
  if (!name) throw new Error("could not create example login state");
  const signature = await hmacSign(sessionSecret(), state);
  return {
    state,
    cookie: `${name}=${state}.${signature}; ${
      exampleLoginStateCookieFlags(EXAMPLE_LOGIN_STATE_TTL_SEC).join("; ")
    }`,
  };
}

export async function readExampleLoginState(
  req: Request,
  state: string,
): Promise<string | null> {
  const name = exampleLoginStateCookieName(state);
  const header = req.headers.get("cookie");
  if (!name || !header) return null;
  const values = header.split(";").map((part) => part.trim()).filter((part) =>
    part.startsWith(`${name}=`)
  );
  if (values.length !== 1) return null;
  let value: string;
  try {
    value = decodeURIComponent(values[0].slice(name.length + 1));
  } catch {
    return null;
  }
  const dot = value.lastIndexOf(".");
  if (dot < 0 || value.slice(0, dot) !== state) return null;
  const signature = value.slice(dot + 1);
  return signature && await hmacVerify(sessionSecret(), state, signature)
    ? state
    : null;
}

export function clearExampleLoginStateCookie(state: string): string | null {
  const name = exampleLoginStateCookieName(state);
  return name
    ? `${name}=; ${exampleLoginStateCookieFlags(0).join("; ")}`
    : null;
}

export function exampleOAuthLoginHint(input: {
  handle?: string | null;
  did?: string | null;
}): string | null {
  return input.handle?.trim() || input.did?.trim() || null;
}

export function isExampleLocalDevSelection(input: {
  handle?: string | null;
  did?: string | null;
  dev?: boolean;
}): boolean {
  if (!(input.dev ?? IS_DEV)) return false;
  const handle = input.handle?.trim().toLowerCase() ?? "";
  const did = input.did?.trim().toLowerCase() ?? "";
  return handle.endsWith(".test") || did.startsWith("did:plc:aalocal");
}

export function isExampleOAuthConfigured(origin: string): boolean {
  return isOAuthConfigured({
    clientId: exampleAtprotoOAuthClientId(origin),
    redirectUri: exampleAtprotoOAuthCallbackUri(origin),
    scope: EXAMPLE_ATPROTO_OAUTH_SCOPE,
  });
}

export async function startExampleAtprotoOAuth(
  origin: string,
  loginHint: string,
): Promise<{ redirectUrl: string; state: string; browserBinding: string }> {
  return await startLogin(
    loginHint,
    "/examples/atmosphere-login/app",
    null,
    {
      clientId: exampleAtprotoOAuthClientId(origin),
      redirectUri: exampleAtprotoOAuthCallbackUri(origin),
      scope: EXAMPLE_ATPROTO_OAUTH_SCOPE,
      persistSession: false,
    },
  );
}

export async function completeExampleAtprotoOAuthCallback(params: {
  state: string;
  code: string;
  iss: string;
  origin: string;
  browserBinding: string;
}): Promise<CallbackResult> {
  return await completeCallback(params, {
    clientId: exampleAtprotoOAuthClientId(params.origin),
    redirectUri: exampleAtprotoOAuthCallbackUri(params.origin),
  }, params.browserBinding);
}

export async function cancelExampleAtprotoOAuth(
  state: string,
  origin: string,
  browserBinding: string,
): Promise<boolean> {
  return Boolean(
    await cancelOAuthFlow(state, {
      clientId: exampleAtprotoOAuthClientId(origin),
      redirectUri: exampleAtprotoOAuthCallbackUri(origin),
    }, browserBinding),
  );
}

export async function buildExampleAppSessionCookie(
  input: Omit<ExampleAppSession, "signedInAt">,
): Promise<string> {
  const session: ExampleAppSession = {
    ...input,
    signedInAt: Date.now(),
  };
  const payload = b64uEncode(JSON.stringify(session));
  const sig = await hmacSign(sessionSecret(), payload);
  const flags = [
    `Path=/examples/atmosphere-login`,
    `Max-Age=${EXAMPLE_SESSION_TTL_SEC}`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (!IS_DEV) flags.push("Secure");
  return `${EXAMPLE_SESSION_COOKIE}=${payload}.${sig}; ${flags.join("; ")}`;
}

export function clearExampleAppSessionCookie(): string {
  const flags = [
    `Path=/examples/atmosphere-login`,
    `Max-Age=0`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (!IS_DEV) flags.push("Secure");
  return `${EXAMPLE_SESSION_COOKIE}=; ${flags.join("; ")}`;
}

export async function readExampleAppSession(
  req: Request,
): Promise<ExampleAppSession | null> {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const target = cookieHeader.split(";").map((cookie) => cookie.trim()).find(
    (cookie) => cookie.startsWith(`${EXAMPLE_SESSION_COOKIE}=`),
  );
  if (!target) return null;
  const value = decodeURIComponent(
    target.slice(EXAMPLE_SESSION_COOKIE.length + 1),
  );
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  if (!await hmacVerify(sessionSecret(), payload, sig)) return null;
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(b64uDecode(payload)),
    ) as Partial<ExampleAppSession>;
    if (
      typeof parsed.did !== "string" ||
      typeof parsed.handle !== "string" ||
      typeof parsed.pdsUrl !== "string" ||
      typeof parsed.signedInAt !== "number"
    ) {
      return null;
    }
    if (
      parsed.oauthMode !== undefined &&
      parsed.oauthMode !== "real" &&
      parsed.oauthMode !== "dev_simulated"
    ) {
      return null;
    }
    if (
      parsed.signedInAt + EXAMPLE_SESSION_TTL_SEC * 1000 <
        Date.now()
    ) {
      return null;
    }
    return parsed as ExampleAppSession;
  } catch {
    return null;
  }
}
