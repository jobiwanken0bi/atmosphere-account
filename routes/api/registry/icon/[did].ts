/**
 * Proxy + cache the developer-facing SVG icon for a registry profile.
 *
 *   GET /api/registry/icon/did:plc:abc123…
 *
 * Looks up `(pdsUrl, icon_cid)` in our DB and streams the bytes back
 * with conservative caching.
 *
 * SVGs can carry inline `<script>` and event handlers, so even though
 * we sanitise on upload (see `lib/svg-sanitize.ts`) we also harden the
 * serve path:
 *
 *   - `Content-Type: image/svg+xml`
 *   - `X-Content-Type-Options: nosniff`
 *   - `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline';
 *      img-src data:` — neutralises any script that survived the
 *      sanitiser when the SVG is loaded directly. CSP is ignored when
 *      the SVG is embedded via `<img>` in another document, but `<img>`
 *      embedding is intrinsically script-free.
 *   - `Content-Disposition: inline; filename="atmosphere-icon.svg"` so
 *     browsers render it instead of downloading.
 */
import { define } from "../../../../utils.ts";
import { getProfileByDid } from "../../../../lib/registry.ts";
import { fetchBlobPublic } from "../../../../lib/pds.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = decodeURIComponent(ctx.params.did);
    const profile = await getProfileByDid(did).catch(() => null);
    if (!profile || !profile.iconCid) {
      return new Response("not found", { status: 404 });
    }
    /** Refuse to serve until an admin has approved this icon. The blob
     *  itself is on the user's PDS regardless — we just gate our proxy +
     *  iconUrl emission, which is what developer-facing API consumers
     *  rely on. The owner is allowed to see their own pending/rejected
     *  icon so the manage-page preview keeps working. */
    if (profile.iconStatus !== "approved") {
      const owner = ctx.state.user?.did === did;
      if (!owner) return new Response("not found", { status: 404 });
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
        'inline; filename="atmosphere-icon.svg"',
      );
      // Owner-only previews of unapproved icons must not enter shared
      // caches; only the public approved path gets the long s-maxage.
      headers.set(
        "cache-control",
        profile.iconStatus === "approved"
          ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400"
          : "private, max-age=60",
      );
      headers.set("etag", profile.iconCid);
      return new Response(upstream.body, { status: 200, headers });
    } catch (err) {
      console.warn("icon proxy error:", err);
      return new Response("upstream error", { status: 502 });
    }
  }),
});
