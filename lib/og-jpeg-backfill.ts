import { withDb } from "./db.ts";
import { coverJpeg } from "./image-processing.ts";
import { fetchBlobPublic } from "./pds.ts";
import {
  matchesRasterImageSignature,
  readRasterImageBytesWithLimit,
  safeRasterImageMime,
} from "./raster-image-security.ts";
import { storeOgJpeg } from "./registry.ts";

const OG_W = 1200;
const OG_H = 630;
const JPEG_QUALITY = 85;
const MAX_BANNER_BYTES = 3_000_000;

async function readOgBackfillBanner(
  upstream: Response,
  declaredMime: string | null,
): Promise<Uint8Array | null> {
  const contentType = safeRasterImageMime(declaredMime) ??
    safeRasterImageMime(upstream.headers.get("content-type"));
  if (!contentType) {
    await upstream.body?.cancel().catch(() => {});
    return null;
  }
  const bytes = await readRasterImageBytesWithLimit(
    upstream,
    MAX_BANNER_BYTES,
  );
  return bytes && matchesRasterImageSignature(bytes, contentType)
    ? bytes
    : null;
}

export async function readOgBackfillBannerForTest(
  upstream: Response,
  declaredMime: string | null,
): Promise<Uint8Array | null> {
  return await readOgBackfillBanner(upstream, declaredMime);
}

export interface OgJpegBackfillResult {
  processed: number;
  skipped: number;
  errors: string[];
}

export async function backfillOgJpegs(
  limit = 200,
): Promise<OgJpegBackfillResult> {
  const rows = await withDb((c) =>
    c.execute({
      sql: `
        SELECT did, pds_url, banner_cid, banner_mime
        FROM profile
        WHERE banner_cid IS NOT NULL AND og_jpeg IS NULL
        LIMIT ?
      `,
      args: [Math.max(1, Math.min(500, limit))],
    })
  );

  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (
    const row of rows.rows as unknown as Array<{
      did: string;
      pds_url: string;
      banner_cid: string;
      banner_mime: string | null;
    }>
  ) {
    try {
      const upstream = await fetchBlobPublic(
        row.pds_url,
        row.did,
        row.banner_cid,
      );
      if (!upstream.ok) {
        skipped++;
        errors.push(`${row.did}: upstream ${upstream.status}`);
        continue;
      }
      const buf = await readOgBackfillBanner(upstream, row.banner_mime);
      if (!buf) {
        skipped++;
        errors.push(`${row.did}: invalid or oversized banner image`);
        continue;
      }
      const jpeg = await coverJpeg(buf, OG_W, OG_H, JPEG_QUALITY);
      await storeOgJpeg(row.did, jpeg);
      processed++;
    } catch (err) {
      skipped++;
      errors.push(`${row.did}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { processed, skipped, errors };
}
