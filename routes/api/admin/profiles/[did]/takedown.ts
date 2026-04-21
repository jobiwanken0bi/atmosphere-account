/**
 * Admin: take a profile down. Removes it from /explore + /api/registry/*
 * reads (search, featured, profile detail, icon, avatar). The user's
 * PDS record is untouched — only this AppView refuses to serve it.
 *
 *   POST /api/admin/profiles/:did/takedown
 *   { reason: string, notes?: string }
 *
 * As a side effect, all open reports against this DID are resolved as
 * `actioned` with the takedown reason in admin_notes — leaving them
 * "open" would be noise once the underlying issue has been removed.
 */
import { define } from "../../../../../utils.ts";
import { requireAdminApi } from "../../../../../lib/admin.ts";
import {
  getProfileByDid,
  takedownProfile,
} from "../../../../../lib/registry.ts";
import { resolveOpenReportsForTarget } from "../../../../../lib/reports.ts";

const MAX_REASON_LEN = 500;

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    const did = decodeURIComponent(ctx.params.did);
    if (!did.startsWith("did:")) return jsonError(400, "invalid_did");

    const body = await ctx.req.json().catch(() => null) as
      | { reason?: unknown; notes?: unknown }
      | null;
    const rawReason = typeof body?.reason === "string"
      ? body.reason.trim()
      : "";
    if (!rawReason) return jsonError(400, "missing_reason");
    const reason = rawReason.slice(0, MAX_REASON_LEN);
    const notes = typeof body?.notes === "string"
      ? body.notes.trim().slice(0, 1000) || null
      : null;

    /** Confirm the profile actually exists (in any state) before
     *  flipping its takedown flag — avoids leaving a stub row that
     *  nothing else has indexed. */
    const profile = await getProfileByDid(did, { includeTakenDown: true })
      .catch(() => null);
    if (!profile) return jsonError(404, "not_found");

    try {
      await takedownProfile(did, reason, gate.did);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return jsonError(500, "takedown_failed", m);
    }

    /** Best-effort auto-resolve. We don't fail the whole request if
     *  this errors — the takedown itself succeeded, which is the
     *  hard guarantee we care about. */
    let resolvedReports = 0;
    try {
      resolvedReports = await resolveOpenReportsForTarget(
        did,
        gate.did,
        `Auto-resolved by takedown: ${reason}${notes ? ` — ${notes}` : ""}`,
      );
    } catch (err) {
      console.warn(
        "[admin] takedown succeeded but report auto-resolve failed:",
        err,
      );
    }

    return new Response(
      JSON.stringify({ ok: true, resolvedReports }),
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
