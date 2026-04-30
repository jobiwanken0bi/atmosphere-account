/**
 * Proxies a project's banner blob from the owner's PDS for the in-page
 * `<img>` (full resolution). Open Graph / Twitter meta images use
 * `/api/registry/og-banner/{did}` instead — a small 1200×630 JPEG for embed
 * pipelines (e.g. Bluesky composer) that struggle with large PNGs.
 *
 * The response is aggressively cached — the cache key includes the DID
 * (stable) but not the CID, so cache-control is bounded the same way as
 * the screenshot proxy: long enough to be useful, short enough that a
 * banner replacement shows up within a day.
 */
import { define } from "../../../../utils.ts";
import { getProfileByDid } from "../../../../lib/registry.ts";
import { fetchBlobPublic } from "../../../../lib/pds.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = decodeURIComponent(ctx.params.did);
    const profile = await getProfileByDid(did).catch(() => null);
    if (!profile?.bannerCid) {
      return new Response("not found", { status: 404 });
    }
    try {
      const upstream = await fetchBlobPublic(
        profile.pdsUrl,
        did,
        profile.bannerCid,
      );
      if (!upstream.ok) {
        return new Response("not found", { status: 404 });
      }
      const headers = new Headers();
      headers.set(
        "content-type",
        upstream.headers.get("content-type") ??
          profile.bannerMime ??
          "image/jpeg",
      );
      headers.set(
        "cache-control",
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      );
      headers.set("etag", profile.bannerCid);
      headers.set("content-disposition", "inline");
      headers.set("access-control-allow-origin", "*");
      headers.set("cross-origin-resource-policy", "cross-origin");
      return new Response(upstream.body, { status: 200, headers });
    } catch (err) {
      console.warn("[banner] proxy error:", err);
      return new Response("upstream error", { status: 502 });
    }
  }),
});
