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
import { iconProxyCacheControl } from "../../../../lib/icon-proxy-cache.ts";
import { isDid } from "../../../../lib/identity.ts";
import {
  readSecureSvgBlob,
  secureSvgErrorResponse,
} from "../../../../lib/svg-blob-security.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = routeDid(ctx.params.did);
    if (!did) return new Response("not found", { status: 404 });
    const profile = await getProfileByDid(did).catch(() => null);
    if (!profile || !profile.iconCid) {
      return new Response("not found", { status: 404 });
    }
    /** Refuse to serve unless the project is verified AND the icon has
     *  been auto-approved on upload. The blob itself is on the user's
     *  PDS regardless — we just gate our proxy + iconUrl emission,
     *  which is what developer-facing API consumers rely on. The owner
     *  is allowed to see their own icon (any status) so the manage-page
     *  preview keeps working through pending / denied transitions. */
    const owner = ctx.state.user?.did === did;
    if (!owner) {
      if (profile.iconAccessStatus !== "granted") {
        return new Response("not found", { status: 404 });
      }
      if (profile.iconStatus !== "approved") {
        return new Response("not found", { status: 404 });
      }
    }
    try {
      const upstream = await fetchBlobPublic(
        profile.pdsUrl,
        did,
        profile.iconCid,
      );
      const secured = await readSecureSvgBlob(upstream, profile.iconCid);
      if (!secured.ok) return secureSvgErrorResponse(secured);
      const headers = new Headers();
      headers.set("content-type", "image/svg+xml; charset=utf-8");
      headers.set("x-content-type-options", "nosniff");
      headers.set(
        "content-security-policy",
        "default-src 'none'; sandbox; style-src 'unsafe-inline'; img-src data:",
      );
      headers.set(
        "content-disposition",
        'inline; filename="atmosphere-icon.svg"',
      );
      // Owner-only previews of unapproved/revoked icons must not enter shared
      // caches; only the currently public path gets a short shared window.
      headers.set(
        "cache-control",
        iconProxyCacheControl(
          profile.iconAccessStatus,
          profile.iconStatus,
        ),
      );
      headers.set("etag", profile.iconCid);
      headers.set("content-length", String(secured.bytes.byteLength));
      headers.set("cross-origin-resource-policy", "same-origin");
      const body = new Uint8Array(secured.bytes.byteLength);
      body.set(secured.bytes);
      return new Response(body, { status: 200, headers });
    } catch (err) {
      console.warn("icon proxy error:", err);
      return new Response("upstream error", { status: 502 });
    }
  }),
});

function routeDid(raw: string): string | null {
  try {
    const did = decodeURIComponent(raw);
    return isDid(did) ? did : null;
  } catch {
    return null;
  }
}
