/**
 * Admin: resolve an open review report.
 *
 *   POST /api/admin/review-reports/:id/resolve
 *   { action: 'actioned' | 'dismissed', notes?: string }
 */
import { define } from "../../../../../utils.ts";
import { requireAdminApi } from "../../../../../lib/admin.ts";
import { resolveReviewReport } from "../../../../../lib/reviews.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    const id = Number(ctx.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return jsonError(400, "invalid_id");
    }
    const body = await ctx.req.json().catch(() => null) as
      | { action?: unknown; notes?: unknown }
      | null;
    const action = body?.action;
    if (action !== "actioned" && action !== "dismissed") {
      return jsonError(400, "invalid_action");
    }
    const notes = typeof body?.notes === "string"
      ? body.notes.trim().slice(0, 1000) || null
      : null;

    await resolveReviewReport(id, gate.did, action, notes);
    return jsonResponse(200, { ok: true });
  },
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
