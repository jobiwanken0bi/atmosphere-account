/**
 * App-level account classification. A signed-in DID can be a normal
 * user (reviewing projects) or a project account (publishing a registry
 * profile). The choice is local to this AppView.
 */
import { withDb } from "./db.ts";
import { getProfileByDid } from "./registry.ts";

export type AccountType = "user" | "project";

export interface AppUserRow {
  did: string;
  handle: string;
  displayName: string | null;
  accountType: AccountType;
  createdAt: number;
  updatedAt: number;
}

interface RawAppUserRow {
  did: string;
  handle: string;
  display_name: string | null;
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
    accountType: normalizeAccountType(row.account_type),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function getAppUser(did: string): Promise<AppUserRow | null> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        SELECT did, handle, display_name, account_type, created_at, updated_at
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

export async function setAppUserType(input: {
  did: string;
  handle: string;
  displayName?: string | null;
  accountType: AccountType;
}): Promise<AppUserRow> {
  return await withDb(async (c) => {
    const now = Date.now();
    await c.execute({
      sql: `
        INSERT INTO app_user (
          did, handle, display_name, account_type, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(did) DO UPDATE SET
          handle = excluded.handle,
          display_name = COALESCE(excluded.display_name, app_user.display_name),
          account_type = excluded.account_type,
          updated_at = excluded.updated_at
      `,
      args: [
        input.did,
        input.handle,
        input.displayName ?? null,
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
}): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql: `
        UPDATE app_user SET
          handle = ?,
          display_name = ?,
          updated_at = ?
        WHERE did = ?
      `,
      args: [
        input.handle,
        input.displayName?.trim() || null,
        Date.now(),
        input.did,
      ],
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
