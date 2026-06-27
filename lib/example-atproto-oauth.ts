import { IS_DEV, sessionSecret } from "./env.ts";
import { b64uDecode, b64uEncode, hmacSign, hmacVerify } from "./jose.ts";
import {
  type CallbackResult,
  completeCallback,
  isOAuthConfigured,
  startLogin,
} from "./oauth.ts";

const EXAMPLE_SESSION_COOKIE = "atmo_example_app";
const EXAMPLE_SESSION_TTL_SEC = 30 * 60;
export const EXAMPLE_ATPROTO_OAUTH_SCOPE = "atproto";

export interface ExampleAppSession {
  did: string;
  handle: string;
  pdsUrl: string;
  signedInAt: number;
}

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

export function exampleOAuthLoginHint(input: {
  handle?: string | null;
  did?: string | null;
}): string | null {
  return input.handle?.trim() || input.did?.trim() || null;
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
): Promise<{ redirectUrl: string }> {
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
}): Promise<CallbackResult> {
  return await completeCallback(params);
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
