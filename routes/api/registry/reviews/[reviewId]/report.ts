/**
 * Signed-in report submission for an individual review.
 *
 *   POST /api/registry/reviews/:reviewId/report { reason, details? }
 */
import { define } from "../../../../../utils.ts";
import { withRateLimit } from "../../../../../lib/rate-limit.ts";
import { callerIp, hashIp } from "../../../../../lib/reports.ts";
import {
  createReviewReport,
  getReviewById,
  REVIEW_REPORT_REASONS,
  type ReviewReportReason,
} from "../../../../../lib/reviews.ts";

interface ReportPayload {
  reason?: unknown;
  details?: unknown;
}

const MAX_DETAILS_LEN = 500;

export const handler = define.handlers({
  POST: withRateLimit(async (ctx) => {
    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const reviewId = Number(ctx.params.reviewId);
    if (!Number.isFinite(reviewId) || reviewId <= 0) {
      return jsonError(400, "invalid_review_id");
    }
    const review = await getReviewById(reviewId);
    if (!review || review.status !== "visible") {
      return jsonError(404, "not_found");
    }

    const body = await ctx.req.json().catch(() => null) as
      | ReportPayload
      | null;
    if (!body) return jsonError(400, "invalid_body");

    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!(REVIEW_REPORT_REASONS as readonly string[]).includes(reason)) {
      return jsonError(400, "invalid_reason");
    }
    const details = typeof body.details === "string"
      ? body.details.trim().slice(0, MAX_DETAILS_LEN) || null
      : null;

    const ip = callerIp(ctx.req);
    const ipHash = ip === "anonymous" ? null : await hashIp(ip);
    const result = await createReviewReport({
      reviewId,
      reporterDid: user.did,
      ipHash,
      reason: reason as ReviewReportReason,
      details,
    });

    return jsonResponse(200, { ok: true, deduped: result.ok === false });
  }),
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}
