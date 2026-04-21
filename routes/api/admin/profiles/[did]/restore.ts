/**
 * Admin: restore a previously taken-down profile. Clears the four
 * takedown_* columns; the row immediately becomes visible again to
 * /explore + the public APIs.
 *
 *   POST /api/admin/profiles/:did/restore
 */
import { define } from "../../../../../utils.ts";
import { requireAdminApi } from "../../../../../lib/admin.ts";
import { restoreProfile } from "../../../../../lib/registry.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    const did = decodeURIComponent(ctx.params.did);
    if (!did.startsWith("did:")) return jsonError(400, "invalid_did");

    try {
      await restoreProfile(did);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return jsonError(500, "restore_failed", m);
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
