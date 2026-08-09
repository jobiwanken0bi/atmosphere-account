/**
 * Proxy + cache a profile screenshot blob. Screenshots are only rendered on
 * profile detail pages and are lazy-loaded by the browser, so list pages never
 * pull these image bytes.
 */
import { define } from "../../../../../utils.ts";
import { getProfileByDid } from "../../../../../lib/registry.ts";
import { withRateLimit } from "../../../../../lib/rate-limit.ts";
import { fetchScreenshotBlobWithPdsFallback } from "../../../../../lib/screenshot-blob.ts";
import { secureRasterImageProxyResponse } from "../../../../../lib/raster-image-security.ts";

const NEGATIVE_CACHE_MS = 60_000;
const NEGATIVE_CACHE_MAX_ENTRIES = 500;
const MAX_SCREENSHOT_BYTES = 5_000_000;
const CACHE_CONTROL =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";
const negativeCache = new Map<string, number>();

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
    const cacheKey = `${did}:${screenshot.image.ref.$link}`;
    if ((negativeCache.get(cacheKey) ?? 0) > Date.now()) {
      return negativeResponse();
    }
    try {
      const cid = screenshot.image.ref.$link;
      const fetched = await fetchScreenshotBlobWithPdsFallback({
        storedPdsUrl: profile.pdsUrl,
        did,
        cid,
      });
      const upstream = fetched.response;
      if (!upstream?.ok) {
        rememberNegative(cacheKey);
        if (fetched.errors.length > 0) {
          console.info(
            `[screenshot] upstream unavailable did=${did} fallback=${fetched.usedResolvedPds}`,
          );
        }
        return negativeResponse();
      }
      negativeCache.delete(cacheKey);
      return await secureRasterImageProxyResponse(upstream, {
        cid,
        declaredMime: screenshot.image.mimeType,
        maxBytes: Math.min(
          MAX_SCREENSHOT_BYTES,
          Math.max(0, screenshot.image.size || MAX_SCREENSHOT_BYTES),
        ),
        // The route is keyed by did/index rather than immutable CID, so keep
        // shared caching bounded when a profile replaces a screenshot.
        cacheControl: CACHE_CONTROL,
        etag: cid,
        filename: `atmosphere-screenshot-${index + 1}`,
      });
    } catch (err) {
      rememberNegative(cacheKey);
      console.info(
        `[screenshot] proxy unavailable did=${did}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return negativeResponse();
    }
  }),
});

function negativeResponse(): Response {
  return new Response("not found", {
    status: 404,
    headers: { "cache-control": "public, max-age=60" },
  });
}

function rememberNegative(cacheKey: string): void {
  const now = Date.now();
  for (const [key, expiresAt] of negativeCache) {
    if (expiresAt <= now) negativeCache.delete(key);
  }
  negativeCache.delete(cacheKey);
  negativeCache.set(cacheKey, now + NEGATIVE_CACHE_MS);
  while (negativeCache.size > NEGATIVE_CACHE_MAX_ENTRIES) {
    const oldest = negativeCache.keys().next().value;
    if (oldest === undefined) break;
    negativeCache.delete(oldest);
  }
}
