import { isPostgresBackend, withDb } from "./db.ts";

export interface DatabaseMaintenanceResult {
  expiredOauthStates: number;
  expiredOauthSessions: number;
  expiredAppSessions: number;
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
    const expiredWorkerLeases = rowsAffected(
      await c.execute({
        sql: `DELETE FROM worker_lease WHERE expires_at < ?`,
        args: [now],
      }),
    );

    let optimized = false;
    if (!isPostgresBackend()) {
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
      expiredWorkerLeases,
      optimized,
    };
  });
}
