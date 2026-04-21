/**
 * User-submitted reports against registry profiles. Backed by the
 * `report` table; admin UI lives at /admin/reports, public submission
 * at POST /api/registry/profile/:id/report.
 *
 * IPs are hashed with `REPORT_IP_SECRET` so we can dedup repeated
 * submissions from the same source within 24h without ever storing the
 * raw address. Authenticated reports additionally record the
 * reporter's DID.
 */
import { withDb } from "./db.ts";
import { REPORT_IP_SECRET } from "./env.ts";

export const REPORT_REASONS = [
  "not_a_project",
  "harmful",
  "impersonation",
  "spam",
  "other",
] as const;
export type ReportReason = typeof REPORT_REASONS[number];

export type ReportStatus = "open" | "actioned" | "dismissed";

export interface ReportRow {
  id: number;
  targetDid: string;
  reporterDid: string | null;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  adminNotes: string | null;
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
}

interface RawReportRow {
  id: number;
  target_did: string;
  reporter_did: string | null;
  reason: string;
  details: string | null;
  status: string;
  admin_notes: string | null;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
}

function rowToReport(r: RawReportRow): ReportRow {
  const reason = (REPORT_REASONS as readonly string[]).includes(r.reason)
    ? r.reason as ReportReason
    : "other";
  const status = r.status === "actioned" || r.status === "dismissed"
    ? r.status
    : "open";
  return {
    id: Number(r.id),
    targetDid: r.target_did,
    reporterDid: r.reporter_did,
    reason,
    details: r.details,
    status,
    adminNotes: r.admin_notes,
    createdAt: Number(r.created_at),
    resolvedAt: r.resolved_at != null ? Number(r.resolved_at) : null,
    resolvedBy: r.resolved_by,
  };
}

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Best-effort caller IP — same approach as `lib/rate-limit.ts`. */
export function callerIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "anonymous";
}

export async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}|${REPORT_IP_SECRET}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export interface CreateReportInput {
  targetDid: string;
  reporterDid: string | null;
  ipHash: string | null;
  reason: ReportReason;
  details?: string | null;
}

export type CreateReportResult =
  | { ok: true; id: number }
  | { ok: false; reason: "duplicate" };

export async function createReport(
  input: CreateReportInput,
): Promise<CreateReportResult> {
  return await withDb(async (c) => {
    if (input.ipHash) {
      const since = Date.now() - DEDUP_WINDOW_MS;
      const dup = await c.execute({
        sql: `
          SELECT id FROM report
          WHERE target_did = ? AND reporter_ip_hash = ? AND reason = ? AND created_at >= ?
          LIMIT 1
        `,
        args: [input.targetDid, input.ipHash, input.reason, since],
      });
      if (dup.rows.length > 0) {
        return { ok: false, reason: "duplicate" };
      }
    }
    const r = await c.execute({
      sql: `
        INSERT INTO report (
          target_did, reporter_did, reporter_ip_hash, reason, details,
          status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'open', ?)
      `,
      args: [
        input.targetDid,
        input.reporterDid,
        input.ipHash,
        input.reason,
        input.details ?? null,
        Date.now(),
      ],
    });
    const id = Number(r.lastInsertRowid ?? 0);
    return { ok: true, id };
  });
}

export async function listOpenReports(): Promise<ReportRow[]> {
  return await withDb(async (c) => {
    const r = await c.execute(`
      SELECT id, target_did, reporter_did, reason, details, status,
             admin_notes, created_at, resolved_at, resolved_by
      FROM report
      WHERE status = 'open'
      ORDER BY created_at ASC
    `);
    return r.rows.map((row) => rowToReport(row as unknown as RawReportRow));
  });
}

export async function countOpenReports(): Promise<number> {
  return await withDb(async (c) => {
    const r = await c.execute(
      `SELECT COUNT(*) AS n FROM report WHERE status = 'open'`,
    );
    return Number((r.rows[0] as Record<string, unknown>).n ?? 0);
  });
}

export async function resolveReport(
  id: number,
  resolver: string,
  status: "actioned" | "dismissed",
  notes?: string | null,
): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql: `
        UPDATE report SET
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

/**
 * Bulk-resolve every open report against a single target. Used when an
 * admin takes a profile down — reports are then "actioned" implicitly
 * by the takedown itself, so leaving them in the inbox would be noise.
 * Returns the number of rows updated for logging / UI feedback.
 */
export async function resolveOpenReportsForTarget(
  targetDid: string,
  resolver: string,
  notes?: string | null,
): Promise<number> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        UPDATE report SET
          status = 'actioned',
          admin_notes = ?,
          resolved_at = ?,
          resolved_by = ?
        WHERE target_did = ? AND status = 'open'
      `,
      args: [notes ?? null, Date.now(), resolver, targetDid],
    });
    return Number(r.rowsAffected ?? 0);
  });
}
