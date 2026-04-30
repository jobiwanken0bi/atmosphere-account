/**
 * Social / link-preview sized banner for `og:image` only (~1200×630 JPEG).
 *
 * Fast path: returns the pre-generated JPEG stored in the database at
 * profile-save time (< 10 ms, no PDS round-trip, no ImageScript).
 *
 * Slow path (fallback for older profiles that pre-date the og_jpeg cache):
 * fetches the full-resolution blob from the PDS, runs ImageScript
 * center-crop + JPEG re-encode, and stores the result back into the DB so
 * the next request hits the fast path.
 *
 * In-page banners keep using `/api/registry/banner/{did}`.
 */
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { define } from "../../../../utils.ts";
import {
  getOgJpeg,
  getProfileByDid,
  storeOgJpeg,
} from "../../../../lib/registry.ts";
import { fetchBlobPublic } from "../../../../lib/pds.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

const OG_W = 1200;
const OG_H = 630;
const JPEG_QUALITY = 85;

const OG_HEADERS = {
  "content-type": "image/jpeg",
  "cache-control":
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
  "content-disposition": 'inline; filename="og-banner.jpg"',
  "access-control-allow-origin": "*",
  "cross-origin-resource-policy": "cross-origin",
} as const;

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = decodeURIComponent(ctx.params.did);
    const profile = await getProfileByDid(did).catch(() => null);
    if (!profile?.bannerCid) {
      return new Response("not found", { status: 404 });
    }

    // ── Fast path: pre-generated JPEG already in the DB ──────────────────
    const cached = await getOgJpeg(did).catch(() => null);
    if (cached && cached.byteLength > 0) {
      return new Response(cached.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          ...OG_HEADERS,
          "content-length": String(cached.byteLength),
          "etag": `${profile.bannerCid}-og`,
        },
      });
    }

    // ── Slow path: fetch from PDS, resize, store, return ─────────────────
    try {
      const upstream = await fetchBlobPublic(
        profile.pdsUrl,
        did,
        profile.bannerCid,
      );
      if (!upstream.ok) {
        return new Response("not found", { status: 404 });
      }
      const buf = new Uint8Array(await upstream.arrayBuffer());
      try {
        const img = await Image.decode(buf);
        const jpeg = new Uint8Array(
          await img.cover(OG_W, OG_H).encodeJPEG(JPEG_QUALITY),
        );
        // Store asynchronously so the response isn't blocked by the DB write.
        storeOgJpeg(did, jpeg).catch((err) =>
          console.warn("[og-banner] failed to cache og_jpeg:", err)
        );
        return new Response(jpeg.buffer as ArrayBuffer, {
          status: 200,
          headers: {
            ...OG_HEADERS,
            "content-length": String(jpeg.byteLength),
            "etag": `${profile.bannerCid}-og`,
          },
        });
      } catch (resizeErr) {
        console.warn(
          "[og-banner] resize failed, serving raw bytes:",
          resizeErr,
        );
        const ct = upstream.headers.get("content-type") ??
          profile.bannerMime ??
          "application/octet-stream";
        return new Response(buf.buffer as ArrayBuffer, {
          status: 200,
          headers: {
            "content-type": ct,
            "content-length": String(buf.byteLength),
            "cache-control": OG_HEADERS["cache-control"],
            "content-disposition": "inline",
            "access-control-allow-origin": "*",
            "cross-origin-resource-policy": "cross-origin",
            "etag": profile.bannerCid,
          },
        });
      }
    } catch (err) {
      console.warn("[og-banner] proxy error:", err);
      return new Response("upstream error", { status: 502 });
    }
  }),
});
