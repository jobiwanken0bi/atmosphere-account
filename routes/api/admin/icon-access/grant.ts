/**
 * Admin: proactively verify any existing registry profile by DID or handle.
 *
 *   POST /api/admin/icon-access/grant   { identifier: "handle.example" }
 */
import { define } from "../../../../utils.ts";
import { requireAdminApi } from "../../../../lib/admin.ts";
import {
  findIconAccessTarget,
  grantIconAccess,
} from "../../../../lib/registry.ts";

interface GrantPayload {
  identifier?: unknown;
}

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    const body = await ctx.req.json().catch(() => null) as GrantPayload | null;
    const identifier = typeof body?.identifier === "string"
      ? body.identifier.trim()
      : "";
    if (!identifier) return jsonError(400, "missing_identifier");

    const target = await findIconAccessTarget(identifier);
    if (!target) return jsonError(404, "profile_not_found");

    try {
      const ok = await grantIconAccess(target.did, gate.did);
      if (!ok) return jsonError(404, "profile_not_found");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return jsonError(500, "grant_failed", m);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        profile: {
          did: target.did,
          handle: target.handle,
          name: target.name,
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
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
