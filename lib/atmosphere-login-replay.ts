import type { AtmosphereSelectionReplayStore } from "./atmosphere-login-sdk.ts";
import type { DbClient } from "./db.ts";

type WithDb = <T>(fn: (c: DbClient) => Promise<T>) => Promise<T>;

export interface DbSelectionReplayStoreOptions {
  withDb?: WithDb;
  nowSec?: () => number;
}

export function createDbSelectionReplayStore(
  options: DbSelectionReplayStoreOptions = {},
): AtmosphereSelectionReplayStore {
  const run = options.withDb ?? defaultReplayWithDb;
  const nowSec = options.nowSec ?? (() => Math.floor(Date.now() / 1000));

  async function prune(c: DbClient): Promise<void> {
    await c.execute({
      sql: `DELETE FROM login_selection_replay WHERE expires_at <= ?`,
      args: [nowSec()],
    });
  }

  async function consume(jti: string, expiresAtSec: number): Promise<boolean> {
    return await run(async (c) => {
      await prune(c);
      try {
        await c.execute({
          sql: `
            INSERT INTO login_selection_replay (
              jti, expires_at, consumed_at
            ) VALUES (?, ?, ?)
          `,
          args: [jti, expiresAtSec, nowSec()],
        });
        return true;
      } catch (error) {
        if (isUniqueConstraintError(error)) return false;
        throw error;
      }
    });
  }

  return {
    async has(jti: string): Promise<boolean> {
      return await run(async (c) => {
        await prune(c);
        const result = await c.execute({
          sql: `
            SELECT jti
            FROM login_selection_replay
            WHERE jti = ? AND expires_at > ?
            LIMIT 1
          `,
          args: [jti, nowSec()],
        });
        return result.rows.length > 0;
      });
    },
    async add(jti: string, expiresAtSec: number): Promise<void> {
      await consume(jti, expiresAtSec);
    },
    consume,
  };
}

export const dbSelectionReplayStore = createDbSelectionReplayStore();

async function defaultReplayWithDb<T>(
  fn: (c: DbClient) => Promise<T>,
): Promise<T> {
  const { withDb } = await import("./db.ts");
  return await withDb(fn);
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|duplicate|primary key/i.test(message);
}
