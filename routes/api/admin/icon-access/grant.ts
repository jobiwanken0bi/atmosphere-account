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
import { readAdminJsonRequest } from "../../../../lib/admin-request.ts";

interface GrantPayload {
  identifier?: unknown;
}

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    const parsed = await readAdminJsonRequest(ctx.req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as GrantPayload;
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
      console.error("[admin] icon-access grant failed:", err);
      return jsonError(500, "grant_failed");
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

function jsonError(status: number, code: string): Response {
  return new Response(
    JSON.stringify({ error: code }),
    {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}
