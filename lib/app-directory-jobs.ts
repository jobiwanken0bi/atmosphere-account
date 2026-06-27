import type { InValue } from "@libsql/client";
import { withDb } from "./db.ts";
import {
  type AtstoreBackfillCounts,
  backfillAtstoreListings,
  backfillAtstoreReviewsAndFavorites,
  rescoreAtstoreDirectory,
} from "./atstore-backfill.ts";
import { IS_HOSTED_RUNTIME } from "./env.ts";

export type AppDirectoryJobKind =
  | "backfill_listings"
  | "backfill_social"
  | "rescore_trending";

export type AppDirectoryJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export interface AppDirectoryJob {
  id: string;
  kind: AppDirectoryJobKind;
  status: AppDirectoryJobStatus;
  createdBy: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  updatedAt: number;
  progressLabel: string | null;
  listingsImported: number;
  reviewsImported: number;
  favoritesImported: number;
  recordsSeen: number;
  recordsFailed: number;
  rescored: number;
  error: string | null;
}

export async function enqueueAppDirectoryJob(
  kind: AppDirectoryJobKind,
  createdBy: string,
): Promise<AppDirectoryJob> {
  return await withDb(async (c) => {
    const existing = await c.execute({
      sql: `
        SELECT ${jobSelect()}
        FROM app_directory_job
        WHERE kind = ? AND status IN ('queued', 'running')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      args: [kind],
    });
    const existingRow = existing.rows[0];
    if (existingRow) return rowToJob(existingRow);

    const now = Date.now();
    const id = crypto.randomUUID();
    await c.execute({
      sql: `
        INSERT INTO app_directory_job (
          id, kind, status, created_by, created_at, updated_at, progress_label
        ) VALUES (?, ?, 'queued', ?, ?, ?, ?)
      `,
      args: [id, kind, createdBy, now, now, "Queued"],
    });
    return {
      id,
      kind,
      status: "queued",
      createdBy,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      updatedAt: now,
      progressLabel: "Queued",
      listingsImported: 0,
      reviewsImported: 0,
      favoritesImported: 0,
      recordsSeen: 0,
      recordsFailed: 0,
      rescored: 0,
      error: null,
    };
  });
}

export function canStartAppDirectoryJobInProcess(): boolean {
  if (!IS_HOSTED_RUNTIME) return true;
  try {
    return Deno.env.get("ALLOW_IN_PROCESS_APP_DIRECTORY_JOBS") === "true";
  } catch {
    return false;
  }
}

export function startAppDirectoryJob(jobId: string): boolean {
  if (!canStartAppDirectoryJobInProcess()) {
    console.warn(
      "[app-directory-job] queued but not started in-process; run via worker/CLI",
    );
    return false;
  }
  setTimeout(() => {
    runAppDirectoryJob(jobId).catch((err) => {
      console.error("[app-directory-job] failed:", err);
    });
  }, 0);
  return true;
}

export async function runAppDirectoryJob(jobId: string): Promise<void> {
  const job = await getAppDirectoryJob(jobId);
  if (!job || job.status !== "queued") return;
  const started = await markRunning(jobId, "Starting");
  if (!started) return;
  try {
    const counts = await runJobKind(job.kind, jobId);
    await markFinished(jobId, "succeeded", counts, "Finished");
  } catch (err) {
    await markFinished(
      jobId,
      "failed",
      null,
      "Failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function getAppDirectoryJob(
  jobId: string,
): Promise<AppDirectoryJob | null> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `SELECT ${jobSelect()} FROM app_directory_job WHERE id = ? LIMIT 1`,
      args: [jobId],
    });
    return result.rows[0] ? rowToJob(result.rows[0]) : null;
  });
}

export async function listRecentAppDirectoryJobs(
  limit = 8,
): Promise<AppDirectoryJob[]> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT ${jobSelect()}
        FROM app_directory_job
        ORDER BY created_at DESC
        LIMIT ?
      `,
      args: [Math.max(1, Math.min(50, limit))],
    });
    return result.rows.map(rowToJob);
  });
}

export async function listQueuedAppDirectoryJobs(
  limit = 1,
): Promise<AppDirectoryJob[]> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT ${jobSelect()}
        FROM app_directory_job
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT ?
      `,
      args: [Math.max(1, Math.min(10, limit))],
    });
    return result.rows.map(rowToJob);
  });
}

export async function runQueuedAppDirectoryJobs(limit = 1): Promise<number> {
  const jobs = await listQueuedAppDirectoryJobs(limit);
  for (const job of jobs) {
    await runAppDirectoryJob(job.id);
  }
  return jobs.length;
}

async function runJobKind(
  kind: AppDirectoryJobKind,
  jobId: string,
): Promise<AtstoreBackfillCounts> {
  if (kind === "backfill_listings") {
    return await backfillAtstoreListings({
      onProgress: (progress) =>
        updateJobProgress(jobId, progress.phase, progress.counts),
    });
  }
  if (kind === "backfill_social") {
    return await backfillAtstoreReviewsAndFavorites({
      onProgress: (progress) =>
        updateJobProgress(jobId, progress.phase, progress.counts),
    });
  }
  return await rescoreAtstoreDirectory({
    onProgress: (progress) =>
      updateJobProgress(jobId, progress.phase, progress.counts),
  });
}

async function markRunning(jobId: string, label: string): Promise<boolean> {
  const now = Date.now();
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        UPDATE app_directory_job
        SET status = 'running',
            started_at = COALESCE(started_at, ?),
            updated_at = ?,
            progress_label = ?
        WHERE id = ? AND status = 'queued'
      `,
      args: [now, now, label, jobId],
    });
    return Number(result.rowsAffected ?? 0) > 0;
  });
}

async function updateJobProgress(
  jobId: string,
  label: string,
  counts: AtstoreBackfillCounts,
): Promise<void> {
  const now = Date.now();
  await withDb(async (c) => {
    await c.execute({
      sql: `
        UPDATE app_directory_job
        SET updated_at = ?,
            progress_label = ?,
            listings_imported = ?,
            reviews_imported = ?,
            favorites_imported = ?,
            records_seen = ?,
            records_failed = ?,
            rescored = ?
        WHERE id = ?
      `,
      args: countsToArgs(now, label, counts, jobId),
    });
  });
}

async function markFinished(
  jobId: string,
  status: Extract<AppDirectoryJobStatus, "succeeded" | "failed">,
  counts: AtstoreBackfillCounts | null,
  label: string,
  error: string | null = null,
): Promise<void> {
  const now = Date.now();
  const c = counts ?? emptyCounts();
  await withDb(async (db) => {
    await db.execute({
      sql: `
        UPDATE app_directory_job
        SET status = ?,
            finished_at = ?,
            updated_at = ?,
            progress_label = ?,
            listings_imported = ?,
            reviews_imported = ?,
            favorites_imported = ?,
            records_seen = ?,
            records_failed = ?,
            rescored = ?,
            error = ?
        WHERE id = ?
      `,
      args: [
        status,
        now,
        now,
        label,
        c.listingsImported,
        c.reviewsImported,
        c.favoritesImported,
        c.recordsSeen,
        c.recordsFailed,
        c.rescored,
        error,
        jobId,
      ],
    });
  });
}

function countsToArgs(
  now: number,
  label: string,
  counts: AtstoreBackfillCounts,
  jobId: string,
): InValue[] {
  return [
    now,
    label,
    counts.listingsImported,
    counts.reviewsImported,
    counts.favoritesImported,
    counts.recordsSeen,
    counts.recordsFailed,
    counts.rescored,
    jobId,
  ];
}

function emptyCounts(): AtstoreBackfillCounts {
  return {
    recordsSeen: 0,
    listingsImported: 0,
    reviewsImported: 0,
    favoritesImported: 0,
    recordsFailed: 0,
    rescored: 0,
  };
}

function jobSelect(): string {
  return `
    id, kind, status, created_by, created_at, started_at, finished_at,
    updated_at, progress_label, listings_imported, reviews_imported,
    favorites_imported, records_seen, records_failed, rescored, error
  `;
}

function rowToJob(row: unknown): AppDirectoryJob {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    kind: String(r.kind) as AppDirectoryJobKind,
    status: String(r.status) as AppDirectoryJobStatus,
    createdBy: stringOrNull(r.created_by),
    createdAt: Number(r.created_at ?? 0),
    startedAt: numberOrNull(r.started_at),
    finishedAt: numberOrNull(r.finished_at),
    updatedAt: Number(r.updated_at ?? 0),
    progressLabel: stringOrNull(r.progress_label),
    listingsImported: Number(r.listings_imported ?? 0),
    reviewsImported: Number(r.reviews_imported ?? 0),
    favoritesImported: Number(r.favorites_imported ?? 0),
    recordsSeen: Number(r.records_seen ?? 0),
    recordsFailed: Number(r.records_failed ?? 0),
    rescored: Number(r.rescored ?? 0),
    error: stringOrNull(r.error),
  };
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
