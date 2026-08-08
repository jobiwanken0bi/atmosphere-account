/**
 * Admin: hide a review from public UI and aggregates while retaining it.
 */
import { define } from "../../../../../utils.ts";
import { requireAdminApi } from "../../../../../lib/admin.ts";
import { moderateReview } from "../../../../../lib/reviews.ts";
import { readAdminJsonRequest } from "../../../../../lib/admin-request.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;
    return await moderate(ctx.params.reviewId, gate.did, "hide", ctx.req);
  },
});

async function moderate(
  rawId: string | undefined,
  adminDid: string,
  action: "hide" | "remove" | "restore",
  req: Request,
): Promise<Response> {
  const id = Number(rawId);
  if (!Number.isFinite(id) || id <= 0) return jsonError(400, "invalid_id");
  const parsed = await readAdminJsonRequest(req);
  if (!parsed.ok) return parsed.response;
  const notes = typeof parsed.value.notes === "string"
    ? parsed.value.notes.trim().slice(0, 1000) || null
    : null;
  const ok = await moderateReview(id, adminDid, action, notes);
  return ok ? jsonResponse(200, { ok: true }) : jsonError(404, "not_found");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}
