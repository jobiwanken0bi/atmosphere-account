import { type DbClient, withDb } from "./db.ts";
import { isAtprotoTid } from "./tid.ts";

export const APP_PROFILE_CONFLICT_CODE = "app_profile_already_exists";
export const APP_PROFILE_CONFLICT_DETAIL =
  "This account already has an app profile. Manage that profile, or switch to the account for the other app.";
export const APP_PROFILE_REGISTRATION_IN_PROGRESS_CODE =
  "app_profile_registration_in_progress";
export const APP_PROFILE_REGISTRATION_IN_PROGRESS_DETAIL =
  "This account has a recent unfinished app registration. Return to the earlier tab or try again later.";
export const APP_PROFILE_TARGET_LEASE_MS = 60 * 60 * 1000;

export interface AppProfileTargetReservation {
  rkey: string;
  created: boolean;
}

/**
 * Atomically choose the sole ATStore app-listing record key for a DID.
 *
 * The unique DID row closes the race where two browser tabs both observe an
 * empty repository and submit different client-stable TIDs. A failed PDS
 * write intentionally keeps the reservation: the browser retries the same
 * TID, while an implicit retry reuses the stored TID returned here.
 */
export async function reserveAppProfileTarget(
  did: string,
  candidateRkey: string,
): Promise<AppProfileTargetReservation> {
  return await withDb((db) =>
    reserveAppProfileTargetWithClient(db, did, candidateRkey)
  );
}

export async function reserveAppProfileTargetWithClient(
  db: DbClient,
  did: string,
  candidateRkey: string,
  now = Date.now(),
): Promise<AppProfileTargetReservation> {
  const normalizedDid = did.trim();
  const normalizedRkey = candidateRkey.trim();
  if (!normalizedDid.startsWith("did:")) {
    throw new Error("invalid app profile DID");
  }
  if (!isAtprotoTid(normalizedRkey)) {
    throw new Error("invalid app profile record key");
  }

  const inserted = await db.execute({
    sql: `
      INSERT INTO app_profile_target(did, rkey, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(did) DO NOTHING
    `,
    args: [normalizedDid, normalizedRkey, now, now],
  });
  const selected = await db.execute({
    sql: `SELECT rkey FROM app_profile_target WHERE did = ? LIMIT 1`,
    args: [normalizedDid],
  });
  const reserved = selected.rows[0]?.rkey;
  if (typeof reserved !== "string" || !isAtprotoTid(reserved)) {
    throw new Error("app profile target reservation failed");
  }
  if (reserved === normalizedRkey && Number(inserted.rowsAffected ?? 0) !== 1) {
    await db.execute({
      sql: `
        UPDATE app_profile_target
        SET updated_at = ?
        WHERE did = ? AND rkey = ?
      `,
      args: [now, normalizedDid, normalizedRkey],
    });
  }
  return {
    rkey: reserved,
    created: Number(inserted.rowsAffected ?? 0) === 1,
  };
}

/**
 * Recover an abandoned, unpublished explicit-create intent after its lease.
 * Callers must first verify that neither the local directory nor the PDS has
 * an app for this DID. The compare-and-swap keeps competing recovery attempts
 * from selecting two new keys.
 */
export async function rotateStaleAppProfileTarget(
  did: string,
  previousRkey: string,
  candidateRkey: string,
  now = Date.now(),
): Promise<AppProfileTargetReservation> {
  return await withDb((db) =>
    rotateStaleAppProfileTargetWithClient(
      db,
      did,
      previousRkey,
      candidateRkey,
      now,
    )
  );
}

export async function rotateStaleAppProfileTargetWithClient(
  db: DbClient,
  did: string,
  previousRkey: string,
  candidateRkey: string,
  now = Date.now(),
): Promise<AppProfileTargetReservation> {
  const normalizedDid = did.trim();
  const normalizedPrevious = previousRkey.trim();
  const normalizedCandidate = candidateRkey.trim();
  if (
    !normalizedDid.startsWith("did:") ||
    !isAtprotoTid(normalizedPrevious) ||
    !isAtprotoTid(normalizedCandidate)
  ) {
    throw new Error("invalid app profile target recovery");
  }
  const staleBefore = now - APP_PROFILE_TARGET_LEASE_MS;
  const changed = await db.execute({
    sql: `
      UPDATE app_profile_target
      SET rkey = ?, updated_at = ?
      WHERE did = ? AND rkey = ? AND updated_at <= ?
    `,
    args: [
      normalizedCandidate,
      now,
      normalizedDid,
      normalizedPrevious,
      staleBefore,
    ],
  });
  const selected = await db.execute({
    sql: `SELECT rkey FROM app_profile_target WHERE did = ? LIMIT 1`,
    args: [normalizedDid],
  });
  const reserved = selected.rows[0]?.rkey;
  if (typeof reserved !== "string" || !isAtprotoTid(reserved)) {
    throw new Error("app profile target recovery failed");
  }
  return {
    rkey: reserved,
    created: Number(changed.rowsAffected ?? 0) === 1 &&
      reserved === normalizedCandidate,
  };
}

/**
 * Release only the exact deleted app target. The rkey comparison is critical:
 * a delayed delete/indexer retry for an old app must not clear a newer app's
 * reservation after the DID has legitimately registered again.
 */
export async function releaseAppProfileTarget(
  did: string,
  deletedRkey: string,
): Promise<boolean> {
  return await withDb((db) =>
    releaseAppProfileTargetWithClient(db, did, deletedRkey)
  );
}

export async function releaseAppProfileTargetWithClient(
  db: DbClient,
  did: string,
  deletedRkey: string,
): Promise<boolean> {
  const result = await db.execute({
    sql: `DELETE FROM app_profile_target WHERE did = ? AND rkey = ?`,
    args: [did.trim(), deletedRkey.trim()],
  });
  return Number(result.rowsAffected ?? 0) === 1;
}

/**
 * A createNew request is an idempotent update only when its client-stable TID
 * already names one of this DID's app records. Any other controlled app makes
 * the request a forbidden second-app creation.
 */
export function distinctAppCreationConflicts(input: {
  createNewListing: boolean;
  requestedUri: string | null;
  existingUris: readonly string[];
}): boolean {
  if (!input.createNewListing) return false;
  const requested = input.requestedUri?.trim() ?? "";
  const existing = input.existingUris
    .map((uri) => uri.trim())
    .filter(Boolean);
  if (existing.length === 0) return false;
  return !requested || !existing.includes(requested);
}

/** Detect an attempted second create that simply omits createNewListing. */
export function implicitAppCreationConflicts(input: {
  targetedExistingRecord: boolean;
  hasLegacyProfile: boolean;
  hasAtstoreListing: boolean;
  managedAppCount: number;
}): boolean {
  return !input.targetedExistingRecord &&
    !input.hasLegacyProfile &&
    !input.hasAtstoreListing &&
    input.managedAppCount > 0;
}

export function appProfileLookupFailureBlocksWrite(
  targetedExistingRecord: boolean,
): boolean {
  return !targetedExistingRecord;
}

export function appProfileConflictBody(existing?: {
  id?: string | null;
  slug?: string | null;
}): {
  error: typeof APP_PROFILE_CONFLICT_CODE;
  detail: string;
  existingApp?: { id?: string; publicPath?: string };
} {
  const id = existing?.id?.trim();
  const slug = existing?.slug?.trim();
  return {
    error: APP_PROFILE_CONFLICT_CODE,
    detail: APP_PROFILE_CONFLICT_DETAIL,
    ...(id || slug
      ? {
        existingApp: {
          ...(id ? { id } : {}),
          ...(slug ? { publicPath: `/apps/${encodeURIComponent(slug)}` } : {}),
        },
      }
      : {}),
  };
}

export function appProfileRegistrationInProgressBody(): {
  error: typeof APP_PROFILE_REGISTRATION_IN_PROGRESS_CODE;
  detail: typeof APP_PROFILE_REGISTRATION_IN_PROGRESS_DETAIL;
} {
  return {
    error: APP_PROFILE_REGISTRATION_IN_PROGRESS_CODE,
    detail: APP_PROFILE_REGISTRATION_IN_PROGRESS_DETAIL,
  };
}
