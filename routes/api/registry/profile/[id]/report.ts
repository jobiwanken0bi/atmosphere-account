/**
 * Public report submission for a registry profile.
 *
 *   POST /api/registry/profile/:id/report  { reason, details? }
 *
 * `:id` accepts a handle or DID, mirroring the public read endpoint
 * one directory up.
 *
 * Reports are anonymous unless the caller has an OAuth session (in
 * which case the reporter's DID is recorded). Same-IP submissions for
 * the same target/reason within 24h are silently deduped — we still
 * return 200 so spammers don't learn what's already on file.
 *
 * Rate-limited via the shared per-IP soft limit (`withRateLimit`).
 */
import { define } from "../../../../../utils.ts";
import { withRateLimit } from "../../../../../lib/rate-limit.ts";
import {
  getProfileByDid,
  getProfileByHandle,
} from "../../../../../lib/registry.ts";
import {
  callerIp,
  createReport,
  hashIp,
  REPORT_REASONS,
  type ReportReason,
} from "../../../../../lib/reports.ts";

interface ReportPayload {
  reason?: unknown;
  details?: unknown;
}

const MAX_DETAILS_LEN = 500;

export const handler = define.handlers({
  POST: withRateLimit(async (ctx) => {
    const raw = decodeURIComponent(ctx.params.id ?? "").trim();
    if (!raw) return jsonError(400, "missing_id");

    const target = raw.startsWith("did:")
      ? await getProfileByDid(raw).catch(() => null)
      : await getProfileByHandle(raw.toLowerCase()).catch(() => null);
    if (!target) return jsonError(404, "not_found");

    const body = await ctx.req.json().catch(() => null) as
      | ReportPayload
      | null;
    if (!body) return jsonError(400, "invalid_body");

    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
      return jsonError(400, "invalid_reason");
    }
    const details = typeof body.details === "string"
      ? body.details.trim().slice(0, MAX_DETAILS_LEN) || null
      : null;

    const ip = callerIp(ctx.req);
    const ipHash = ip === "anonymous" ? null : await hashIp(ip);
    const reporterDid = ctx.state.user?.did ?? null;

    const result = await createReport({
      targetDid: target.did,
      reporterDid,
      ipHash,
      reason: reason as ReportReason,
      details,
    });

    /** We always return 200 — even when deduped — so the caller can't
     *  use the API to probe for prior reports against a target. */
    return new Response(
      JSON.stringify({
        ok: true,
        deduped: result.ok === false,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }),
});

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
