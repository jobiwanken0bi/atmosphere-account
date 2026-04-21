/**
 * Admin: deny (or revoke) SVG-icon upload access for a project.
 *
 *   POST /api/admin/icon-access/:did/deny   { reason? }
 *
 * Used both for initial denials of a `requested` project and to revoke
 * a previously-granted project. The row stays in `denied` until an
 * admin manually grants again — the user is shown the appeal email and
 * cannot self-re-request.
 */
import { define } from "../../../../../utils.ts";
import { requireAdminApi } from "../../../../../lib/admin.ts";
import { denyIconAccess } from "../../../../../lib/registry.ts";

interface DenyPayload {
  reason?: unknown;
}

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    const did = decodeURIComponent(ctx.params.did);
    if (!did.startsWith("did:")) return jsonError(400, "invalid_did");

    const body = await ctx.req.json().catch(() => null) as DenyPayload | null;
    const reason = typeof body?.reason === "string" ? body.reason : undefined;

    try {
      await denyIconAccess(did, gate.did, reason);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return jsonError(500, "deny_failed", m);
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
