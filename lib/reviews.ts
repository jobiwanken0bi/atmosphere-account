/**
 * Signed-in reviews for registry profiles. Reviews are local AppView data:
 * they power Explore profile ratings and can be hidden/removed by admins
 * without changing a user's PDS records.
 */
import { withDb } from "./db.ts";

export const MAX_REVIEW_BODY_LENGTH = 300;
export const REVIEW_AGGREGATE_MIN_COUNT = 5;
export const MAX_REVIEW_RESPONSE_LENGTH = 500;

export const REVIEW_REPORT_REASONS = [
  "harmful",
  "spam",
  "off_topic",
  "other",
] as const;
export type ReviewReportReason = typeof REVIEW_REPORT_REASONS[number];

export type ReviewStatus = "visible" | "hidden" | "removed";
export type ReviewReportStatus = "open" | "actioned" | "dismissed";

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface ReviewSummary {
  visibleCount: number;
  averageRating: number | null;
  distribution: RatingDistribution | null;
}

export interface ReviewResponseRow {
  reviewId: number;
  responderDid: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewRow {
  id: number;
  targetDid: string;
  reviewerDid: string;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
  status: ReviewStatus;
  createdAt: number;
  updatedAt: number;
  hiddenAt: number | null;
  hiddenBy: string | null;
  removedAt: number | null;
  removedBy: string | null;
  adminNotes: string | null;
  response: ReviewResponseRow | null;
}

export interface ReviewReportRow {
  id: number;
  reviewId: number;
  reporterDid: string | null;
  reason: ReviewReportReason;
  details: string | null;
  status: ReviewReportStatus;
  adminNotes: string | null;
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
  review: ReviewRow | null;
}

interface RawReviewRow {
  id: number;
  target_did: string;
  reviewer_did: string;
  rating: number;
  body: string;
  status: string;
  created_at: number;
  updated_at: number;
  hidden_at: number | null;
  hidden_by: string | null;
  removed_at: number | null;
  removed_by: string | null;
  admin_notes: string | null;
  response_body?: string | null;
  response_responder_did?: string | null;
  response_created_at?: number | null;
  response_updated_at?: number | null;
}

interface RawReviewReportRow {
  id: number;
  review_id: number;
  reporter_did: string | null;
  reason: string;
  details: string | null;
  status: string;
  admin_notes: string | null;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
}

function normalizeRating(v: number): 1 | 2 | 3 | 4 | 5 {
  if (v === 1 || v === 2 || v === 3 || v === 4 || v === 5) return v;
  return 1;
}

function normalizeReviewStatus(v: string): ReviewStatus {
  if (v === "hidden" || v === "removed") return v;
  return "visible";
}

function normalizeReportReason(v: string): ReviewReportReason {
  return (REVIEW_REPORT_REASONS as readonly string[]).includes(v)
    ? v as ReviewReportReason
    : "other";
}

function normalizeReportStatus(v: string): ReviewReportStatus {
  if (v === "actioned" || v === "dismissed") return v;
  return "open";
}

function rowToReview(r: RawReviewRow): ReviewRow {
  const response = r.response_body != null && r.response_responder_did
    ? {
      reviewId: Number(r.id),
      responderDid: r.response_responder_did,
      body: r.response_body,
      createdAt: Number(r.response_created_at ?? r.updated_at),
      updatedAt: Number(r.response_updated_at ?? r.updated_at),
    }
    : null;
  return {
    id: Number(r.id),
    targetDid: r.target_did,
    reviewerDid: r.reviewer_did,
    rating: normalizeRating(Number(r.rating)),
    body: r.body ?? "",
    status: normalizeReviewStatus(r.status),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    hiddenAt: r.hidden_at != null ? Number(r.hidden_at) : null,
    hiddenBy: r.hidden_by,
    removedAt: r.removed_at != null ? Number(r.removed_at) : null,
    removedBy: r.removed_by,
    adminNotes: r.admin_notes,
    response,
  };
}

function rowToReviewReport(
  report: RawReviewReportRow,
  review?: RawReviewRow | null,
): ReviewReportRow {
  return {
    id: Number(report.id),
    reviewId: Number(report.review_id),
    reporterDid: report.reporter_did,
    reason: normalizeReportReason(report.reason),
    details: report.details,
    status: normalizeReportStatus(report.status),
    adminNotes: report.admin_notes,
    createdAt: Number(report.created_at),
    resolvedAt: report.resolved_at != null ? Number(report.resolved_at) : null,
    resolvedBy: report.resolved_by,
    review: review ? rowToReview(review) : null,
  };
}

export function validateReviewRating(value: unknown): 1 | 2 | 3 | 4 | 5 | null {
  return typeof value === "number" && Number.isInteger(value) &&
      value >= 1 && value <= 5
    ? value as 1 | 2 | 3 | 4 | 5
    : null;
}

export function normalizeReviewBody(value: unknown): string | null {
  if (typeof value !== "string") return "";
  const body = value.trim();
  if (body.length > MAX_REVIEW_BODY_LENGTH) return null;
  return body;
}

export function normalizeReviewResponseBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.trim();
  if (!body || body.length > MAX_REVIEW_RESPONSE_LENGTH) return null;
  return body;
}

export async function createOrUpdateReview(input: {
  targetDid: string;
  reviewerDid: string;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
}): Promise<ReviewRow> {
  return await withDb(async (c) => {
    const now = Date.now();
    await c.execute({
      sql: `
        INSERT INTO review (
          target_did, reviewer_did, rating, body, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'visible', ?, ?)
        ON CONFLICT(target_did, reviewer_did) DO UPDATE SET
          rating = excluded.rating,
          body = excluded.body,
          status = 'visible',
          updated_at = excluded.updated_at,
          hidden_at = NULL,
          hidden_by = NULL,
          removed_at = NULL,
          removed_by = NULL,
          admin_notes = NULL
      `,
      args: [
        input.targetDid,
        input.reviewerDid,
        input.rating,
        input.body,
        now,
        now,
      ],
    });
    const review = await getOwnReview(input.targetDid, input.reviewerDid);
    if (!review) throw new Error("review_write_failed");
    return review;
  });
}

export async function getOwnReview(
  targetDid: string,
  reviewerDid: string,
): Promise<ReviewRow | null> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        SELECT r.*, rr.body AS response_body,
               rr.responder_did AS response_responder_did,
               rr.created_at AS response_created_at,
               rr.updated_at AS response_updated_at
        FROM review r
        LEFT JOIN review_response rr ON rr.review_id = r.id
        WHERE r.target_did = ? AND r.reviewer_did = ?
        LIMIT 1
      `,
      args: [targetDid, reviewerDid],
    });
    const row = r.rows[0] as unknown as RawReviewRow | undefined;
    return row ? rowToReview(row) : null;
  });
}

export async function getReviewById(id: number): Promise<ReviewRow | null> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        SELECT r.*, rr.body AS response_body,
               rr.responder_did AS response_responder_did,
               rr.created_at AS response_created_at,
               rr.updated_at AS response_updated_at
        FROM review r
        LEFT JOIN review_response rr ON rr.review_id = r.id
        WHERE r.id = ?
        LIMIT 1
      `,
      args: [id],
    });
    const row = r.rows[0] as unknown as RawReviewRow | undefined;
    return row ? rowToReview(row) : null;
  });
}

export async function deleteOwnReview(
  targetDid: string,
  reviewerDid: string,
): Promise<boolean> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        UPDATE review SET
          status = 'removed',
          updated_at = ?,
          removed_at = ?,
          removed_by = ?
        WHERE target_did = ? AND reviewer_did = ? AND status != 'removed'
      `,
      args: [Date.now(), Date.now(), reviewerDid, targetDid, reviewerDid],
    });
    return Number(r.rowsAffected ?? 0) > 0;
  });
}

export async function deleteOwnReviewById(
  reviewId: number,
  reviewerDid: string,
): Promise<boolean> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        UPDATE review SET
          status = 'removed',
          updated_at = ?,
          removed_at = ?,
          removed_by = ?
        WHERE id = ? AND reviewer_did = ? AND status != 'removed'
      `,
      args: [Date.now(), Date.now(), reviewerDid, reviewId, reviewerDid],
    });
    return Number(r.rowsAffected ?? 0) > 0;
  });
}

export async function getReviewSummary(
  targetDid: string,
): Promise<ReviewSummary> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        SELECT rating, COUNT(*) AS n
        FROM review
        WHERE target_did = ? AND status = 'visible'
        GROUP BY rating
      `,
      args: [targetDid],
    });
    const distribution: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let visibleCount = 0;
    let sum = 0;
    for (
      const row of r.rows as unknown as Array<{ rating: number; n: number }>
    ) {
      const rating = normalizeRating(Number(row.rating));
      const n = Number(row.n ?? 0);
      distribution[rating] = n;
      visibleCount += n;
      sum += rating * n;
    }
    if (visibleCount < REVIEW_AGGREGATE_MIN_COUNT) {
      return { visibleCount, averageRating: null, distribution: null };
    }
    return {
      visibleCount,
      averageRating: Math.round((sum / visibleCount) * 10) / 10,
      distribution,
    };
  });
}

export async function listVisibleReviews(
  targetDid: string,
  opts: { limit?: number; cursor?: number } = {},
): Promise<ReviewRow[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  return await withDb(async (c) => {
    const hasCursor = typeof opts.cursor === "number" &&
      Number.isFinite(opts.cursor);
    const r = await c.execute({
      sql: `
        SELECT r.*, rr.body AS response_body,
               rr.responder_did AS response_responder_did,
               rr.created_at AS response_created_at,
               rr.updated_at AS response_updated_at
        FROM review r
        LEFT JOIN review_response rr ON rr.review_id = r.id
        WHERE r.target_did = ? AND r.status = 'visible'
          ${hasCursor ? "AND r.created_at < ?" : ""}
        ORDER BY r.created_at DESC
        LIMIT ?
      `,
      args: hasCursor ? [targetDid, opts.cursor!, limit] : [targetDid, limit],
    });
    return r.rows.map((row) => rowToReview(row as unknown as RawReviewRow));
  });
}

export async function listReviewsByReviewer(
  reviewerDid: string,
  opts: { includeRemoved?: boolean } = {},
): Promise<ReviewRow[]> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        SELECT r.*, rr.body AS response_body,
               rr.responder_did AS response_responder_did,
               rr.created_at AS response_created_at,
               rr.updated_at AS response_updated_at
        FROM review r
        LEFT JOIN review_response rr ON rr.review_id = r.id
        WHERE r.reviewer_did = ?
          ${opts.includeRemoved ? "" : "AND r.status != 'removed'"}
        ORDER BY r.updated_at DESC
      `,
      args: [reviewerDid],
    });
    return r.rows.map((row) => rowToReview(row as unknown as RawReviewRow));
  });
}

export async function upsertReviewResponse(input: {
  reviewId: number;
  responderDid: string;
  body: string;
}): Promise<void> {
  await withDb(async (c) => {
    const now = Date.now();
    await c.execute({
      sql: `
        INSERT INTO review_response (
          review_id, responder_did, body, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(review_id) DO UPDATE SET
          responder_did = excluded.responder_did,
          body = excluded.body,
          updated_at = excluded.updated_at
      `,
      args: [input.reviewId, input.responderDid, input.body, now, now],
    });
  });
}

export async function deleteReviewResponse(
  reviewId: number,
  responderDid: string,
): Promise<boolean> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        DELETE FROM review_response
        WHERE review_id = ? AND responder_did = ?
      `,
      args: [reviewId, responderDid],
    });
    return Number(r.rowsAffected ?? 0) > 0;
  });
}

const REPORT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function createReviewReport(input: {
  reviewId: number;
  reporterDid: string | null;
  ipHash: string | null;
  reason: ReviewReportReason;
  details?: string | null;
}): Promise<{ ok: true; id: number } | { ok: false; reason: "duplicate" }> {
  return await withDb(async (c) => {
    if (input.ipHash) {
      const dup = await c.execute({
        sql: `
          SELECT id FROM review_report
          WHERE review_id = ? AND reporter_ip_hash = ? AND reason = ?
            AND created_at >= ?
          LIMIT 1
        `,
        args: [
          input.reviewId,
          input.ipHash,
          input.reason,
          Date.now() - REPORT_DEDUP_WINDOW_MS,
        ],
      });
      if (dup.rows.length > 0) return { ok: false, reason: "duplicate" };
    }
    const r = await c.execute({
      sql: `
        INSERT INTO review_report (
          review_id, reporter_did, reporter_ip_hash, reason, details,
          status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'open', ?)
      `,
      args: [
        input.reviewId,
        input.reporterDid,
        input.ipHash,
        input.reason,
        input.details ?? null,
        Date.now(),
      ],
    });
    return { ok: true, id: Number(r.lastInsertRowid ?? 0) };
  });
}

export async function listOpenReviewReports(): Promise<ReviewReportRow[]> {
  return await withDb(async (c) => {
    const r = await c.execute(`
      SELECT
        rp.id AS report_id, rp.review_id, rp.reporter_did, rp.reason,
        rp.details, rp.status AS report_status, rp.admin_notes AS report_notes,
        rp.created_at AS report_created_at, rp.resolved_at, rp.resolved_by,
        rv.id, rv.target_did, rv.reviewer_did, rv.rating, rv.body,
        rv.status, rv.created_at, rv.updated_at, rv.hidden_at, rv.hidden_by,
        rv.removed_at, rv.removed_by, rv.admin_notes
      FROM review_report rp
      LEFT JOIN review rv ON rv.id = rp.review_id
      WHERE rp.status = 'open'
      ORDER BY rp.created_at ASC
    `);
    return r.rows.map((row) => {
      const record = row as Record<string, unknown>;
      const report: RawReviewReportRow = {
        id: Number(record.report_id),
        review_id: Number(record.review_id),
        reporter_did: record.reporter_did as string | null,
        reason: String(record.reason ?? "other"),
        details: record.details as string | null,
        status: String(record.report_status ?? "open"),
        admin_notes: record.report_notes as string | null,
        created_at: Number(record.report_created_at),
        resolved_at: record.resolved_at == null
          ? null
          : Number(record.resolved_at),
        resolved_by: record.resolved_by as string | null,
      };
      const review = record.id == null ? null : {
        id: Number(record.id),
        target_did: String(record.target_did),
        reviewer_did: String(record.reviewer_did),
        rating: Number(record.rating),
        body: String(record.body ?? ""),
        status: String(record.status ?? "visible"),
        created_at: Number(record.created_at),
        updated_at: Number(record.updated_at),
        hidden_at: record.hidden_at == null ? null : Number(record.hidden_at),
        hidden_by: record.hidden_by as string | null,
        removed_at: record.removed_at == null
          ? null
          : Number(record.removed_at),
        removed_by: record.removed_by as string | null,
        admin_notes: record.admin_notes as string | null,
      };
      return rowToReviewReport(report, review);
    });
  });
}

export async function countOpenReviewReports(): Promise<number> {
  return await withDb(async (c) => {
    const r = await c.execute(
      `SELECT COUNT(*) AS n FROM review_report WHERE status = 'open'`,
    );
    return Number((r.rows[0] as Record<string, unknown>).n ?? 0);
  });
}

export async function resolveReviewReport(
  id: number,
  resolver: string,
  status: "actioned" | "dismissed",
  notes?: string | null,
): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql: `
        UPDATE review_report SET
          status = ?,
          admin_notes = ?,
          resolved_at = ?,
          resolved_by = ?
        WHERE id = ?
      `,
      args: [status, notes ?? null, Date.now(), resolver, id],
    });
  });
}

export async function moderateReview(
  id: number,
  moderatorDid: string,
  action: "hide" | "remove" | "restore",
  notes?: string | null,
): Promise<boolean> {
  return await withDb(async (c) => {
    const now = Date.now();
    const sql = action === "restore"
      ? `
        UPDATE review SET
          status = 'visible',
          updated_at = ?,
          hidden_at = NULL,
          hidden_by = NULL,
          removed_at = NULL,
          removed_by = NULL,
          admin_notes = ?
        WHERE id = ?
      `
      : action === "hide"
      ? `
        UPDATE review SET
          status = 'hidden',
          updated_at = ?,
          hidden_at = ?,
          hidden_by = ?,
          admin_notes = ?
        WHERE id = ?
      `
      : `
        UPDATE review SET
          status = 'removed',
          updated_at = ?,
          removed_at = ?,
          removed_by = ?,
          admin_notes = ?
        WHERE id = ?
      `;
    const args = action === "restore"
      ? [now, notes ?? null, id]
      : [now, now, moderatorDid, notes ?? null, id];
    const r = await c.execute({ sql, args });
    return Number(r.rowsAffected ?? 0) > 0;
  });
}
