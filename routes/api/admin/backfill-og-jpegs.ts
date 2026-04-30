/**
 * Admin one-shot: generate and store og_jpeg for all profiles that have a
 * banner but no cached og_jpeg yet. Run once after deploying the og_jpeg
 * feature to warm the cache for existing profiles.
 *
 *   POST /api/admin/backfill-og-jpegs
 *
 * Returns a JSON summary: { processed, skipped, errors }.
 */
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { define } from "../../../utils.ts";
import { requireAdminApi } from "../../../lib/admin.ts";
import { withDb } from "../../../lib/db.ts";
import { fetchBlobPublic } from "../../../lib/pds.ts";
import { storeOgJpeg } from "../../../lib/registry.ts";

const OG_W = 1200;
const OG_H = 630;
const JPEG_QUALITY = 85;

export const handler = define.handlers({
  POST: async (ctx) => {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    const rows = await withDb((c) =>
      c.execute(
        `SELECT did, pds_url, banner_cid, banner_mime
         FROM profile
         WHERE banner_cid IS NOT NULL AND og_jpeg IS NULL
         LIMIT 200`,
      )
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
        const buf = new Uint8Array(await upstream.arrayBuffer());
        const img = await Image.decode(buf);
        const jpeg = new Uint8Array(
          await img.cover(OG_W, OG_H).encodeJPEG(JPEG_QUALITY),
        );
        await storeOgJpeg(row.did, jpeg);
        processed++;
      } catch (err) {
        skipped++;
        errors.push(`${row.did}: ${err instanceof Error ? err.message : err}`);
      }
    }

    return new Response(
      JSON.stringify({ processed, skipped, errors }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  },
});
