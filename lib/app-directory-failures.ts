import type { InValue } from "@libsql/client";
import { withDb } from "./db.ts";

export interface AppRecordFailureInput {
  uri: string;
  collection: string;
  sourceType: string;
  repoDid: string;
  rkey: string;
  reason: string;
}

export interface AppRecordFailure {
  uri: string;
  collection: string;
  sourceType: string;
  repoDid: string;
  rkey: string;
  reason: string;
  firstSeenAt: number;
  lastSeenAt: number;
  count: number;
}

export async function recordAppRecordFailure(
  input: AppRecordFailureInput,
): Promise<void> {
  const now = Date.now();
  await withDb(async (c) => {
    await c.execute({
      sql: `
        INSERT INTO app_record_failure (
          uri, collection, source_type, repo_did, rkey, reason,
          first_seen_at, last_seen_at, count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(uri) DO UPDATE SET
          collection=excluded.collection,
          source_type=excluded.source_type,
          repo_did=excluded.repo_did,
          rkey=excluded.rkey,
          reason=excluded.reason,
          last_seen_at=excluded.last_seen_at,
          count=app_record_failure.count + 1
      `,
      args: [
        input.uri,
        input.collection,
        input.sourceType,
        input.repoDid,
        input.rkey,
        input.reason,
        now,
        now,
      ],
    });
  });
}

export async function clearAppRecordFailure(uri: string): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql: `DELETE FROM app_record_failure WHERE uri = ?`,
      args: [uri],
    });
  });
}

export async function getAppRecordFailure(
  uri: string,
): Promise<AppRecordFailure | null> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT
          uri, collection, source_type, repo_did, rkey, reason,
          first_seen_at, last_seen_at, count
        FROM app_record_failure
        WHERE uri = ?
        LIMIT 1
      `,
      args: [uri],
    });
    return result.rows[0] ? rowToFailure(result.rows[0]) : null;
  });
}

export async function listAppRecordFailures(
  limit = 20,
): Promise<AppRecordFailure[]> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT
          uri, collection, source_type, repo_did, rkey, reason,
          first_seen_at, last_seen_at, count
        FROM app_record_failure
        ORDER BY last_seen_at DESC
        LIMIT ?
      `,
      args: [Math.max(1, Math.min(100, limit))],
    });
    return result.rows.map(rowToFailure);
  });
}

export async function countAppRecordFailures(): Promise<number> {
  return await withDb((c) => countFailures(c));
}

type DbLike = {
  execute: (
    args: { sql: string; args?: InValue[] } | string,
  ) => Promise<{ rows: unknown[] }>;
};

export async function countFailures(c: DbLike): Promise<number> {
  const result = await c.execute(
    `SELECT COUNT(*) AS n FROM app_record_failure`,
  );
  return Number(
    (result.rows[0] as Record<string, unknown> | undefined)?.n ??
      0,
  );
}

export function appRecordFailureId(uri: string): string {
  return btoa(uri).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

export function uriFromAppRecordFailureId(id: string): string | null {
  const normalized = id.trim().replaceAll("-", "+").replaceAll("_", "/");
  if (!normalized) return null;
  const padded = normalized.padEnd(
    normalized.length + ((4 - normalized.length % 4) % 4),
    "=",
  );
  try {
    return atob(padded);
  } catch {
    return null;
  }
}

function rowToFailure(row: unknown): AppRecordFailure {
  const r = row as Record<string, unknown>;
  return {
    uri: String(r.uri),
    collection: String(r.collection),
    sourceType: String(r.source_type),
    repoDid: String(r.repo_did),
    rkey: String(r.rkey),
    reason: String(r.reason),
    firstSeenAt: Number(r.first_seen_at ?? 0),
    lastSeenAt: Number(r.last_seen_at ?? 0),
    count: Number(r.count ?? 0),
  };
}
