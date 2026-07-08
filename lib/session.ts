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
import { lookupAccountHost, lookupAccountHostHint } from "./account-hosts.ts";
import { loadSession } from "./oauth.ts";

export interface SessionUser {
  did: string;
  handle: string;
}

const SESSION_COOKIE = "atmo_sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
      sql: `SELECT did, handle, expires_at FROM app_session WHERE id = ?`,
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
    return { did: String(row.did), handle: String(row.handle) };
  });
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
): boolean {
  if (!appviewConfigured) return true;
  return pathname.startsWith("/dev/");
}

function isAppviewConfigured(): boolean {
  return Boolean(
    Deno.env.get("ATMOSPHERE_APPVIEW_URL")?.trim() ||
      Deno.env.get("APPVIEW_BASE_URL")?.trim(),
  );
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
      ctx.state.user && shouldHydrateAccountDetails(ctx.url.pathname)
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
