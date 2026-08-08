import { IS_DEV } from "./env.ts";

const OAUTH_FLOW_COOKIE_TTL_SEC = 10 * 60;
const STATE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const BINDING_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function cookieName(state: string): string | null {
  if (!STATE_PATTERN.test(state)) return null;
  return `${IS_DEV ? "atmo_oauth_" : "__Host-atmo_oauth_"}${state}`;
}

function cookieFlags(maxAge: number): string[] {
  const flags = [
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (!IS_DEV) flags.push("Secure");
  return flags;
}

/**
 * Bind one OAuth state record to the browser that initiated it. A distinct,
 * host-only cookie per state preserves parallel sign-in tabs while preventing
 * an authorization response obtained in an attacker's browser from creating
 * a session in somebody else's browser.
 */
export function buildOAuthFlowBindingCookie(
  state: string,
  binding: string,
): string {
  const name = cookieName(state);
  if (!name || !BINDING_PATTERN.test(binding)) {
    throw new Error("invalid OAuth browser binding");
  }
  return `${name}=${binding}; ${
    cookieFlags(OAUTH_FLOW_COOKIE_TTL_SEC).join("; ")
  }`;
}

export function clearOAuthFlowBindingCookie(state: string): string | null {
  const name = cookieName(state);
  return name ? `${name}=; ${cookieFlags(0).join("; ")}` : null;
}

export function readOAuthFlowBindingCookie(
  req: Request,
  state: string,
): string | null {
  const name = cookieName(state);
  const header = req.headers.get("cookie");
  if (!name || !header) return null;
  const values: string[] = [];
  for (const part of header.split(";")) {
    const cookie = part.trim();
    if (!cookie.startsWith(`${name}=`)) continue;
    try {
      values.push(decodeURIComponent(cookie.slice(name.length + 1)));
    } catch {
      return null;
    }
  }
  if (values.length !== 1 || !BINDING_PATTERN.test(values[0])) return null;
  return values[0];
}

export function oauthFlowCookieTtlSecForTest(): number {
  return OAUTH_FLOW_COOKIE_TTL_SEC;
}
