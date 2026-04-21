/**
 * Admin: reject a pending SVG icon for a project.
 *
 *   POST /api/admin/icons/:did/reject  { reason: string }
 *
 * The reason is shown to the project owner on /explore/manage so they
 * know why their icon isn't appearing in the developer API.
 */
import { define } from "../../../../../utils.ts";
import { requireAdminApi } from "../../../../../lib/admin.ts";
import { rejectIcon } from "../../../../../lib/registry.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    const did = decodeURIComponent(ctx.params.did);
    if (!did.startsWith("did:")) {
      return jsonError(400, "invalid_did");
    }
    const body = await ctx.req.json().catch(() => null) as
      | { reason?: unknown }
      | null;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) return jsonError(400, "missing_reason");

    try {
      await rejectIcon(did, gate.did, reason);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return jsonError(500, "reject_failed", m);
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
