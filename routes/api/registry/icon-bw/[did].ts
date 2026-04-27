/**
 * Proxy + cache the developer-facing black-and-white SVG icon for a
 * registry profile. Mirrors `/api/registry/icon/:did` exactly — same
 * gating (project verification + per-icon approval), same security
 * headers, same caching policy.
 *
 *   GET /api/registry/icon-bw/did:plc:abc123…
 */
import { define } from "../../../../utils.ts";
import { getProfileByDid } from "../../../../lib/registry.ts";
import { fetchBlobPublic } from "../../../../lib/pds.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = decodeURIComponent(ctx.params.did);
    const profile = await getProfileByDid(did).catch(() => null);
    if (!profile || !profile.iconBwCid) {
      return new Response("not found", { status: 404 });
    }
    const owner = ctx.state.user?.did === did;
    if (!owner) {
      if (profile.iconAccessStatus !== "granted") {
        return new Response("not found", { status: 404 });
      }
      if (profile.iconBwStatus !== "approved") {
        return new Response("not found", { status: 404 });
      }
    }
    try {
      const upstream = await fetchBlobPublic(
        profile.pdsUrl,
        did,
        profile.iconBwCid,
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
        'inline; filename="atmosphere-icon-bw.svg"',
      );
      headers.set(
        "cache-control",
        profile.iconBwStatus === "approved"
          ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400"
          : "private, max-age=60",
      );
      headers.set("etag", profile.iconBwCid);
      return new Response(upstream.body, { status: 200, headers });
    } catch (err) {
      console.warn("icon-bw proxy error:", err);
      return new Response("upstream error", { status: 502 });
    }
  }),
});
