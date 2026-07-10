import { runDatabaseMaintenanceForClient } from "./db-maintenance.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("database maintenance removes expired replay keys using second timestamps", async () => {
  const now = 1_700_000_000_500;
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const client = {
    async execute(query: string | { sql: string; args?: unknown[] }) {
      await Promise.resolve();
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : query.args ?? [];
      calls.push({ sql, args });
      if (/oauth_state/i.test(sql)) return { rowsAffected: 1 };
      if (/oauth_session/i.test(sql)) return { rowsAffected: 2 };
      if (/app_session/i.test(sql)) return { rowsAffected: 3 };
      if (/login_selection_replay/i.test(sql)) return { rowsAffected: 4 };
      if (/login_picker_intent/i.test(sql)) return { rowsAffected: 5 };
      if (/rate_limit_bucket/i.test(sql)) return { rowsAffected: 6 };
      if (/worker_lease/i.test(sql)) return { rowsAffected: 7 };
      if (/PRAGMA optimize/i.test(sql)) return { rowsAffected: 0 };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const result = await runDatabaseMaintenanceForClient(client, {
    now,
    postgresBackend: true,
  });

  assertEquals(result, {
    expiredOauthStates: 1,
    expiredOauthSessions: 2,
    expiredAppSessions: 3,
    expiredLoginSelectionReplays: 4,
    expiredLoginPickerIntents: 5,
    expiredRateLimitBuckets: 6,
    expiredWorkerLeases: 7,
    optimized: false,
  });
  assertEquals(
    calls.find((call) => /login_selection_replay/i.test(call.sql))?.args,
    [1_700_000_000],
  );
  assertEquals(
    calls.filter((call) => /PRAGMA optimize/i.test(call.sql)).length,
    0,
  );
});

Deno.test("database maintenance optimizes SQLite-compatible backends", async () => {
  let optimized = false;
  const client = {
    async execute(query: string | { sql: string; args?: unknown[] }) {
      await Promise.resolve();
      const sql = typeof query === "string" ? query : query.sql;
      if (/PRAGMA optimize/i.test(sql)) {
        optimized = true;
        return { rowsAffected: 0 };
      }
      return { rowsAffected: 0 };
    },
  };

  const result = await runDatabaseMaintenanceForClient(client, {
    now: 1_700_000_000_500,
    postgresBackend: false,
  });

  assertEquals(optimized, true);
  assertEquals(result.optimized, true);
});
