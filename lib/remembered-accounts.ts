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
import { IS_DEV, loginOrigin, sessionSecret, siteOrigin } from "./env.ts";

export interface RememberedAccount {
  did: string;
  handle: string;
  pdsUrl?: string | null;
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
  return await readRememberedAccountsFromHeader(req.headers.get("cookie"));
}

/** Same as `readRememberedAccounts` but takes the raw cookie header
 *  directly. Used by routes that need to compute the next cookie value
 *  off the existing one (e.g. callback / switch / forget). */
export async function readRememberedAccountsFromHeader(
  cookieHeader: string | null,
): Promise<RememberedAccount[]> {
  const raw = readCookieValues(cookieHeader);
  if (raw.length === 0) return [];
  return await parseSignedValues(raw);
}

/** Build a Set-Cookie header that adds `account` to the remembered
 *  list (or refreshes its position) and returns the new cookie. The
 *  most-recently-active account is sorted to the front, capped at
 *  `MAX_ACCOUNTS`. */
export async function addRememberedAccountCookie(
  current: RememberedAccount[],
  account: RememberedAccount,
): Promise<string> {
  return (await addRememberedAccountCookies(current, account)).at(-1) ?? "";
}

export async function addRememberedAccountCookies(
  current: RememberedAccount[],
  account: RememberedAccount,
): Promise<string[]> {
  const filtered = current.filter((a) => a.did !== account.did);
  const next = [account, ...filtered].slice(0, MAX_ACCOUNTS);
  return withLegacyHostOnlyClear(await buildCookie(next));
}

/**
 * Reissue an already-verified remembered-account list using the current cookie
 * scope. This upgrades older host-only cookies to the shared production domain
 * so the standalone login subdomain can offer the same accounts.
 */
export async function refreshRememberedAccountCookies(
  current: RememberedAccount[],
): Promise<string[]> {
  const next = current.slice(0, MAX_ACCOUNTS);
  if (next.length === 0) return [];
  return withLegacyHostOnlyClear(await buildCookie(next));
}

/** Build a Set-Cookie header that removes `did` from the remembered
 *  list. If the resulting list is empty, the cookie is cleared
 *  outright instead of being signed-empty. */
export async function removeRememberedAccountCookie(
  current: RememberedAccount[],
  did: string,
): Promise<string> {
  return (await removeRememberedAccountCookies(current, did)).at(-1) ?? "";
}

export async function removeRememberedAccountCookies(
  current: RememberedAccount[],
  did: string,
): Promise<string[]> {
  const next = current.filter((a) => a.did !== did);
  if (next.length === 0) return clearRememberedAccountsCookies();
  return withLegacyHostOnlyClear(await buildCookie(next));
}

/** Set-Cookie value that clears the cookie. Sent on logout flows
 *  that should also wipe device memory (we don't currently use this
 *  on the standard sign-out — only when explicitly forgetting all
 *  accounts). */
export function clearRememberedAccountsCookie(): string {
  return clearRememberedAccountsCookies().at(-1) ?? "";
}

export function clearRememberedAccountsCookies(): string[] {
  const flags = rememberedAccountsCookieFlags(0);
  return withLegacyHostOnlyClear(`${COOKIE_NAME}=; ${flags.join("; ")}`);
}

/* ---------------- internals ---------------- */

function readCookieValues(cookieHeader: string | null): string[] {
  if (!cookieHeader) return [];
  const values: string[] = [];
  for (const cookie of cookieHeader.split(";").map((c) => c.trim())) {
    if (!cookie.startsWith(`${COOKIE_NAME}=`)) continue;
    try {
      values.push(decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)));
    } catch {
      // Ignore just this malformed cookie; another scoped cookie may be valid.
    }
  }
  return values;
}

async function parseSignedValues(
  values: string[],
): Promise<RememberedAccount[]> {
  const out: RememberedAccount[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const accounts = await parseSignedValue(value);
    for (const account of accounts) {
      if (seen.has(account.did)) continue;
      seen.add(account.did);
      out.push(account);
      if (out.length >= MAX_ACCOUNTS) return out;
    }
  }
  return out;
}

async function parseSignedValue(value: string): Promise<RememberedAccount[]> {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return [];
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!payload || !sig) return [];

  const ok = await hmacVerify(sessionSecret(), payload, sig).catch(() => false);
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
    const pdsUrl = (item as Record<string, unknown>).pdsUrl;
    if (typeof did !== "string" || typeof handle !== "string") continue;
    if (!did.startsWith("did:")) continue;
    if (seen.has(did)) continue;
    seen.add(did);
    out.push({
      did,
      handle,
      pdsUrl: typeof pdsUrl === "string" && pdsUrl ? pdsUrl : null,
    });
    if (out.length >= MAX_ACCOUNTS) break;
  }
  return out;
}

async function buildCookie(accounts: RememberedAccount[]): Promise<string> {
  const json = JSON.stringify(
    accounts.map((a) => ({
      did: a.did,
      handle: a.handle,
      ...(a.pdsUrl ? { pdsUrl: a.pdsUrl } : {}),
    })),
  );
  const payload = b64uEncodeBytes(new TextEncoder().encode(json));
  const sig = await hmacSign(sessionSecret(), payload);
  const value = `${payload}.${sig}`;
  const flags = rememberedAccountsCookieFlags(COOKIE_MAX_AGE_SEC);
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; ${flags.join("; ")}`;
}

function rememberedAccountsCookieFlags(
  maxAgeSec: number,
  options: {
    dev?: boolean;
    site?: string;
    login?: string;
  } = {},
): string[] {
  const dev = options.dev ?? IS_DEV;
  const flags = [
    "Path=/",
    `Max-Age=${maxAgeSec}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  const domain = rememberedAccountsCookieDomain({
    dev,
    site: options.site ?? siteOrigin(),
    login: options.login ?? loginOrigin(),
  });
  if (domain) flags.push(`Domain=${domain}`);
  if (!dev) flags.push("Secure");
  return flags;
}

function legacyHostOnlyRememberedAccountsClearCookie(
  options: {
    dev?: boolean;
    site?: string;
    login?: string;
  } = {},
): string | null {
  const dev = options.dev ?? IS_DEV;
  const site = options.site ?? siteOrigin();
  const login = options.login ?? loginOrigin();
  const flags = rememberedAccountsCookieFlags(0, { dev, site, login }).filter(
    (flag) => !flag.startsWith("Domain="),
  );
  return rememberedAccountsCookieDomain({
      dev,
      site,
      login,
    })
    ? `${COOKIE_NAME}=; ${flags.join("; ")}`
    : null;
}

function withLegacyHostOnlyClear(cookie: string): string[] {
  const legacyClear = legacyHostOnlyRememberedAccountsClearCookie();
  return legacyClear ? [legacyClear, cookie] : [cookie];
}

function rememberedAccountsCookieDomain(
  options: { dev: boolean; site: string; login: string },
): string | null {
  if (options.dev) return null;
  const siteHost = hostname(options.site);
  const loginHost = hostname(options.login);
  if (!siteHost || !loginHost || siteHost === loginHost) return null;
  const domain = loginHost.endsWith(`.${siteHost}`)
    ? siteHost
    : siteHost.endsWith(`.${loginHost}`)
    ? loginHost
    : null;
  if (!domain || !domain.includes(".") || domain.includes(":")) return null;
  return /^[a-z0-9.-]+$/.test(domain) ? domain : null;
}

function hostname(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function rememberedAccountsCookieDomainForTest(
  site: string,
  login: string,
  dev: boolean,
): string | null {
  return rememberedAccountsCookieDomain({ site, login, dev });
}

export function rememberedAccountsCookieFlagsForTest(
  maxAgeSec: number,
  options: { dev: boolean; site: string; login: string },
): string[] {
  return rememberedAccountsCookieFlags(maxAgeSec, options);
}

export function legacyHostOnlyRememberedAccountsClearCookieForTest(
  options: { dev: boolean; site: string; login: string },
): string | null {
  return legacyHostOnlyRememberedAccountsClearCookie(options);
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
