import {
  createDbSelectionReplayStore,
  type DbSelectionReplayStoreOptions,
} from "./atmosphere-login-replay.ts";
import type { DbClient } from "./db.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

function fakeReplayDb(nowSec: () => number) {
  const rows = new Map<string, { expiresAt: number; consumedAt: number }>();
  const client: DbClient = {
    async execute(query) {
      await Promise.resolve();
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : query.args ?? [];
      if (/DELETE FROM login_selection_replay/i.test(sql)) {
        const cutoff = Number(args[0] ?? 0);
        for (const [jti, row] of rows) {
          if (row.expiresAt <= cutoff) rows.delete(jti);
        }
        return { rows: [], rowsAffected: 0 };
      }
      if (/SELECT jti/i.test(sql)) {
        const jti = String(args[0] ?? "");
        const cutoff = Number(args[1] ?? 0);
        const row = rows.get(jti);
        return {
          rows: row && row.expiresAt > cutoff ? [{ jti }] : [],
          rowsAffected: 0,
        };
      }
      if (/INSERT INTO login_selection_replay/i.test(sql)) {
        const jti = String(args[0] ?? "");
        if (rows.has(jti)) {
          throw new Error(
            "UNIQUE constraint failed: login_selection_replay.jti",
          );
        }
        rows.set(jti, {
          expiresAt: Number(args[1] ?? 0),
          consumedAt: Number(args[2] ?? nowSec()),
        });
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const withDb: DbSelectionReplayStoreOptions["withDb"] = async (fn) =>
    await fn(client);
  return { rows, withDb };
}

Deno.test("DB selection replay store consumes a token once", async () => {
  let now = 1_000;
  const fake = fakeReplayDb(() => now);
  const store = createDbSelectionReplayStore({
    withDb: fake.withDb,
    nowSec: () => now,
  });

  assertEquals(await store.consume?.("selection-a", 1_120), true);
  assertEquals(await store.has("selection-a"), true);
  assertEquals(await store.consume?.("selection-a", 1_120), false);
  assertEquals(fake.rows.get("selection-a")?.consumedAt, 1_000);

  now = 1_121;
  assertEquals(await store.has("selection-a"), false);
  assertEquals(fake.rows.has("selection-a"), false);
});
