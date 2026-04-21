/**
 * Admin-only proxy that serves a project's SVG icon regardless of
 * approval state — used by the review screen so admins can see what
 * they're approving / rejecting.
 *
 *   GET /api/admin/icons/:did/preview
 *
 * Same hardening headers as the public icon route (`Content-Security-
 * Policy: default-src 'none'; …`, `nosniff`, inline disposition) so
 * even an as-yet-unsanitised SVG can't run scripts in the admin's
 * browser.
 */
import { define } from "../../../../../utils.ts";
import { requireAdminApi } from "../../../../../lib/admin.ts";
import { getProfileByDid } from "../../../../../lib/registry.ts";
import { fetchBlobPublic } from "../../../../../lib/pds.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    const did = decodeURIComponent(ctx.params.did);
    // Include taken-down rows so admins can still inspect an icon that
    // was attached to a profile they later took down (useful when
    // restoring or re-evaluating).
    const profile = await getProfileByDid(did, { includeTakenDown: true })
      .catch(() => null);
    if (!profile || !profile.iconCid) {
      return new Response("not found", { status: 404 });
    }
    try {
      const upstream = await fetchBlobPublic(
        profile.pdsUrl,
        did,
        profile.iconCid,
      );
      if (!upstream.ok) {
        return new Response("not found", { status: 404 });
      }
      const headers = new Headers();
      headers.set("content-type", "image/svg+xml; charset=utf-8");
      headers.set("x-content-type-options", "nosniff");
      headers.set(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      );
      headers.set(
        "content-disposition",
        'inline; filename="atmosphere-icon-preview.svg"',
      );
      // Admin previews should never be cached by browsers / CDNs.
      headers.set("cache-control", "private, no-store");
      return new Response(upstream.body, { status: 200, headers });
    } catch (err) {
      console.warn("admin icon preview error:", err);
      return new Response("upstream error", { status: 502 });
    }
  },
});
