/**
 * App-level account classification. A signed-in DID can be a normal
 * user (reviewing projects) or a project account (publishing a registry
 * profile). The choice is local to this AppView.
 */
import { withDb } from "./db.ts";
import { DEFAULT_BSKY_CLIENT_ID, getBskyClient } from "./bsky-clients.ts";
import { getProfileByDid } from "./registry.ts";

export type AccountType = "user" | "project";

export interface AppUserRow {
  did: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  avatarCid: string | null;
  avatarMime: string | null;
  bskyClientId: string;
  accountType: AccountType;
  createdAt: number;
  updatedAt: number;
}

interface RawAppUserRow {
  did: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_cid: string | null;
  avatar_mime: string | null;
  bsky_client_id: string | null;
  account_type: string;
  created_at: number;
  updated_at: number;
}

function normalizeAccountType(value: string): AccountType {
  return value === "project" ? "project" : "user";
}

function rowToAppUser(row: RawAppUserRow): AppUserRow {
  return {
    did: row.did,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarCid: row.avatar_cid,
    avatarMime: row.avatar_mime,
    bskyClientId: getBskyClient(row.bsky_client_id).id,
    accountType: normalizeAccountType(row.account_type),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function getAppUser(did: string): Promise<AppUserRow | null> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        SELECT did, handle, display_name, avatar_cid, avatar_mime,
               bio, bsky_client_id, account_type, created_at, updated_at
        FROM app_user
        WHERE did = ?
        LIMIT 1
      `,
      args: [did],
    });
    const row = r.rows[0] as unknown as RawAppUserRow | undefined;
    return row ? rowToAppUser(row) : null;
  });
}

export async function getAppUserByHandle(
  handle: string,
): Promise<AppUserRow | null> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        SELECT did, handle, display_name, avatar_cid, avatar_mime,
               bio, bsky_client_id, account_type, created_at, updated_at
        FROM app_user
        WHERE lower(handle) = lower(?)
        LIMIT 1
      `,
      args: [handle],
    });
    const row = r.rows[0] as unknown as RawAppUserRow | undefined;
    return row ? rowToAppUser(row) : null;
  });
}

export async function setAppUserType(input: {
  did: string;
  handle: string;
  displayName?: string | null;
  bio?: string | null;
  avatarCid?: string | null;
  avatarMime?: string | null;
  bskyClientId?: string | null;
  accountType: AccountType;
}): Promise<AppUserRow> {
  return await withDb(async (c) => {
    const now = Date.now();
    await c.execute({
      sql: `
        INSERT INTO app_user (
          did, handle, display_name, bio, avatar_cid, avatar_mime,
          bsky_client_id,
          account_type, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(did) DO UPDATE SET
          handle = excluded.handle,
          display_name = COALESCE(excluded.display_name, app_user.display_name),
          bio = COALESCE(excluded.bio, app_user.bio),
          avatar_cid = COALESCE(excluded.avatar_cid, app_user.avatar_cid),
          avatar_mime = COALESCE(excluded.avatar_mime, app_user.avatar_mime),
          bsky_client_id = excluded.bsky_client_id,
          account_type = excluded.account_type,
          updated_at = excluded.updated_at
      `,
      args: [
        input.did,
        input.handle,
        input.displayName ?? null,
        input.bio ?? null,
        input.avatarCid ?? null,
        input.avatarMime ?? null,
        getBskyClient(input.bskyClientId ?? DEFAULT_BSKY_CLIENT_ID).id,
        input.accountType,
        now,
        now,
      ],
    });
    const row = await getAppUser(input.did);
    if (!row) throw new Error("app_user_write_failed");
    return row;
  });
}

export async function updateAppUserProfile(input: {
  did: string;
  handle: string;
  displayName?: string | null;
  bio?: string | null;
  avatarCid?: string | null;
  avatarMime?: string | null;
}): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql: `
        UPDATE app_user SET
          handle = ?,
          display_name = COALESCE(?, display_name),
          bio = COALESCE(?, bio),
          avatar_cid = COALESCE(?, avatar_cid),
          avatar_mime = COALESCE(?, avatar_mime),
          updated_at = ?
        WHERE did = ?
      `,
      args: [
        input.handle,
        input.displayName?.trim() || null,
        input.bio?.trim() || null,
        input.avatarCid ?? null,
        input.avatarMime ?? null,
        Date.now(),
        input.did,
      ],
    });
  });
}

export async function updateAppUserBskyClient(
  did: string,
  bskyClientId: string,
): Promise<void> {
  const client = getBskyClient(bskyClientId);
  await withDb(async (c) => {
    await c.execute({
      sql: `
        UPDATE app_user SET
          bsky_client_id = ?,
          updated_at = ?
        WHERE did = ? AND account_type = 'user'
      `,
      args: [client.id, Date.now(), did],
    });
  });
}

/**
 * Existing published registry profiles predate account types. Treat those
 * DIDs as projects so old project accounts do not get forced through the
 * new chooser on their next sign-in.
 */
export async function getEffectiveAccountType(
  did: string,
): Promise<AccountType | null> {
  const user = await getAppUser(did);
  if (user) return user.accountType;
  const profile = await getProfileByDid(did, { includeTakenDown: true }).catch(
    () => null,
  );
  return profile ? "project" : null;
}

export async function requiresAccountTypeChoice(did: string): Promise<boolean> {
  return (await getEffectiveAccountType(did)) == null;
}
