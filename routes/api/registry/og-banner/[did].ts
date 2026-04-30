/**
 * Social / link-preview sized banner for `og:image` only (~1200×630 JPEG).
 * The full-resolution `/api/registry/banner/{did}` stream can be 600KB+ PNG;
 * Bluesky’s composer often fails to attach that as an external thumb while
 * Cardyb still previews it. This route decodes the same blob, center-crops to
 * 1.91:1, and re-encodes as JPEG so embed pipelines get a small same-origin
 * image similar to `/og-hero.png`. In-page banners keep using `/banner/`.
 */
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { define } from "../../../../utils.ts";
import { getProfileByDid } from "../../../../lib/registry.ts";
import { fetchBlobPublic } from "../../../../lib/pds.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

const OG_W = 1200;
const OG_H = 630;
const JPEG_QUALITY = 85;

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
      const buf = new Uint8Array(await upstream.arrayBuffer());
      try {
        const img = await Image.decode(buf);
        const cov = img.cover(OG_W, OG_H);
        const jpeg = new Uint8Array(await cov.encodeJPEG(JPEG_QUALITY));
        return new Response(jpeg.buffer as ArrayBuffer, {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(jpeg.byteLength),
            "cache-control":
              "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
            "etag": `${profile.bannerCid}-og`,
            "content-disposition": 'inline; filename="og-banner.jpg"',
            "access-control-allow-origin": "*",
            "cross-origin-resource-policy": "cross-origin",
          },
        });
      } catch (err) {
        console.warn("[og-banner] resize failed, serving raw bytes:", err);
        const ct = upstream.headers.get("content-type") ??
          profile.bannerMime ?? "application/octet-stream";
        return new Response(buf.buffer as ArrayBuffer, {
          status: 200,
          headers: {
            "content-type": ct,
            "content-length": String(buf.byteLength),
            "cache-control":
              "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
            "etag": profile.bannerCid,
            "content-disposition": "inline",
            "access-control-allow-origin": "*",
            "cross-origin-resource-policy": "cross-origin",
          },
        });
      }
    } catch (err) {
      console.warn("[og-banner] proxy error:", err);
      return new Response("upstream error", { status: 502 });
    }
  }),
});
