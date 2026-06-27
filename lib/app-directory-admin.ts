import type { InValue } from "@libsql/client";
import { ATSTORE_REPO_DID, ATSTORE_SOCIAL_REPO_DIDS } from "./env.ts";
import { withDb } from "./db.ts";
import { countFailures } from "./app-directory-failures.ts";
import {
  findExistingAtstoreListingForProfile,
  getAtstoreMigrationReadiness,
} from "./atstore-migration.ts";
import { getValidSession } from "./oauth.ts";
import { getProfileRecord } from "./pds.ts";
import { getProfileByDid, type ProfileRow } from "./registry.ts";

export interface AppDirectoryAdminStatus {
  listings: number;
  atstoreListings: number;
  atmosphereListings: number;
  sourceRecords: number;
  atstoreSourceRecords: number;
  reviews: number;
  favorites: number;
  latestRecordIndexedAt: number | null;
  latestReviewIndexedAt: number | null;
  latestFavoriteIndexedAt: number | null;
  jetstreamCursor: number | null;
  jetstreamCursorUpdatedAt: number | null;
  failedRecords: number;
  migrationCandidates: number;
  migrationBlocked: number;
  configuredListingRepo: string | null;
  configuredSocialRepos: string[];
  missingSocialRepoWarning: boolean;
}

export interface AppDirectoryMigrationCandidate {
  id: string;
  slug: string;
  name: string;
  primaryUrl: string | null;
  legacyProfileDid: string | null;
  iconUrl: string | null;
  issue: string | null;
}

export type AppDirectoryMigrationStatus =
  | "ready"
  | "needs_icon"
  | "needs_url"
  | "no_session"
  | "already_remote"
  | "blocked";

export interface AppDirectoryMigrationDryRun {
  status: AppDirectoryMigrationStatus;
  label: string;
  description: string;
  candidates: AppDirectoryMigrationCandidate[];
}

export async function getAppDirectoryAdminStatus(): Promise<
  AppDirectoryAdminStatus
> {
  return await withDb(async (c) => {
    const [
      listings,
      atstoreListings,
      atmosphereListings,
      sourceRecords,
      atstoreSourceRecords,
      reviews,
      favorites,
      latestRecord,
      latestReview,
      latestFavorite,
      cursor,
      failedRecords,
      migrationCandidates,
      migrationBlocked,
    ] = await Promise.all([
      count(c, "app_listing", "deleted_at IS NULL"),
      count(
        c,
        "app_listing",
        "deleted_at IS NULL AND atstore_listing_uri IS NOT NULL",
      ),
      count(
        c,
        "app_listing",
        "deleted_at IS NULL AND canonical_source = 'atmosphere_profile'",
      ),
      count(c, "app_record", "deleted_at IS NULL"),
      count(
        c,
        "app_record",
        "deleted_at IS NULL AND source_type = 'atstore_listing'",
      ),
      count(c, "app_review", "deleted_at IS NULL"),
      count(c, "app_favorite", "deleted_at IS NULL"),
      maxValue(c, "app_record", "indexed_at", "deleted_at IS NULL"),
      maxValue(c, "app_review", "indexed_at", "deleted_at IS NULL"),
      maxValue(c, "app_favorite", "indexed_at", "deleted_at IS NULL"),
      c.execute("SELECT cursor, updated_at FROM jetstream_cursor WHERE id = 1"),
      countFailures(c),
      count(
        c,
        "app_listing",
        "deleted_at IS NULL AND atstore_listing_uri IS NULL AND legacy_profile_did IS NOT NULL",
      ),
      count(
        c,
        "app_listing",
        "deleted_at IS NULL AND atstore_listing_uri IS NULL AND legacy_profile_did IS NULL",
      ),
    ]);
    const cursorRow = cursor.rows[0] as Record<string, unknown> | undefined;
    return {
      listings,
      atstoreListings,
      atmosphereListings,
      sourceRecords,
      atstoreSourceRecords,
      reviews,
      favorites,
      latestRecordIndexedAt: latestRecord,
      latestReviewIndexedAt: latestReview,
      latestFavoriteIndexedAt: latestFavorite,
      jetstreamCursor: numberOrNull(cursorRow?.cursor),
      jetstreamCursorUpdatedAt: numberOrNull(cursorRow?.updated_at),
      failedRecords,
      migrationCandidates,
      migrationBlocked,
      configuredListingRepo: ATSTORE_REPO_DID || null,
      configuredSocialRepos: ATSTORE_SOCIAL_REPO_DIDS,
      missingSocialRepoWarning: ATSTORE_SOCIAL_REPO_DIDS.length === 0,
    };
  });
}

export async function listAppDirectoryMigrationCandidates(
  limit = 24,
): Promise<AppDirectoryMigrationCandidate[]> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT id, slug, name, primary_url, legacy_profile_did, icon_url
        FROM app_listing
        WHERE deleted_at IS NULL
          AND atstore_listing_uri IS NULL
          AND canonical_source = 'atmosphere_profile'
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      args: [Math.max(1, Math.min(100, limit))],
    });
    return result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      const iconUrl = stringOrNull(r.icon_url);
      return {
        id: String(r.id),
        slug: String(r.slug),
        name: String(r.name),
        primaryUrl: stringOrNull(r.primary_url),
        legacyProfileDid: stringOrNull(r.legacy_profile_did),
        iconUrl,
        issue: iconUrl ? null : "Needs an icon before ATStore publishing",
      };
    });
  });
}

export async function listAppDirectoryMigrationDryRun(
  limit = 60,
): Promise<AppDirectoryMigrationDryRun[]> {
  const candidates = await listAppDirectoryMigrationCandidates(limit);
  const groups = new Map<
    AppDirectoryMigrationStatus,
    AppDirectoryMigrationCandidate[]
  >();
  for (const candidate of candidates) {
    const classified = await classifyMigrationCandidate(candidate);
    const bucket = groups.get(classified.status) ?? [];
    bucket.push({ ...candidate, issue: classified.issue });
    groups.set(classified.status, bucket);
  }
  return migrationStatusOrder.map((status) => ({
    status,
    label: migrationStatusCopy[status].label,
    description: migrationStatusCopy[status].description,
    candidates: groups.get(status) ?? [],
  }));
}

async function classifyMigrationCandidate(
  candidate: AppDirectoryMigrationCandidate,
): Promise<{
  status: AppDirectoryMigrationStatus;
  issue: string | null;
}> {
  const did = candidate.legacyProfileDid;
  if (!did) return { status: "blocked", issue: "Missing app account DID." };
  const profile = await getProfileByDid(did, { includeTakenDown: true }).catch(
    () => null,
  );
  if (!profile) {
    return { status: "blocked", issue: "Atmosphere profile was not found." };
  }
  if (!primaryUrl(profile)) {
    return {
      status: "needs_url",
      issue: "Add a website, iOS, or Android link.",
    };
  }
  if (!profile.avatarCid) {
    return { status: "needs_icon", issue: "Add an app icon/avatar." };
  }
  const session = await getValidSession(profile.did, { quiet: true }).catch(
    () => null,
  );
  if (!session) {
    return {
      status: "no_session",
      issue: "The app account needs to sign in again before publishing.",
    };
  }
  const existingRemote = await findExistingAtstoreListingForProfile(
    profile.did,
    session.pdsUrl,
  ).catch(() => null);
  if (existingRemote) {
    return {
      status: "already_remote",
      issue: "A remote ATStore record exists and can be indexed.",
    };
  }
  const sourceRecord = await getProfileRecord(profile.did, session.pdsUrl)
    .catch(() => null);
  const readiness = getAtstoreMigrationReadiness(profile, sourceRecord);
  if (readiness.ok && sourceRecord) {
    return {
      status: "ready",
      issue: "Ready to publish an ATStore listing.",
    };
  }
  const issue = readiness.issues[0] ?? "Not ready to migrate.";
  if (issue.toLowerCase().includes("icon")) {
    return { status: "needs_icon", issue };
  }
  if (issue.toLowerCase().includes("website")) {
    return { status: "needs_url", issue };
  }
  return { status: "blocked", issue };
}

const migrationStatusOrder: AppDirectoryMigrationStatus[] = [
  "ready",
  "already_remote",
  "needs_icon",
  "needs_url",
  "no_session",
  "blocked",
];

const migrationStatusCopy: Record<
  AppDirectoryMigrationStatus,
  { label: string; description: string }
> = {
  ready: {
    label: "Ready",
    description: "Can publish an ATStore listing when the owner chooses.",
  },
  already_remote: {
    label: "Remote record exists",
    description: "Can be indexed without publishing a duplicate.",
  },
  needs_icon: {
    label: "Needs icon",
    description: "ATStore publishing requires an app icon/avatar.",
  },
  needs_url: {
    label: "Needs URL",
    description: "ATStore publishing requires a primary app URL.",
  },
  no_session: {
    label: "Needs sign-in",
    description: "The app account must sign in again before publishing.",
  },
  blocked: {
    label: "Blocked",
    description: "Needs manual review before migration.",
  },
};

function primaryUrl(profile: ProfileRow): string | null {
  return profile.mainLink || profile.iosLink || profile.androidLink || null;
}

type DbLike = {
  execute: (
    args: { sql: string; args?: InValue[] } | string,
  ) => Promise<{ rows: unknown[] }>;
};

async function count(
  c: DbLike,
  table: string,
  where: string,
): Promise<number> {
  const result = await c.execute(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`,
  );
  return Number(
    (result.rows[0] as Record<string, unknown> | undefined)?.n ?? 0,
  );
}

async function maxValue(
  c: DbLike,
  table: string,
  column: string,
  where: string,
): Promise<number | null> {
  const result = await c.execute(
    `SELECT MAX(${column}) AS value FROM ${table} WHERE ${where}`,
  );
  return numberOrNull(
    (result.rows[0] as Record<string, unknown> | undefined)?.value,
  );
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
