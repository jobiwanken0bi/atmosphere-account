import { withDb } from "../lib/db.ts";
import {
  derivedMediaCacheConfig,
  profileDerivedMediaKey,
  storeDerivedMedia,
  verifyCachedDerivedMedia,
} from "../lib/derived-media-cache.ts";
import { closePostgresExecuteClient } from "../lib/postgres.ts";
import { getOgJpeg } from "../lib/registry.ts";

const PAGE_SIZE = 50;
const purgeSource = Deno.args.includes("--purge-source");
const limitArg = Deno.args.find((arg) => arg.startsWith("--limit="));
const parsedLimit = limitArg
  ? Number.parseInt(limitArg.slice("--limit=".length), 10)
  : Number.POSITIVE_INFINITY;
const limit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0
  ? parsedLimit
  : Number.POSITIVE_INFINITY;

if (!derivedMediaCacheConfig()) {
  throw new Error(
    "Derived-media S3 configuration is required before running this backfill.",
  );
}

let afterDid = "";
let processed = 0;
let copied = 0;
let alreadyStored = 0;
let purged = 0;
let failed = 0;

try {
  while (processed < limit) {
    const pageLimit = Math.min(PAGE_SIZE, limit - processed);
    const page = await withDb((client) =>
      client.execute({
        sql: `SELECT did, banner_cid
          FROM profile
          WHERE did > ? AND banner_cid IS NOT NULL AND og_jpeg IS NOT NULL
          ORDER BY did ASC
          LIMIT ?`,
        args: [afterDid, pageLimit],
      })
    );
    if (page.rows.length === 0) break;

    for (const row of page.rows as Array<Record<string, unknown>>) {
      const did = String(row.did);
      const bannerCid = String(row.banner_cid);
      afterDid = did;
      processed++;
      const key = profileDerivedMediaKey({
        kind: "og",
        did,
        cid: bannerCid,
      });
      const jpeg = await getOgJpeg(did).catch(() => null);
      if (!jpeg?.byteLength) {
        failed++;
        continue;
      }
      let stored = await verifyCachedDerivedMedia(key, jpeg);
      if (stored) {
        alreadyStored++;
      } else {
        const uploaded = await storeDerivedMedia({
          key,
          bytes: jpeg,
          contentType: "image/jpeg",
          filename: "atmosphere-og.jpg",
        });
        stored = uploaded && await verifyCachedDerivedMedia(key, jpeg);
        if (stored) copied++;
      }
      if (!stored) {
        failed++;
        continue;
      }
      if (purgeSource) {
        const result = await withDb((client) =>
          client.execute({
            sql:
              `UPDATE profile SET og_jpeg = NULL WHERE did = ? AND banner_cid = ? AND og_jpeg = ?`,
            args: [did, bannerCid, jpeg],
          })
        );
        purged += Number(result.rowsAffected ?? 0);
      }
    }
  }
} finally {
  await withDb(closePostgresExecuteClient).catch(() => {});
}

console.log(JSON.stringify({
  processed,
  copied,
  alreadyStored,
  purged,
  failed,
  purgeSource,
}));

if (failed > 0) Deno.exit(1);
