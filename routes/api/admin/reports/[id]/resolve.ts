/**
 * Admin: resolve an open report.
 *
 *   POST /api/admin/reports/:id/resolve
 *   { action: 'actioned' | 'dismissed', notes?: string }
 */
import { define } from "../../../../../utils.ts";
import { requireAdminApi } from "../../../../../lib/admin.ts";
import { resolveReport } from "../../../../../lib/reports.ts";

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

    try {
      await resolveReport(id, gate.did, action, notes);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return jsonError(500, "resolve_failed", m);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  },
});

function jsonError(status: number, code: string, detail?: string): Response {
  return new Response(
    JSON.stringify(detail ? { error: code, detail } : { error: code }),
    {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}
