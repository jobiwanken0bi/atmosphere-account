import {
  findExistingAtstoreListingForProfile,
  getAtstoreMigrationReadiness,
  indexAtstoreListingMigrationRecord,
  publishAtstoreListingMigration,
} from "../lib/atstore-migration.ts";
import { getAppListingByIdentifier } from "../lib/app-directory.ts";
import { withDb } from "../lib/db.ts";
import { getValidSession } from "../lib/oauth.ts";
import { getProfileRecord } from "../lib/pds.ts";
import { getProfileByDid, type ProfileRow } from "../lib/registry.ts";

type Status =
  | "ready"
  | "migrated"
  | "already_indexed"
  | "indexed_existing_remote"
  | "skipped";

interface ReportRow {
  handle: string;
  did: string;
  status: Status;
  reason?: string;
  uri?: string;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Deno.args.find((item) => item.startsWith(prefix))?.slice(
    prefix.length,
  );
}

function hasFlag(name: string): boolean {
  return Deno.args.includes(`--${name}`);
}

async function listAppProfiles(): Promise<ProfileRow[]> {
  const rows = await withDb(async (c) =>
    (await c.execute(`
      SELECT
        slug,
        name,
        COALESCE(legacy_profile_did, profile_did, product_did) AS did
      FROM app_listing
      WHERE deleted_at IS NULL
        AND atstore_listing_uri IS NULL
        AND canonical_source = 'atmosphere_profile'
      ORDER BY updated_at DESC
    `)).rows
  );
  const out: ProfileRow[] = [];
  for (const row of rows) {
    const did = (row as Record<string, unknown>).did;
    if (typeof did !== "string" || !did) continue;
    const profile = await getProfileByDid(did, { includeTakenDown: true })
      .catch(() => null);
    if (!profile) {
      const slug = String((row as Record<string, unknown>).slug ?? did);
      console.warn(
        `[migrate-atstore] skipping ${slug}: matching Atmosphere profile was not found`,
      );
      continue;
    }
    if (!profile.categories.includes("app")) {
      console.warn(
        `[migrate-atstore] skipping @${profile.handle}: profile is no longer an app`,
      );
      continue;
    }
    const currentListing = await getAppListingByIdentifier(did).catch(() =>
      null
    );
    if (currentListing?.atstoreListingUri) {
      continue;
    }
    out.push(profile);
  }
  return out;
}

async function migrateProfile(
  profile: ProfileRow,
  write: boolean,
): Promise<ReportRow> {
  const listing = await getAppListingByIdentifier(profile.handle).catch(() =>
    null
  );
  if (listing?.atstoreListingUri) {
    return {
      handle: profile.handle,
      did: profile.did,
      status: "already_indexed",
      uri: listing.atstoreListingUri,
    };
  }

  const session = await getValidSession(profile.did, { quiet: true });
  if (!session) {
    return skipped(profile, "no valid OAuth session for this app account");
  }

  const existingRemote = await findExistingAtstoreListingForProfile(
    profile.did,
    session.pdsUrl,
  ).catch(() => null);
  if (existingRemote) {
    if (!write) {
      return {
        handle: profile.handle,
        did: profile.did,
        status: "ready",
        reason: "existing ATStore record can be indexed",
        uri: existingRemote.uri,
      };
    }
    const indexed = await indexAtstoreListingMigrationRecord(
      existingRemote,
      profile.did,
    );
    if (!indexed) {
      return skipped(profile, "existing ATStore record could not be parsed");
    }
    return {
      handle: profile.handle,
      did: profile.did,
      status: "indexed_existing_remote",
      uri: indexed.uri,
    };
  }

  const sourceRecord = await getProfileRecord(profile.did, session.pdsUrl)
    .catch(() => null);
  const readiness = getAtstoreMigrationReadiness(profile, sourceRecord);
  if (!readiness.ok || !sourceRecord) {
    return skipped(profile, readiness.issues.join("; ") || "not ready");
  }

  if (!write) {
    return {
      handle: profile.handle,
      did: profile.did,
      status: "ready",
      reason: "would publish ATStore listing",
    };
  }

  const result = await publishAtstoreListingMigration({
    did: profile.did,
    pdsUrl: session.pdsUrl,
    profile,
    sourceRecord,
  });
  return {
    handle: profile.handle,
    did: profile.did,
    status: "migrated",
    uri: result.uri,
  };
}

function skipped(profile: ProfileRow, reason: string): ReportRow {
  return {
    handle: profile.handle,
    did: profile.did,
    status: "skipped",
    reason,
  };
}

function printReport(rows: ReportRow[], write: boolean): void {
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `[migrate-atstore] ${write ? "write" : "dry-run"} complete: ${
      JSON.stringify(counts)
    }`,
  );
  for (const row of rows) {
    const suffix = row.uri
      ? ` ${row.uri}`
      : row.reason
      ? ` (${row.reason})`
      : "";
    console.log(`${row.status.padEnd(23)} @${row.handle}${suffix}`);
  }
}

async function main() {
  const write = hasFlag("write");
  const handleFilter = arg("handle")?.toLowerCase();
  const didFilter = arg("did");
  const limit = Number(arg("limit") ?? "0") || Infinity;
  const profiles = (await listAppProfiles())
    .filter((profile) => !handleFilter || profile.handle === handleFilter)
    .filter((profile) => !didFilter || profile.did === didFilter)
    .slice(0, limit);

  if (profiles.length === 0) {
    console.log("[migrate-atstore] no matching Atmosphere app profiles");
    return;
  }

  const rows: ReportRow[] = [];
  for (const profile of profiles) {
    try {
      rows.push(await migrateProfile(profile, write));
    } catch (err) {
      rows.push(skipped(
        profile,
        err instanceof Error ? err.message : String(err),
      ));
    }
  }
  printReport(rows, write);
  if (!write) {
    console.log("[migrate-atstore] pass --write to publish/index records");
  }
}

if (import.meta.main) await main();
