/**
 * App-level session for the registry. After OAuth completes we mint a
 * random session ID, store the (DID, handle) pair in the `app_session`
 * table, and set an httpOnly cookie holding `<sid>.<hmac>`.
 *
 * The OAuth tokens themselves never leave the server.
 */
import { define } from "../utils.ts";
import { withDb } from "./db.ts";
import { hmacSign, hmacVerify, randomB64u } from "./jose.ts";
import { IS_DEV, sessionSecret } from "./env.ts";
import { readRememberedAccounts } from "./remembered-accounts.ts";
import { getEffectiveAccountType } from "./account-types.ts";
import {
  lookupAccountHost,
  lookupAccountHostHint,
  pinnedSeededAccountHostNames,
} from "./account-hosts.ts";
import { loadSession } from "./oauth.ts";

export interface SessionUser {
  did: string;
  handle: string;
  /** True when this DID controls a live app listing. */
  hasManagedAppProfile?: boolean;
  /** True when this DID owns at least one verified account-host claim. */
  hasManagedHostProfiles?: boolean;
  /** True when this DID currently manages a live app or claimed host. */
  hasManagedProfiles?: boolean;
}

const SESSION_COOKIE = "atmo_sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_SELF_CONTAINED_HOST_CLAIM_METHODS = [
  "dns_txt",
  "atproto_handle",
  "pds_contact_email",
] as const;
const SESSION_ORDINARY_HOST_SOURCES = ["manual", "observed"] as const;
const SESSION_PINNED_HOSTS = new Set(pinnedSeededAccountHostNames());

export interface SessionHostClaimCandidate {
  host: string;
  method: string;
  source: string | null | undefined;
}

/**
 * Network-free policy behind the global Apps and hosts menu hint. Exact
 * account/management pages perform the deeper seeded-host DID revalidation.
 */
export function sessionHostClaimCanSetMenuFlag(
  claim: SessionHostClaimCandidate,
  isDev = IS_DEV,
): boolean {
  const host = claim.host.trim().toLowerCase();
  if (!host) return false;
  if (
    SESSION_SELF_CONTAINED_HOST_CLAIM_METHODS.some((method) =>
      method === claim.method
    )
  ) return true;
  if (claim.method === "local_dev_fixture") {
    return isDev && host.endsWith(".test");
  }
  return claim.method === "oauth_atproto_account" &&
    SESSION_ORDINARY_HOST_SOURCES.some((source) => source === claim.source) &&
    !SESSION_PINNED_HOSTS.has(host);
}

function sqlStringList(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}

/**
 * Keep the global account menu's host-management hint conservative and cheap.
 * DNS, exact AT Protocol host-identity, and grandfathered email claims are
 * self-contained proof. Ordinary legacy OAuth claims remain usable, but
 * curated seeded hosts need a live DID re-resolution and are therefore left
 * to exact account/management pages.
 * Local fixture claims are valid only for `.test` hosts in a real dev process.
 */
export function sessionManagedHostOwnershipSql(isDev = IS_DEV): string {
  const localFixtureRuntime = isDev ? "1 = 1" : "1 = 0";
  const selfContainedMethods = sqlStringList(
    SESSION_SELF_CONTAINED_HOST_CLAIM_METHODS,
  );
  const ordinarySources = sqlStringList(SESSION_ORDINARY_HOST_SOURCES);
  const pinnedHosts = sqlStringList([...SESSION_PINNED_HOSTS]);
  return `EXISTS (
    SELECT 1
    FROM account_host_claim claim
    INNER JOIN account_host host ON host.host = claim.host
    WHERE claim.claimant_did = s.did
      AND claim.verified_at IS NOT NULL
      AND (
        claim.method IN (${selfContainedMethods})
        OR (
          claim.method = 'oauth_atproto_account'
          AND host.source IN (${ordinarySources})
          AND lower(host.host) NOT IN (${pinnedHosts})
        )
        OR (
          claim.method = 'local_dev_fixture'
          AND ${localFixtureRuntime}
          AND lower(host.host) LIKE '%.test'
        )
      )
  )`;
}

export const SESSION_LOOKUP_SQL = `SELECT s.did, s.handle, s.expires_at,
  EXISTS (
    SELECT 1
    FROM app_listing listing
    WHERE listing.deleted_at IS NULL
      AND (
        listing.product_did = s.did
        OR listing.profile_did = s.did
        OR listing.legacy_profile_did = s.did
      )
  ) AS has_managed_app_profile,
  ${sessionManagedHostOwnershipSql()} AS has_managed_host_profiles
  FROM app_session s
  WHERE s.id = ?`;

function readCookieValue(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const target = cookieHeader.split(";").map((c) => c.trim()).find((c) =>
    c.startsWith(`${name}=`)
  );
  if (!target) return null;
  try {
    return decodeURIComponent(target.slice(name.length + 1));
  } catch {
    return null;
  }
}

export async function createSession(user: SessionUser): Promise<string> {
  const sid = randomB64u(24);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await withDb(async (c) => {
    await c.execute({
      sql:
        `INSERT INTO app_session (id, did, handle, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
      args: [sid, user.did, user.handle, Date.now(), expiresAt],
    });
  });
  const sig = await hmacSign(sessionSecret(), sid);
  return `${sid}.${sig}`;
}

/**
 * Read the active session user from a request without going through
 * the middleware. Useful for endpoints that run before/around the
 * normal middleware chain (e.g. /oauth/forget needs to know whether
 * to clear the session cookie even though it doesn't have a fresh
 * `ctx.state`).
 */
export async function peekSessionUser(
  req: Request,
): Promise<SessionUser | null> {
  return await readSessionCookie(req);
}

async function readSessionCookie(req: Request): Promise<SessionUser | null> {
  const value = readCookieValue(req, SESSION_COOKIE);
  if (!value) return null;
  const [sid, sig] = value.split(".");
  if (!sid || !sig) return null;
  const ok = await hmacVerify(sessionSecret(), sid, sig);
  if (!ok) return null;

  return await withDb(async (c) => {
    const r = await c.execute({
      sql: SESSION_LOOKUP_SQL,
      args: [sid],
    });
    if (r.rows.length === 0) return null;
    const row = r.rows[0] as Record<string, unknown>;
    if (Number(row.expires_at) < Date.now()) {
      await c.execute({
        sql: `DELETE FROM app_session WHERE id = ?`,
        args: [sid],
      });
      return null;
    }
    const hasManagedAppProfile = databaseBoolean(
      row.has_managed_app_profile,
    );
    const hasManagedHostProfiles = databaseBoolean(
      row.has_managed_host_profiles,
    );
    return {
      did: String(row.did),
      handle: String(row.handle),
      hasManagedAppProfile,
      hasManagedHostProfiles,
      hasManagedProfiles: hasManagedAppProfile || hasManagedHostProfiles,
    };
  });
}

export function databaseBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === 1n || value === "1" ||
    value === "true";
}

export async function destroySession(req: Request): Promise<void> {
  const value = readCookieValue(req, SESSION_COOKIE);
  if (!value) return;
  const [sid, sig] = value.split(".");
  if (!sid || !sig) return;
  const ok = await hmacVerify(sessionSecret(), sid, sig);
  if (!ok) return;
  await withDb(async (c) => {
    await c.execute({
      sql: `DELETE FROM app_session WHERE id = ?`,
      args: [sid],
    });
  });
}

export function buildSessionCookie(value: string): string {
  const flags = [
    `Path=/`,
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (!IS_DEV) flags.push("Secure");
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; ${flags.join("; ")}`;
}

export function clearSessionCookie(): string {
  const flags = [`Path=/`, `Max-Age=0`, `HttpOnly`, `SameSite=Lax`];
  if (!IS_DEV) flags.push("Secure");
  return `${SESSION_COOKIE}=; ${flags.join("; ")}`;
}

export function shouldHydrateAccountDetails(
  pathname: string,
  appviewConfigured = isAppviewConfigured(),
  appviewOrigin = false,
): boolean {
  if (!appviewConfigured) return true;
  if (appviewOrigin) return true;
  return pathname.startsWith("/dev/");
}

function configuredAppviewUrl(): URL | null {
  const raw = Deno.env.get("ATMOSPHERE_APPVIEW_URL")?.trim() ||
    Deno.env.get("APPVIEW_BASE_URL")?.trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isAppviewConfigured(): boolean {
  return configuredAppviewUrl() !== null;
}

function isAppviewOrigin(origin: string): boolean {
  return configuredAppviewUrl()?.origin === origin;
}

/**
 * Hydrates `ctx.state.user` from the session cookie. Always returns a
 * value (possibly null) so downstream code can rely on the property
 * being present.
 */
export const sessionMiddleware = define.middleware(async (ctx) => {
  const rememberedAccountsPromise = readRememberedAccounts(ctx.req).catch(
    (err) => {
      if (IS_DEV) console.warn("remembered accounts read failed:", err);
      return [];
    },
  );
  try {
    ctx.state.user = await readSessionCookie(ctx.req);
    const rememberedAccounts = await rememberedAccountsPromise;
    ctx.state.rememberedAccounts = rememberedAccounts;

    if (
      ctx.state.user &&
      shouldHydrateAccountDetails(
        ctx.url.pathname,
        isAppviewConfigured(),
        isAppviewOrigin(ctx.url.origin),
      )
    ) {
      const accountTypePromise = getEffectiveAccountType(ctx.state.user.did)
        .catch(() => null);
      const accountHostPromise = loadSession(ctx.state.user.did)
        .then((oauthSession) =>
          oauthSession ? lookupAccountHost(oauthSession.pdsUrl) : null
        )
        .catch(() => null);
      const [accountType, accountHost] = await Promise.all([
        accountTypePromise,
        accountHostPromise,
      ]);
      ctx.state.accountType = accountType;
      ctx.state.accountHost = accountHost;
    } else {
      const remembered = ctx.state.user
        ? rememberedAccounts.find((account) =>
          account.did === ctx.state.user?.did
        )
        : null;
      ctx.state.accountType = null;
      ctx.state.accountHost = lookupAccountHostHint(remembered?.pdsUrl);
    }
  } catch (err) {
    if (IS_DEV) console.warn("session read failed:", err);
    ctx.state.user = null;
    ctx.state.accountType = null;
    ctx.state.accountHost = null;
    ctx.state.rememberedAccounts = await rememberedAccountsPromise;
  }
  return await ctx.next();
});
