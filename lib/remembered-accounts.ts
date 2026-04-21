/**
 * Per-device "remembered accounts" cookie. Powers the in-menu account
 * switcher: every successful OAuth callback appends the (did, handle)
 * pair to a long-lived HMAC-signed cookie so subsequent visits can
 * offer one-click switching between accounts the user has signed in
 * with on this browser.
 *
 * The cookie carries no secrets — just identifiers — but is signed so
 * a tampered payload can't trick the server into surfacing accounts
 * the user never authenticated as. Authority for actually switching
 * still flows through the OAuth session row keyed by DID; the cookie
 * is only used to drive UI and to gate which DIDs the switch handler
 * is willing to act on without bouncing through PAR again.
 *
 * Cookie format: `<base64url(JSON)>.<hmac>`
 * Cookie name:   `atmo_accounts`
 */
import { hmacSign, hmacVerify } from "./jose.ts";
import { IS_DEV, SESSION_SECRET } from "./env.ts";

export interface RememberedAccount {
  did: string;
  handle: string;
}

const COOKIE_NAME = "atmo_accounts";
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365; // 1 year
const MAX_ACCOUNTS = 8;

/** Read + verify the remembered-accounts cookie from a request. Returns
 *  an empty list when the cookie is missing, malformed, expired, or
 *  has a bad signature. */
export async function readRememberedAccounts(
  req: Request,
): Promise<RememberedAccount[]> {
  const raw = readCookieValue(req.headers.get("cookie"));
  if (!raw) return [];
  return await parseSignedValue(raw);
}

/** Same as `readRememberedAccounts` but takes the raw cookie header
 *  directly. Used by routes that need to compute the next cookie value
 *  off the existing one (e.g. callback / switch / forget). */
export async function readRememberedAccountsFromHeader(
  cookieHeader: string | null,
): Promise<RememberedAccount[]> {
  const raw = readCookieValue(cookieHeader);
  if (!raw) return [];
  return await parseSignedValue(raw);
}

/** Build a Set-Cookie header that adds `account` to the remembered
 *  list (or refreshes its position) and returns the new cookie. The
 *  most-recently-active account is sorted to the front, capped at
 *  `MAX_ACCOUNTS`. */
export async function addRememberedAccountCookie(
  current: RememberedAccount[],
  account: RememberedAccount,
): Promise<string> {
  const filtered = current.filter((a) => a.did !== account.did);
  const next = [account, ...filtered].slice(0, MAX_ACCOUNTS);
  return await buildCookie(next);
}

/** Build a Set-Cookie header that removes `did` from the remembered
 *  list. If the resulting list is empty, the cookie is cleared
 *  outright instead of being signed-empty. */
export async function removeRememberedAccountCookie(
  current: RememberedAccount[],
  did: string,
): Promise<string> {
  const next = current.filter((a) => a.did !== did);
  if (next.length === 0) return clearRememberedAccountsCookie();
  return await buildCookie(next);
}

/** Set-Cookie value that clears the cookie. Sent on logout flows
 *  that should also wipe device memory (we don't currently use this
 *  on the standard sign-out — only when explicitly forgetting all
 *  accounts). */
export function clearRememberedAccountsCookie(): string {
  const flags = ["Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (!IS_DEV) flags.push("Secure");
  return `${COOKIE_NAME}=; ${flags.join("; ")}`;
}

/* ---------------- internals ---------------- */

function readCookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const target = cookieHeader.split(";").map((c) => c.trim()).find((c) =>
    c.startsWith(`${COOKIE_NAME}=`)
  );
  if (!target) return null;
  return decodeURIComponent(target.slice(COOKIE_NAME.length + 1));
}

async function parseSignedValue(value: string): Promise<RememberedAccount[]> {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return [];
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!payload || !sig) return [];

  const ok = await hmacVerify(SESSION_SECRET, payload, sig).catch(() => false);
  if (!ok) return [];

  let parsed: unknown;
  try {
    const json = new TextDecoder().decode(b64uDecodeBytes(payload));
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RememberedAccount[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const did = (item as Record<string, unknown>).did;
    const handle = (item as Record<string, unknown>).handle;
    if (typeof did !== "string" || typeof handle !== "string") continue;
    if (!did.startsWith("did:")) continue;
    if (seen.has(did)) continue;
    seen.add(did);
    out.push({ did, handle });
    if (out.length >= MAX_ACCOUNTS) break;
  }
  return out;
}

async function buildCookie(accounts: RememberedAccount[]): Promise<string> {
  const json = JSON.stringify(
    accounts.map((a) => ({ did: a.did, handle: a.handle })),
  );
  const payload = b64uEncodeBytes(new TextEncoder().encode(json));
  const sig = await hmacSign(SESSION_SECRET, payload);
  const value = `${payload}.${sig}`;
  const flags = [
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SEC}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (!IS_DEV) flags.push("Secure");
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; ${flags.join("; ")}`;
}

/* Local base64url helpers — kept here (rather than importing from
 * jose) to keep this module dependency-light. */
function b64uEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

function b64uDecodeBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "====".slice(padded.length % 4);
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
