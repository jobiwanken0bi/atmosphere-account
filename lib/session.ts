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
import { IS_DEV, SESSION_SECRET } from "./env.ts";

export interface SessionUser {
  did: string;
  handle: string;
}

const SESSION_COOKIE = "atmo_sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
  const sig = await hmacSign(SESSION_SECRET, sid);
  return `${sid}.${sig}`;
}

async function readSessionCookie(req: Request): Promise<SessionUser | null> {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const target = cookieHeader.split(";").map((c) => c.trim()).find((c) =>
    c.startsWith(`${SESSION_COOKIE}=`)
  );
  if (!target) return null;
  const value = decodeURIComponent(target.slice(SESSION_COOKIE.length + 1));
  const [sid, sig] = value.split(".");
  if (!sid || !sig) return null;
  const ok = await hmacVerify(SESSION_SECRET, sid, sig);
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
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return;
  const target = cookieHeader.split(";").map((c) => c.trim()).find((c) =>
    c.startsWith(`${SESSION_COOKIE}=`)
  );
  if (!target) return;
  const value = decodeURIComponent(target.slice(SESSION_COOKIE.length + 1));
  const [sid] = value.split(".");
  if (!sid) return;
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

/**
 * Hydrates `ctx.state.user` from the session cookie. Always returns a
 * value (possibly null) so downstream code can rely on the property
 * being present.
 */
export const sessionMiddleware = define.middleware(async (ctx) => {
  try {
    ctx.state.user = await readSessionCookie(ctx.req);
  } catch (err) {
    if (IS_DEV) console.warn("session read failed:", err);
    ctx.state.user = null;
  }
  return await ctx.next();
});
