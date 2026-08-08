import { isPostgresBackend, withDb } from "./db.ts";
import {
  encryptStoredSecret,
  isEncryptedStoredSecret,
} from "./secret-storage.ts";

export interface DatabaseMaintenanceResult {
  expiredOauthStates: number;
  expiredOauthSessions: number;
  expiredAppSessions: number;
  expiredLoginSelectionReplays: number;
  expiredLoginPickerIntents: number;
  expiredAppHostLinkIntents: number;
  expiredPasskeyCeremonies: number;
  expiredRateLimitBuckets: number;
  expiredWorkerLeases: number;
  optimized: boolean;
}

function rowsAffected(result: { rowsAffected?: number | bigint }): number {
  return Number(result.rowsAffected ?? 0);
}

export async function runDatabaseMaintenance(
  now = Date.now(),
): Promise<DatabaseMaintenanceResult> {
  return await withDb(async (c) => {
    return await runDatabaseMaintenanceForClient(c, {
      now,
      postgresBackend: isPostgresBackend(),
    });
  });
}

export async function runDatabaseMaintenanceForClient(
  c: {
    execute: (query: string | { sql: string; args?: unknown[] }) => Promise<
      { rows?: unknown[]; rowsAffected?: number | bigint }
    >;
  },
  options: { now?: number; postgresBackend?: boolean } = {},
): Promise<DatabaseMaintenanceResult> {
  const now = options.now ?? Date.now();
  const nowSec = Math.floor(now / 1000);
  const expiredOauthStates = rowsAffected(
    await c.execute({
      sql: `DELETE FROM oauth_state WHERE expires_at < ?`,
      args: [now],
    }),
  );
  await encryptLegacyOAuthRows(c, "oauth_state", "key", 128);
  await encryptLegacyOAuthRows(c, "oauth_session", "did", 128);
  // OAuth grant/session `expires_at` tracks the short-lived access token so
  // request paths know when to refresh it. The row also holds a longer-lived
  // refresh token and must survive access-token expiry; invalid rows are
  // replaced or explicitly removed by the OAuth lifecycle instead of cleanup.
  const expiredOauthSessions = 0;
  await c.execute({
    sql: `DELETE FROM app_session_grant
      WHERE session_id IN (SELECT id FROM app_session WHERE expires_at < ?)`,
    args: [now],
  });
  const expiredAppSessions = rowsAffected(
    await c.execute({
      sql: `DELETE FROM app_session WHERE expires_at < ?`,
      args: [now],
    }),
  );
  const expiredLoginSelectionReplays = rowsAffected(
    await c.execute({
      sql: `DELETE FROM login_selection_replay WHERE expires_at <= ?`,
      args: [nowSec],
    }),
  );
  const expiredLoginPickerIntents = rowsAffected(
    await c.execute({
      sql: `DELETE FROM login_picker_intent WHERE expires_at <= ?`,
      args: [now],
    }),
  );
  const expiredAppHostLinkIntents = rowsAffected(
    await c.execute({
      sql: `DELETE FROM app_host_link_intent_consumption WHERE expires_at <= ?`,
      args: [now],
    }),
  );
  const expiredPasskeyCeremonies = rowsAffected(
    await c.execute({
      sql: `DELETE FROM passkey_ceremony WHERE expires_at <= ?`,
      args: [now],
    }),
  );
  const expiredRateLimitBuckets = rowsAffected(
    await c.execute({
      sql: `DELETE FROM rate_limit_bucket WHERE reset_at < ?`,
      args: [now],
    }),
  );
  const expiredWorkerLeases = rowsAffected(
    await c.execute({
      sql: `DELETE FROM worker_lease WHERE expires_at < ?`,
      args: [now],
    }),
  );

  let optimized = false;
  if (!options.postgresBackend) {
    try {
      await c.execute("PRAGMA optimize");
      optimized = true;
    } catch {
      // Some remote SQLite-compatible providers may ignore/disable PRAGMA
      // optimize. Cleanup above is the important durable maintenance step.
    }
  }

  return {
    expiredOauthStates,
    expiredOauthSessions,
    expiredAppSessions,
    expiredLoginSelectionReplays,
    expiredLoginPickerIntents,
    expiredAppHostLinkIntents,
    expiredPasskeyCeremonies,
    expiredRateLimitBuckets,
    expiredWorkerLeases,
    optimized,
  };
}

async function encryptLegacyOAuthRows(
  c: {
    execute: (query: string | { sql: string; args?: unknown[] }) => Promise<{
      rows?: unknown[];
      rowsAffected?: number | bigint;
    }>;
  },
  table: "oauth_state" | "oauth_session",
  keyColumn: "key" | "did",
  limit: number,
): Promise<void> {
  const result = await c.execute(
    `SELECT ${keyColumn}, value FROM ${table} LIMIT ${limit}`,
  );
  for (const raw of result.rows ?? []) {
    const row = raw as Record<string, unknown>;
    const key = String(row[keyColumn]);
    const value = String(row.value);
    if (isEncryptedStoredSecret(value)) continue;
    const encrypted = await encryptStoredSecret(value, `${table}:${key}`);
    await c.execute({
      sql: `UPDATE ${table} SET value = ? WHERE ${keyColumn} = ? AND value = ?`,
      args: [encrypted, key, value],
    });
  }
}
