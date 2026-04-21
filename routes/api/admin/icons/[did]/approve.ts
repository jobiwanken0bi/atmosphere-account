/**
 * Admin: approve a pending SVG icon for a project.
 *
 *   POST /api/admin/icons/:did/approve
 *
 * On success, /api/registry/icon/:did starts serving the bytes and
 * /api/registry/profile/:id begins emitting `iconUrl` for the project.
 */
import { define } from "../../../../../utils.ts";
import { requireAdminApi } from "../../../../../lib/admin.ts";
import { approveIcon } from "../../../../../lib/registry.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    const did = decodeURIComponent(ctx.params.did);
    if (!did.startsWith("did:")) {
      return jsonError(400, "invalid_did");
    }
    try {
      await approveIcon(did, gate.did);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return jsonError(500, "approve_failed", m);
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
