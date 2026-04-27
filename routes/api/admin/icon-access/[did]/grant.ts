/**
 * Admin: grant SVG-icon upload access to a project.
 *
 *   POST /api/admin/icon-access/:did/grant
 *
 * Idempotent — re-granting a project that's already granted just
 * refreshes the reviewer/timestamp.
 */
import { define } from "../../../../../utils.ts";
import { requireAdminApi } from "../../../../../lib/admin.ts";
import { grantIconAccess } from "../../../../../lib/registry.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    const did = decodeURIComponent(ctx.params.did);
    if (!did.startsWith("did:")) return jsonError(400, "invalid_did");

    try {
      const ok = await grantIconAccess(did, gate.did);
      if (!ok) return jsonError(404, "profile_not_found");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return jsonError(500, "grant_failed", m);
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
