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
import { readAdminJsonRequest } from "../../../../../lib/admin-request.ts";

interface DenyPayload {
  reason?: unknown;
}

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    const did = decodeURIComponent(ctx.params.did);
    if (!did.startsWith("did:")) return jsonError(400, "invalid_did");

    const parsed = await readAdminJsonRequest(ctx.req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as DenyPayload;
    const reason = typeof body.reason === "string"
      ? body.reason.trim().slice(0, 1000) || undefined
      : undefined;

    try {
      await denyIconAccess(did, gate.did, reason);
    } catch (err) {
      console.error("[admin] icon-access denial failed:", err);
      return jsonError(500, "deny_failed");
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  },
});

function jsonError(status: number, code: string): Response {
  return new Response(
    JSON.stringify({ error: code }),
    {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}
