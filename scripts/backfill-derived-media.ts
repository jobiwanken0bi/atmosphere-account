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
const USAGE =
  "Usage: deno task backfill:derived-media [--limit=N | --limit N] [--purge-source]";

export interface BackfillDerivedMediaArgs {
  limit: number;
  purgeSource: boolean;
}

export function parseBackfillDerivedMediaArgs(
  args: readonly string[],
): BackfillDerivedMediaArgs {
  let limit = Number.POSITIVE_INFINITY;
  let limitSeen = false;
  let purgeSource = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--purge-source") {
      if (purgeSource) {
        throw new Error(`--purge-source may only be provided once. ${USAGE}`);
      }
      purgeSource = true;
      continue;
    }

    if (arg === "--limit") {
      if (limitSeen) {
        throw new Error(`--limit may only be provided once. ${USAGE}`);
      }
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`--limit requires a value. ${USAGE}`);
      }
      limit = parseLimit(value);
      limitSeen = true;
      index++;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      if (limitSeen) {
        throw new Error(`--limit may only be provided once. ${USAGE}`);
      }
      limit = parseLimit(arg.slice("--limit=".length));
      limitSeen = true;
      continue;
    }

    throw new Error(`Unknown argument ${JSON.stringify(arg)}. ${USAGE}`);
  }

  return { limit, purgeSource };
}

function parseLimit(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(
      `--limit must be a positive safe integer; received ${
        JSON.stringify(value)
      }. ${USAGE}`,
    );
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit)) {
    throw new Error(
      `--limit must be a positive safe integer; received ${
        JSON.stringify(value)
      }. ${USAGE}`,
    );
  }
  return limit;
}

async function main(args: readonly string[]): Promise<void> {
  const { limit, purgeSource } = parseBackfillDerivedMediaArgs(args);

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
}

if (import.meta.main) await main(Deno.args);
