/**
 * Proxy + cache a profile screenshot blob. Screenshots are only rendered on
 * profile detail pages and are lazy-loaded by the browser, so list pages never
 * pull these image bytes.
 */
import { define } from "../../../../../utils.ts";
import { getProfileByDid } from "../../../../../lib/registry.ts";
import { fetchBlobPublic } from "../../../../../lib/pds.ts";
import { withRateLimit } from "../../../../../lib/rate-limit.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = decodeURIComponent(ctx.params.did);
    const index = Number(ctx.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= 4) {
      return new Response("not found", { status: 404 });
    }
    const profile = await getProfileByDid(did).catch(() => null);
    const screenshot = profile?.screenshots[index];
    if (!profile || !screenshot) {
      return new Response("not found", { status: 404 });
    }
    try {
      const cid = screenshot.image.ref.$link;
      const upstream = await fetchBlobPublic(profile.pdsUrl, did, cid);
      if (!upstream.ok) {
        return new Response("not found", { status: 404 });
      }
      const headers = new Headers();
      headers.set(
        "content-type",
        upstream.headers.get("content-type") ??
          screenshot.image.mimeType ??
          "application/octet-stream",
      );
      headers.set(
        "cache-control",
        // The blob CID is immutable, but this route is keyed by did/index, so
        // keep shared caching bounded in case a profile replaces a screenshot.
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      );
      headers.set("etag", cid);
      return new Response(upstream.body, { status: 200, headers });
    } catch (err) {
      console.warn("screenshot proxy error:", err);
      return new Response("upstream error", { status: 502 });
    }
  }),
});
