import { isPostgresBackend, withDb } from "./db.ts";

export interface DatabaseMaintenanceResult {
  expiredOauthStates: number;
  expiredOauthSessions: number;
  expiredAppSessions: number;
  expiredLoginSelectionReplays: number;
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
      { rowsAffected?: number | bigint }
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
  const expiredOauthSessions = rowsAffected(
    await c.execute({
      sql: `DELETE FROM oauth_session WHERE expires_at < ?`,
      args: [now],
    }),
  );
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
    expiredRateLimitBuckets,
    expiredWorkerLeases,
    optimized,
  };
}
