import type { AppListing } from "./app-directory.ts";
import { appManagementHref } from "./app-management-navigation.ts";
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

export function appProfileCreateListingKeyError(
  createNewListing: unknown,
  createListingRkey: unknown,
): string | null {
  if (createNewListing != null && typeof createNewListing !== "boolean") {
    return "invalid app listing creation request";
  }
  if (createListingRkey != null && typeof createListingRkey !== "string") {
    return "invalid app listing creation key";
  }
  const rkey = typeof createListingRkey === "string"
    ? createListingRkey.trim()
    : "";
  if (rkey && !isAtprotoTid(rkey)) {
    return "invalid app listing creation key";
  }
  return createNewListing === true && !rkey
    ? "invalid app listing creation key"
    : null;
}

/** Atomically reserve this DID's sole ATStore app-listing record key. */
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
 * Compare-and-swap an abandoned unpublished target after its bounded lease.
 * Callers must first verify that the previous key is unpublished and that the
 * candidate is either unpublished or the sole app record already present.
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
      now - APP_PROFILE_TARGET_LEASE_MS,
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

/** Release only the exact record key that was actually deleted. */
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

type ManagedApp = Pick<AppListing, "id" | "slug" | "atstoreListingUri">;

export function existingAppRegistrationRedirect(input: {
  creatingNew: boolean;
  existingApp: ManagedApp | null;
  ownerDid: string;
}): string | null {
  return input.creatingNew && input.existingApp
    ? appManagementHref(input.existingApp, input.ownerDid)
    : null;
}

export function appCreationConflicts(input: {
  createNewListing: boolean;
  hasManagedApp: boolean;
  hasRemoteAtstoreApp: boolean;
}): boolean {
  return input.createNewListing &&
    (input.hasManagedApp || input.hasRemoteAtstoreApp);
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

export function appProfileConflictResponse(existing?: {
  id?: string | null;
  slug?: string | null;
}): Response {
  return new Response(JSON.stringify(appProfileConflictBody(existing)), {
    status: 409,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
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

export function appProfileRegistrationInProgressResponse(): Response {
  return new Response(JSON.stringify(appProfileRegistrationInProgressBody()), {
    status: 409,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function appOwnershipUnavailableResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "app_ownership_unavailable",
      detail: "App ownership could not be verified. Try again shortly.",
    }),
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}
