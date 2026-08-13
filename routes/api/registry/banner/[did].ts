/**
 * Proxies a project's banner blob from the owner's PDS for the in-page
 * `<img>` (full resolution). Open Graph / Twitter meta images use
 * `/api/registry/project-og/{handle}` (or `og-banner/{did}`) — a small
 * 1200×630 JPEG for embed pipelines that struggle with large PNGs.
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
import { secureRasterImageProxyResponse } from "../../../../lib/raster-image-security.ts";
import {
  cachedDerivedMediaRedirect,
  profileDerivedMediaKey,
  storeVerifiedMediaResponse,
} from "../../../../lib/derived-media-cache.ts";

const MAX_BANNER_BYTES = 3_000_000;
const CACHE_CONTROL =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = decodeURIComponent(ctx.params.did);
    const profile = await getProfileByDid(did).catch(() => null);
    if (!profile?.bannerCid) {
      return new Response("not found", { status: 404 });
    }
    const cacheKey = profileDerivedMediaKey({
      kind: "banner",
      did,
      cid: profile.bannerCid,
    });
    const cached = await cachedDerivedMediaRedirect(cacheKey);
    if (cached) return cached;
    try {
      const upstream = await fetchBlobPublic(
        profile.pdsUrl,
        did,
        profile.bannerCid,
      );
      if (!upstream.ok) {
        return new Response("not found", { status: 404 });
      }
      const response = await secureRasterImageProxyResponse(upstream, {
        cid: profile.bannerCid,
        declaredMime: profile.bannerMime,
        maxBytes: MAX_BANNER_BYTES,
        cacheControl: CACHE_CONTROL,
        etag: profile.bannerCid,
        filename: "atmosphere-banner",
        crossOrigin: true,
      });
      if (response.ok) {
        void storeVerifiedMediaResponse(
          cacheKey,
          response.clone(),
          "atmosphere-banner",
        );
      }
      return response;
    } catch (err) {
      console.warn("[banner] proxy error:", err);
      return new Response("upstream error", { status: 502 });
    }
  }),
});
