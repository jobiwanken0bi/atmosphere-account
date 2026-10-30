import { assertEquals } from "jsr:@std/assert@1";
import type { DbClient } from "./db.ts";
import {
  appProfileTargetFromUri,
  listManagedAppListingsByAccountDidWithClient,
} from "./app-directory.ts";
import { ATSTORE_LISTING_NSID } from "./app-lexicons.ts";
import {
  APP_PROFILE_CONFLICT_CODE,
  APP_PROFILE_CONFLICT_DETAIL,
  APP_PROFILE_TARGET_LEASE_MS,
  appProfileConflictBody,
  appProfileLookupFailureBlocksWrite,
  appProfileRegistrationInProgressBody,
  distinctAppCreationConflicts,
  implicitAppCreationConflicts,
  releaseAppProfileTargetWithClient,
  reserveAppProfileTargetWithClient,
  rotateStaleAppProfileTargetWithClient,
} from "./app-profile-cardinality.ts";

const DID = "did:plc:appowner";
const FIRST_RKEY = "3mzzzzzzzzzza";
const SECOND_RKEY = "3mzzzzzzzzzzb";
const firstUri = `at://${DID}/${ATSTORE_LISTING_NSID}/${FIRST_RKEY}`;

Deno.test("direct createNew API requests cannot add a distinct second app", () => {
  assertEquals(
    distinctAppCreationConflicts({
      createNewListing: true,
      requestedUri: `at://${DID}/${ATSTORE_LISTING_NSID}/${SECOND_RKEY}`,
      existingUris: [firstUri],
    }),
    true,
  );
});

Deno.test("a client-stable create TID may retry its existing app record", () => {
  assertEquals(
    distinctAppCreationConflicts({
      createNewListing: true,
      requestedUri: firstUri,
      existingUris: [firstUri],
    }),
    false,
  );
});

Deno.test("existing app updates are never treated as second-app creation", () => {
  assertEquals(
    distinctAppCreationConflicts({
      createNewListing: false,
      requestedUri: firstUri,
      existingUris: [
        firstUri,
        `at://${DID}/${ATSTORE_LISTING_NSID}/${SECOND_RKEY}`,
      ],
    }),
    false,
  );
});

Deno.test("direct API callers cannot bypass cardinality by omitting createNew", () => {
  assertEquals(
    implicitAppCreationConflicts({
      targetedExistingRecord: false,
      hasLegacyProfile: false,
      hasAtstoreListing: false,
      managedAppCount: 1,
    }),
    true,
  );
  assertEquals(
    implicitAppCreationConflicts({
      targetedExistingRecord: true,
      hasLegacyProfile: false,
      hasAtstoreListing: false,
      managedAppCount: 2,
    }),
    false,
  );
});

Deno.test("legacy profile lookup errors fail closed except for exact updates", () => {
  assertEquals(appProfileLookupFailureBlocksWrite(false), true);
  assertEquals(appProfileLookupFailureBlocksWrite(true), false);
});

Deno.test("app cardinality conflicts have a stable friendly API response", () => {
  assertEquals(appProfileConflictBody({ id: "app-1", slug: "reader.app" }), {
    error: APP_PROFILE_CONFLICT_CODE,
    detail: APP_PROFILE_CONFLICT_DETAIL,
    existingApp: {
      id: "app-1",
      publicPath: "/apps/reader.app",
    },
  });
});

Deno.test("an active unpublished reservation is not described as an existing app", () => {
  assertEquals(appProfileRegistrationInProgressBody(), {
    error: "app_profile_registration_in_progress",
    detail:
      "This account has a recent unfinished app registration. Return to the earlier tab or try again later.",
  });
});

Deno.test("the DID reservation converges concurrent or retried record keys", async () => {
  let reserved: { rkey: string; updatedAt: number } | null = null;
  const db: DbClient = {
    execute(query) {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : query.args ?? [];
      if (/INSERT INTO app_profile_target/i.test(sql)) {
        if (reserved) return Promise.resolve({ rows: [], rowsAffected: 0 });
        reserved = { rkey: String(args[1]), updatedAt: Number(args[3]) };
        return Promise.resolve({ rows: [], rowsAffected: 1 });
      }
      if (/SET updated_at = \?/i.test(sql) && !/SET rkey =/i.test(sql)) {
        if (reserved?.rkey !== String(args[2])) {
          return Promise.resolve({ rows: [], rowsAffected: 0 });
        }
        reserved.updatedAt = Number(args[0]);
        return Promise.resolve({ rows: [], rowsAffected: 1 });
      }
      if (/SET rkey = \?, updated_at = \?/i.test(sql)) {
        if (
          !reserved || reserved.rkey !== String(args[3]) ||
          reserved.updatedAt > Number(args[4])
        ) return Promise.resolve({ rows: [], rowsAffected: 0 });
        reserved = { rkey: String(args[0]), updatedAt: Number(args[1]) };
        return Promise.resolve({ rows: [], rowsAffected: 1 });
      }
      if (/DELETE FROM app_profile_target/i.test(sql)) {
        if (!reserved || reserved.rkey !== String(args[1])) {
          return Promise.resolve({ rows: [], rowsAffected: 0 });
        }
        reserved = null;
        return Promise.resolve({ rows: [], rowsAffected: 1 });
      }
      if (/SELECT rkey FROM app_profile_target/i.test(sql)) {
        return Promise.resolve({
          rows: reserved ? [{ rkey: reserved.rkey }] : [],
          rowsAffected: 0,
        });
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  assertEquals(
    await reserveAppProfileTargetWithClient(db, DID, FIRST_RKEY, 1),
    { rkey: FIRST_RKEY, created: true },
  );
  assertEquals(
    await reserveAppProfileTargetWithClient(db, DID, FIRST_RKEY, 2),
    { rkey: FIRST_RKEY, created: false },
  );
  assertEquals(
    await reserveAppProfileTargetWithClient(db, DID, SECOND_RKEY, 3),
    { rkey: FIRST_RKEY, created: false },
  );

  assertEquals(
    await rotateStaleAppProfileTargetWithClient(
      db,
      DID,
      FIRST_RKEY,
      SECOND_RKEY,
      APP_PROFILE_TARGET_LEASE_MS,
    ),
    { rkey: FIRST_RKEY, created: false },
  );
  assertEquals(
    await rotateStaleAppProfileTargetWithClient(
      db,
      DID,
      FIRST_RKEY,
      SECOND_RKEY,
      APP_PROFILE_TARGET_LEASE_MS + 3,
    ),
    { rkey: SECOND_RKEY, created: true },
  );

  // A delayed delete for the old record cannot clear the new app target.
  assertEquals(
    await releaseAppProfileTargetWithClient(db, DID, FIRST_RKEY),
    false,
  );
  assertEquals(
    await releaseAppProfileTargetWithClient(db, DID, SECOND_RKEY),
    true,
  );
  assertEquals(
    await reserveAppProfileTargetWithClient(db, DID, FIRST_RKEY, 9),
    { rkey: FIRST_RKEY, created: true },
  );
});

Deno.test("owner cardinality lookup includes hidden apps and every DID role", async () => {
  let capturedSql = "";
  let capturedArgs: unknown[] = [];
  const db: DbClient = {
    execute(query) {
      capturedSql = typeof query === "string" ? query : query.sql;
      capturedArgs = typeof query === "string" ? [] : query.args ?? [];
      return Promise.resolve({ rows: [], rowsAffected: 0 });
    },
  };
  assertEquals(
    await listManagedAppListingsByAccountDidWithClient(db, DID),
    [],
  );
  assertEquals(/app_moderation/i.test(capturedSql), false);
  assertEquals(/deleted_at IS NULL/i.test(capturedSql), true);
  assertEquals(/product_did = \?/i.test(capturedSql), true);
  assertEquals(/profile_did = \?/i.test(capturedSql), true);
  assertEquals(/legacy_profile_did = \?/i.test(capturedSql), true);
  assertEquals(capturedArgs, [DID, DID, DID]);
});

Deno.test("only an exact ATStore app deletion releases a DID target", () => {
  assertEquals(appProfileTargetFromUri(firstUri), {
    did: DID,
    rkey: FIRST_RKEY,
  });
  assertEquals(
    appProfileTargetFromUri(
      `at://${DID}/${ATSTORE_LISTING_NSID}/not-a-tid`,
    ),
    null,
  );
  assertEquals(
    appProfileTargetFromUri(
      `at://${DID}/com.atmosphereaccount.registry.profile/${FIRST_RKEY}`,
    ),
    null,
  );
});
