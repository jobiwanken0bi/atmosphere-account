/**
 * Proxies a project's banner blob from the owner's PDS for the in-page
 * `<img>`. Cache misses are converted to a bounded WebP variant before they
 * are written to derived-media storage; the canonical full-resolution blob
 * remains on the PDS. Open Graph / Twitter meta images use
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
import {
  matchesRasterImageSignature,
  secureRasterImageProxyResponse,
} from "../../../../lib/raster-image-security.ts";
import {
  cachedDerivedMediaRedirect,
  profileDerivedMediaKey,
  storeVerifiedMediaResponse,
} from "../../../../lib/derived-media-cache.ts";

const MAX_BANNER_BYTES = 3_000_000;
export const BANNER_DERIVED_WIDTH = 1600;
const BANNER_DERIVED_QUALITY = 82;
const CACHE_CONTROL =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

type BannerTransform = (
  bytes: Uint8Array,
  maxWidth: number,
  quality: number,
) => Promise<Uint8Array>;

export function bannerDerivedMediaKey(did: string, cid: string): string {
  return profileDerivedMediaKey({
    kind: "banner",
    did,
    cid,
    width: BANNER_DERIVED_WIDTH,
  });
}

/**
 * Build the cacheable derived representation without consuming the verified
 * fallback response. A native image-processing failure must never persist the
 * original bytes under a derived WebP key.
 */
export async function deriveVerifiedBannerResponse(
  verified: Response,
  transform: BannerTransform,
  etag: string,
): Promise<{ response: Response; transformed: boolean }> {
  if (!verified.ok || !verified.body) {
    return { response: verified, transformed: false };
  }
  try {
    const source = new Uint8Array(await verified.clone().arrayBuffer());
    const webp = await transform(
      source,
      BANNER_DERIVED_WIDTH,
      BANNER_DERIVED_QUALITY,
    );
    if (!matchesRasterImageSignature(webp, "image/webp")) {
      return { response: verified, transformed: false };
    }
    const body = Uint8Array.from(webp);
    const headers = new Headers(verified.headers);
    headers.set("content-type", "image/webp");
    headers.set("content-length", String(body.byteLength));
    headers.set(
      "content-disposition",
      `inline; filename="atmosphere-banner-${BANNER_DERIVED_WIDTH}.webp"`,
    );
    headers.set("etag", `W/"${etag}-w-${BANNER_DERIVED_WIDTH}-webp"`);
    return {
      response: new Response(body, {
        status: verified.status,
        headers,
      }),
      transformed: true,
    };
  } catch (err) {
    console.info(
      `[banner] resize unavailable; serving verified original: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { response: verified, transformed: false };
  }
}

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = decodeURIComponent(ctx.params.did);
    const profile = await getProfileByDid(did).catch(() => null);
    if (!profile?.bannerCid) {
      return new Response("not found", { status: 404 });
    }
    const cacheKey = bannerDerivedMediaKey(did, profile.bannerCid);
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
      const verified = await secureRasterImageProxyResponse(upstream, {
        cid: profile.bannerCid,
        declaredMime: profile.bannerMime,
        maxBytes: MAX_BANNER_BYTES,
        cacheControl: CACHE_CONTROL,
        etag: profile.bannerCid,
        filename: "atmosphere-banner",
        crossOrigin: true,
      });
      if (!verified.ok) return verified;
      const derived = await deriveVerifiedBannerResponse(
        verified,
        async (bytes, width, quality) => {
          const { fitWebp } = await import(
            "../../../../lib/image-processing.ts"
          );
          return await fitWebp(bytes, width, quality);
        },
        profile.bannerCid,
      );
      if (derived.transformed) {
        void storeVerifiedMediaResponse(
          cacheKey,
          derived.response.clone(),
          `atmosphere-banner-${BANNER_DERIVED_WIDTH}.webp`,
        );
      }
      return derived.response;
    } catch (err) {
      console.warn("[banner] proxy error:", err);
      return new Response("upstream error", { status: 502 });
    }
  }),
});
