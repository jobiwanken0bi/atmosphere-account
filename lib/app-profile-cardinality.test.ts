import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { listManagedAppListingsByAccountDidWithClient } from "./app-directory.ts";
import type { DbClient } from "./db.ts";
import {
  APP_PROFILE_TARGET_LEASE_MS,
  appCreationConflicts,
  appOwnershipUnavailableResponse,
  appProfileConflictBody,
  appProfileConflictResponse,
  appProfileCreateListingKeyError,
  appProfileRegistrationInProgressBody,
  existingAppRegistrationRedirect,
  releaseAppProfileTargetWithClient,
  reserveAppProfileTargetWithClient,
  rotateStaleAppProfileTargetWithClient,
} from "./app-profile-cardinality.ts";

const APP = {
  id: "app-one",
  slug: "one.example",
  atstoreListingUri: "at://did:plc:owner/fyi.atstore.listing.detail/3mexample",
};

Deno.test("existing app owners cannot enter another-app registration", () => {
  assertEquals(
    existingAppRegistrationRedirect({
      creatingNew: true,
      existingApp: APP,
      ownerDid: "did:plc:owner",
    }),
    "/apps/manage?app=app-one",
  );
  assertEquals(
    existingAppRegistrationRedirect({
      creatingNew: false,
      existingApp: APP,
      ownerDid: "did:plc:owner",
    }),
    null,
  );
});

Deno.test("local or remote app discovery blocks a second create", () => {
  assertEquals(
    appCreationConflicts({
      createNewListing: true,
      hasManagedApp: true,
      hasRemoteAtstoreApp: false,
    }),
    true,
  );
  assertEquals(
    appCreationConflicts({
      createNewListing: true,
      hasManagedApp: false,
      hasRemoteAtstoreApp: true,
    }),
    true,
  );
  assertEquals(
    appCreationConflicts({
      createNewListing: true,
      hasManagedApp: false,
      hasRemoteAtstoreApp: false,
    }),
    false,
  );
  assertEquals(
    appCreationConflicts({
      createNewListing: false,
      hasManagedApp: true,
      hasRemoteAtstoreApp: true,
    }),
    false,
  );
});

Deno.test("first app creation requires a client-stable AT Protocol TID", () => {
  assertEquals(
    appProfileCreateListingKeyError(true, null),
    "invalid app listing creation key",
  );
  assertEquals(
    appProfileCreateListingKeyError(true, "not-a-tid"),
    "invalid app listing creation key",
  );
  assertEquals(appProfileCreateListingKeyError(true, "3mzzzzzzzzzza"), null);
  assertEquals(appProfileCreateListingKeyError(false, undefined), null);
});

Deno.test("cardinality conflict response points back to the existing app", () => {
  assertEquals(appProfileConflictBody(APP), {
    error: "app_profile_already_exists",
    detail:
      "This account already has an app profile. Manage that profile, or switch to the account for the other app.",
    existingApp: { id: "app-one", publicPath: "/apps/one.example" },
  });
  const response = appProfileConflictResponse(APP);
  assertEquals(response.status, 409);
  assertEquals(response.headers.get("cache-control"), "no-store");
  const unavailable = appOwnershipUnavailableResponse();
  assertEquals(unavailable.status, 503);
  assertEquals(unavailable.headers.get("cache-control"), "no-store");
});

Deno.test("owner lookup includes hidden apps and every DID ownership field", async () => {
  let sql = "";
  let args: unknown[] = [];
  const db: DbClient = {
    execute(query) {
      sql = typeof query === "string" ? query : query.sql;
      args = typeof query === "string" ? [] : query.args ?? [];
      return Promise.resolve({ rows: [], rowsAffected: 0 });
    },
  };
  assertEquals(
    await listManagedAppListingsByAccountDidWithClient(
      db,
      "did:plc:owner",
    ),
    [],
  );
  assertEquals(/app_moderation/i.test(sql), false);
  assertEquals(/deleted_at IS NULL/i.test(sql), true);
  assertEquals(/product_did = \?/i.test(sql), true);
  assertEquals(/profile_did = \?/i.test(sql), true);
  assertEquals(/legacy_profile_did = \?/i.test(sql), true);
  assertEquals(args, ["did:plc:owner", "did:plc:owner", "did:plc:owner"]);
});

Deno.test("DID reservation converges retries, concurrent keys, stale recovery, and exact delete", async () => {
  const did = "did:plc:owner";
  const firstRkey = "3mzzzzzzzzzza";
  const secondRkey = "3mzzzzzzzzzzb";
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
    await reserveAppProfileTargetWithClient(db, did, firstRkey, 1),
    { rkey: firstRkey, created: true },
  );
  assertEquals(
    await reserveAppProfileTargetWithClient(db, did, firstRkey, 2),
    { rkey: firstRkey, created: false },
  );
  assertEquals(
    await reserveAppProfileTargetWithClient(db, did, secondRkey, 3),
    { rkey: firstRkey, created: false },
  );
  assertEquals(
    appProfileRegistrationInProgressBody().error,
    "app_profile_registration_in_progress",
  );

  assertEquals(
    await rotateStaleAppProfileTargetWithClient(
      db,
      did,
      firstRkey,
      secondRkey,
      APP_PROFILE_TARGET_LEASE_MS,
    ),
    { rkey: firstRkey, created: false },
  );
  assertEquals(
    await rotateStaleAppProfileTargetWithClient(
      db,
      did,
      firstRkey,
      secondRkey,
      APP_PROFILE_TARGET_LEASE_MS + 3,
    ),
    { rkey: secondRkey, created: true },
  );
  assertEquals(
    await releaseAppProfileTargetWithClient(db, did, firstRkey),
    false,
  );
  assertEquals(
    await releaseAppProfileTargetWithClient(db, did, secondRkey),
    true,
  );
});
