/**
 * Shared logic for project link-preview JPEGs (1200×630).
 * Used by `/api/registry/og-banner/{did}` and `/api/registry/project-og/{handle}`.
 */
import type { ProfileRow } from "./registry.ts";
import { getOgJpeg, storeOgJpeg } from "./registry.ts";
import { fetchBlobPublic } from "./pds.ts";
import {
  matchesRasterImageSignature,
  readRasterImageBytesWithLimit,
  safeRasterImageMime,
} from "./raster-image-security.ts";

const OG_W = 1200;
const OG_H = 630;
const JPEG_QUALITY = 85;
const MAX_BANNER_BYTES = 3_000_000;

/** Copy only the bytes covered by `u` into a standalone ArrayBuffer for Response. */
function u8ToExactArrayBuffer(u: Uint8Array): ArrayBuffer {
  if (u.byteOffset === 0 && u.byteLength === u.buffer.byteLength) {
    return u.buffer as ArrayBuffer;
  }
  return u.buffer.slice(
    u.byteOffset,
    u.byteOffset + u.byteLength,
  ) as ArrayBuffer;
}

const CACHE_CONTROL =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

function looksLikeJpeg(u: Uint8Array): boolean {
  return u.byteLength > 3 && u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff;
}

const JPEG_HEADERS = {
  "content-type": "image/jpeg",
  "cache-control": CACHE_CONTROL,
  "content-disposition": "inline",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
  "access-control-allow-origin": "*",
  "cross-origin-resource-policy": "cross-origin",
} as const;

function jpegResponse(jpeg: Uint8Array, etag: string): Response {
  return new Response(u8ToExactArrayBuffer(jpeg), {
    status: 200,
    headers: {
      ...JPEG_HEADERS,
      "content-length": String(jpeg.byteLength),
      etag,
    },
  });
}

/**
 * Build a 200 `Response` for the profile’s OG / link-card image, or `null` if
 * there is no banner or the upstream blob is missing.
 */
export async function buildOgBannerResponse(
  profile: ProfileRow,
): Promise<Response | null> {
  if (!profile.bannerCid) return null;

  const cached = await getOgJpeg(profile.did).catch(() => null);
  if (cached && cached.byteLength > 0 && looksLikeJpeg(cached)) {
    return jpegResponse(cached, `${profile.bannerCid}-og`);
  }

  let upstream: Response;
  try {
    upstream = await fetchBlobPublic(
      profile.pdsUrl,
      profile.did,
      profile.bannerCid,
    );
  } catch (err) {
    console.warn("[og-banner] proxy error:", err);
    return null;
  }
  if (!upstream.ok) return null;

  const contentType = safeRasterImageMime(profile.bannerMime) ??
    safeRasterImageMime(upstream.headers.get("content-type"));
  const buf = await readRasterImageBytesWithLimit(upstream, MAX_BANNER_BYTES);
  if (!buf || !contentType || !matchesRasterImageSignature(buf, contentType)) {
    return null;
  }
  try {
    // Sharp/libvips is intentionally lazy: cached OG images and ordinary API
    // requests should not pay its native startup and resident-memory cost.
    const { coverJpeg } = await import("./image-processing.ts");
    const jpeg = await coverJpeg(buf, OG_W, OG_H, JPEG_QUALITY);
    storeOgJpeg(profile.did, jpeg).catch((err) =>
      console.warn("[og-banner] failed to cache og_jpeg:", err)
    );
    return jpegResponse(jpeg, `${profile.bannerCid}-og`);
  } catch (err) {
    console.warn("[og-banner] resize failed, serving raw bytes:", err);
    return new Response(u8ToExactArrayBuffer(buf), {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(buf.byteLength),
        "cache-control": CACHE_CONTROL,
        "content-disposition": "inline",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
        "etag": profile.bannerCid,
      },
    });
  }
}
