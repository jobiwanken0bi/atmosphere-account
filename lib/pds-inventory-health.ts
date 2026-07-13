import { type DbClient, withDb } from "./db.ts";
import { PDS_RELAY_BASE_URL } from "./pds-relay-inventory.ts";

export const DEFAULT_PDS_INVENTORY_MAX_AGE_MS = 42 * 60 * 60 * 1000;
const SCAN_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ERROR_LENGTH = 2_000;

export type PdsInventoryScanStatus = "running" | "succeeded" | "failed";

export interface PdsInventoryScanRecord {
  scanId: string;
  relayUrl: string;
  status: PdsInventoryScanStatus;
  complete: boolean;
  pages: number | null;
  instanceCount: number | null;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

export interface PdsInventoryFreshness {
  present: boolean;
  fresh: boolean;
  maxAgeMs: number;
  ageMs: number | null;
  completedAt: string | null;
  scanId: string | null;
  pages: number | null;
  instanceCount: number | null;
  latestAttempt: {
    status: PdsInventoryScanStatus;
    complete: boolean;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
  } | null;
}

export async function startPdsInventoryScan(
  scanId: string,
  startedAt = Date.now(),
): Promise<void> {
  await withDb(async (client) => {
    await client.execute({
      sql: `INSERT INTO pds_inventory_scan (
          scan_id, relay_url, status, complete, pages, instance_count,
          started_at, completed_at, error
        ) VALUES (?, ?, 'running', 0, NULL, NULL, ?, NULL, NULL)
        ON CONFLICT(scan_id) DO UPDATE SET
          relay_url = excluded.relay_url,
          status = 'running',
          complete = 0,
          pages = NULL,
          instance_count = NULL,
          started_at = excluded.started_at,
          completed_at = NULL,
          error = NULL`,
      args: [scanId, PDS_RELAY_BASE_URL, startedAt],
    });
  });
}

export async function finishPdsInventoryScan(input: {
  scanId: string;
  complete: boolean;
  pages: number;
  instanceCount: number;
  completedAt?: number;
}): Promise<void> {
  const completedAt = input.completedAt ?? Date.now();
  await withDb(async (client) => {
    await client.execute({
      sql: `UPDATE pds_inventory_scan
        SET status = 'succeeded', complete = ?, pages = ?,
            instance_count = ?, completed_at = ?, error = NULL
        WHERE scan_id = ?`,
      args: [
        input.complete ? 1 : 0,
        input.pages,
        input.instanceCount,
        completedAt,
        input.scanId,
      ],
    });
    await prunePdsInventoryScanHistory(client, completedAt);
  });
}

export async function failPdsInventoryScan(input: {
  scanId: string;
  error: unknown;
  completedAt?: number;
}): Promise<void> {
  const completedAt = input.completedAt ?? Date.now();
  const error =
    (input.error instanceof Error ? input.error.message : String(input.error))
      .slice(0, MAX_ERROR_LENGTH);
  await withDb(async (client) => {
    await client.execute({
      sql: `UPDATE pds_inventory_scan
        SET status = 'failed', complete = 0, completed_at = ?, error = ?
        WHERE scan_id = ?`,
      args: [completedAt, error, input.scanId],
    });
    await prunePdsInventoryScanHistory(client, completedAt);
  });
}

export async function getPdsInventoryFreshness(
  options: { now?: number; maxAgeMs?: number } = {},
): Promise<PdsInventoryFreshness> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? pdsInventoryMaxAgeMs();
  return await withDb(async (client) => {
    const [complete, latest] = await Promise.all([
      client.execute({
        sql: `SELECT * FROM pds_inventory_scan
          WHERE status = 'succeeded' AND complete = 1
          ORDER BY completed_at DESC LIMIT 1`,
        args: [],
      }),
      client.execute({
        sql: `SELECT * FROM pds_inventory_scan
          ORDER BY started_at DESC LIMIT 1`,
        args: [],
      }),
    ]);
    return calculatePdsInventoryFreshness({
      complete: scanFromRow(complete.rows[0]),
      latest: scanFromRow(latest.rows[0]),
      now,
      maxAgeMs,
    });
  });
}

export function calculatePdsInventoryFreshness(input: {
  complete: PdsInventoryScanRecord | null;
  latest: PdsInventoryScanRecord | null;
  now: number;
  maxAgeMs: number;
}): PdsInventoryFreshness {
  const completedAt = input.complete?.completedAt ?? null;
  const ageMs = completedAt == null
    ? null
    : Math.max(0, input.now - completedAt);
  return {
    present: completedAt != null,
    fresh: ageMs != null && ageMs <= input.maxAgeMs,
    maxAgeMs: input.maxAgeMs,
    ageMs,
    completedAt: completedAt == null
      ? null
      : new Date(completedAt).toISOString(),
    scanId: input.complete?.scanId ?? null,
    pages: input.complete?.pages ?? null,
    instanceCount: input.complete?.instanceCount ?? null,
    latestAttempt: input.latest
      ? {
        status: input.latest.status,
        complete: input.latest.complete,
        startedAt: new Date(input.latest.startedAt).toISOString(),
        completedAt: input.latest.completedAt == null
          ? null
          : new Date(input.latest.completedAt).toISOString(),
        error: input.latest.error,
      }
      : null,
  };
}

export function pdsInventoryMaxAgeMs(): number {
  let raw: string | undefined;
  try {
    raw = Deno.env.get("PDS_INVENTORY_MAX_AGE_MS");
  } catch {
    raw = undefined;
  }
  if (!raw) return DEFAULT_PDS_INVENTORY_MAX_AGE_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_PDS_INVENTORY_MAX_AGE_MS;
}

async function prunePdsInventoryScanHistory(
  client: DbClient,
  now: number,
): Promise<void> {
  await client.execute({
    sql: `DELETE FROM pds_inventory_scan
      WHERE completed_at IS NOT NULL AND completed_at < ?`,
    args: [now - SCAN_HISTORY_RETENTION_MS],
  });
}

function scanFromRow(row: unknown): PdsInventoryScanRecord | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  const status = value.status;
  if (status !== "running" && status !== "succeeded" && status !== "failed") {
    return null;
  }
  return {
    scanId: String(value.scan_id),
    relayUrl: String(value.relay_url),
    status,
    complete: Number(value.complete) === 1,
    pages: value.pages == null ? null : Number(value.pages),
    instanceCount: value.instance_count == null
      ? null
      : Number(value.instance_count),
    startedAt: Number(value.started_at),
    completedAt: value.completed_at == null ? null : Number(value.completed_at),
    error: value.error == null ? null : String(value.error),
  };
}
