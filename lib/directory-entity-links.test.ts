import {
  appIdentityDids,
  claimedDirectoryLinkHasCurrentHostAuthority,
  currentDirectoryOwnerApproval,
  directoryEntityStatusForApprovals,
  establishDirectoryEntityLinkFromIntentWithClient,
  isDirectoryEntityRelationship,
  userControlsAppListing,
} from "./directory-entity-links.ts";
import type { BoundAppHostLinkIntent } from "./app-host-link-intent.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const app = {
  productDid: "did:plc:product",
  profileDid: "did:plc:profile",
  legacyProfileDid: "did:plc:profile",
};

function boundIntent(
  overrides: Partial<BoundAppHostLinkIntent> = {},
): BoundAppHostLinkIntent {
  return {
    kind: "bound",
    host: "pds.example",
    appListingId: "app-123",
    relationship: "same_operator",
    appOwnerDid: "did:plc:app-owner",
    jti: "J".repeat(32),
    issuedAt: 1_800_000_000_000,
    expiresAt: 1_800_003_600_000,
    ...overrides,
  };
}

Deno.test("app identity ownership accepts every current listing DID", () => {
  assertEquals(appIdentityDids(app), [
    "did:plc:product",
    "did:plc:profile",
  ]);
  assertEquals(userControlsAppListing(app, "did:plc:product"), true);
  assertEquals(userControlsAppListing(app, "did:plc:profile"), true);
  assertEquals(userControlsAppListing(app, "did:plc:other"), false);
});

Deno.test("cross-DID relationships require both owner approvals", () => {
  assertEquals(
    directoryEntityStatusForApprovals("same_product", 1, null),
    "pending",
  );
  assertEquals(
    directoryEntityStatusForApprovals("same_operator", null, 2),
    "pending",
  );
  assertEquals(
    directoryEntityStatusForApprovals("same_operator", 1, 2),
    "verified",
  );
});

Deno.test("host-only override needs the host owner but not an app approval", () => {
  assertEquals(
    directoryEntityStatusForApprovals("host_only", null, null),
    "pending",
  );
  assertEquals(
    directoryEntityStatusForApprovals("host_only", 1, null),
    "verified",
  );
});

Deno.test("owner changes invalidate the previous account's approval", () => {
  assertEquals(
    currentDirectoryOwnerApproval(123, "did:plc:old", ["did:plc:new"]),
    null,
  );
  assertEquals(
    currentDirectoryOwnerApproval(123, "did:plc:current", [
      "did:plc:current",
    ]),
    123,
  );
});

Deno.test("only supported directory relationships are accepted", () => {
  assertEquals(isDirectoryEntityRelationship("same_product"), true);
  assertEquals(isDirectoryEntityRelationship("same_operator"), true);
  assertEquals(isDirectoryEntityRelationship("host_only"), true);
  assertEquals(isDirectoryEntityRelationship("same_owner"), false);
});

Deno.test("claimed public links fail closed when seeded host authority is stale or poisoned", () => {
  assertEquals(
    claimedDirectoryLinkHasCurrentHostAuthority(
      "did:plc:pinned",
      "did:plc:pinned",
      null,
    ),
    false,
  );
  assertEquals(
    claimedDirectoryLinkHasCurrentHostAuthority(
      "did:plc:poisoned",
      "did:plc:poisoned",
      "did:plc:pinned",
    ),
    false,
  );
  assertEquals(
    claimedDirectoryLinkHasCurrentHostAuthority(
      "did:plc:pinned",
      "did:plc:pinned",
      "did:plc:pinned",
    ),
    true,
  );
});

Deno.test("signed app-host completion revalidates both owners and writes both approvals", async () => {
  let linkReads = 0;
  let insertedArgs: unknown[] = [];
  let consumedArgs: unknown[] = [];
  const result = await establishDirectoryEntityLinkFromIntentWithClient(
    {
      execute(query) {
        const sql = typeof query === "string" ? query : query.sql;
        if (sql.includes("FROM app_listing")) {
          return Promise.resolve({
            rows: [{
              product_did: "did:plc:app-owner",
              profile_did: null,
              legacy_profile_did: null,
            }],
            rowsAffected: 1,
          });
        }
        if (sql.includes("FROM account_host_claim")) {
          return Promise.resolve({
            rows: [{ claimant_did: "did:plc:host-owner" }],
            rowsAffected: 1,
          });
        }
        if (sql.includes("SELECT * FROM directory_entity_link")) {
          linkReads++;
          return Promise.resolve({
            rows: linkReads === 1 ? [] : [{
              host: "pds.example",
              app_listing_id: "app-123",
              relationship: "same_operator",
              status: "verified",
              source: "claimed",
              host_owner_did: "did:plc:host-owner",
              app_owner_did: "did:plc:app-owner",
              host_approved_at: 1,
              app_approved_at: 1,
              created_at: 1,
              updated_at: 1,
            }],
            rowsAffected: linkReads === 1 ? 0 : 1,
          });
        }
        if (sql.includes("INSERT INTO directory_entity_link")) {
          insertedArgs = typeof query === "string" ? [] : query.args ?? [];
          return Promise.resolve({ rows: [], rowsAffected: 1 });
        }
        if (sql.includes("app_host_link_intent_consumption")) {
          consumedArgs = typeof query === "string" ? [] : query.args ?? [];
          return Promise.resolve({ rows: [], rowsAffected: 1 });
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
    {
      intent: boundIntent(),
      currentHostDid: "did:plc:host-owner",
      verifiedHostOwnerDid: "did:plc:host-owner",
      now: 1_800_000_100_000,
    },
  );
  assertEquals(result.ok, true);
  assertEquals(result.link?.status, "verified");
  assertEquals(insertedArgs.slice(0, 5), [
    "pds.example",
    "app-123",
    "same_operator",
    "did:plc:host-owner",
    "did:plc:app-owner",
  ]);
  assertEquals(typeof insertedArgs[5], "number");
  assertEquals(typeof insertedArgs[6], "number");
  assertEquals(consumedArgs, [
    "J".repeat(32),
    "pds.example",
    "app-123",
    "did:plc:app-owner",
    1_800_003_600_000,
    1_800_000_100_000,
  ]);
});

Deno.test("signed app-host completion rejects stale app ownership before writing", async () => {
  let statements = 0;
  const result = await establishDirectoryEntityLinkFromIntentWithClient(
    {
      execute() {
        statements++;
        return Promise.resolve({
          rows: [{
            product_did: "did:plc:new-owner",
            profile_did: null,
            legacy_profile_did: null,
          }],
          rowsAffected: 1,
        });
      },
    },
    {
      intent: boundIntent({
        relationship: "same_product",
        appOwnerDid: "did:plc:old-owner",
      }),
      currentHostDid: "did:plc:host-owner",
      verifiedHostOwnerDid: "did:plc:host-owner",
      now: 1_800_000_100_000,
    },
  );
  assertEquals(result.ok, false);
  assertEquals(statements, 1);
  assertEquals(
    result.error,
    "The app owner changed after this host connection was approved.",
  );
});

Deno.test("signed app-host completion rejects a stale or poisoned host claim before writing", async () => {
  let statements = 0;
  let writes = 0;
  const result = await establishDirectoryEntityLinkFromIntentWithClient(
    {
      execute(query) {
        statements++;
        const sql = typeof query === "string" ? query : query.sql;
        if (sql.includes("FROM app_listing")) {
          return Promise.resolve({
            rows: [{
              product_did: "did:plc:app-owner",
              profile_did: null,
              legacy_profile_did: null,
            }],
            rowsAffected: 1,
          });
        }
        if (sql.includes("FROM account_host_claim")) {
          return Promise.resolve({
            rows: [{ claimant_did: "did:plc:poisoned" }],
            rowsAffected: 1,
          });
        }
        if (sql.includes("INSERT INTO directory_entity_link")) writes++;
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
    {
      intent: boundIntent({
        host: "seeded.example",
        relationship: "same_product",
      }),
      currentHostDid: "did:plc:pinned",
      verifiedHostOwnerDid: "did:plc:pinned",
      now: 1_800_000_100_000,
    },
  );
  assertEquals(result.ok, false);
  assertEquals(statements, 2);
  assertEquals(writes, 0);
  assertEquals(
    result.error,
    "This account does not control the claimed host.",
  );
});

Deno.test("signed app-host completion consumes each bound jti exactly once before linking", async () => {
  let writes = 0;
  const result = await establishDirectoryEntityLinkFromIntentWithClient(
    {
      execute(query) {
        const sql = typeof query === "string" ? query : query.sql;
        if (sql.includes("FROM app_listing")) {
          return Promise.resolve({
            rows: [{
              product_did: "did:plc:app-owner",
              profile_did: null,
              legacy_profile_did: null,
            }],
            rowsAffected: 1,
          });
        }
        if (sql.includes("FROM account_host_claim")) {
          return Promise.resolve({
            rows: [{ claimant_did: "did:plc:host-owner" }],
            rowsAffected: 1,
          });
        }
        if (sql.includes("SELECT * FROM directory_entity_link")) {
          return Promise.resolve({ rows: [], rowsAffected: 0 });
        }
        if (sql.includes("app_host_link_intent_consumption")) {
          return Promise.resolve({ rows: [], rowsAffected: 0 });
        }
        if (sql.includes("INSERT INTO directory_entity_link")) writes++;
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
    {
      intent: boundIntent(),
      currentHostDid: "did:plc:host-owner",
      verifiedHostOwnerDid: "did:plc:host-owner",
      now: 1_800_000_100_000,
    },
  );
  assertEquals(result.ok, false);
  assertEquals(writes, 0);
  assertEquals(
    result.error,
    "This app-to-host setup link has already been used. Start the connection again from app hosting.",
  );
});

Deno.test("an exact retry of an atomically completed app-host intent is idempotent", async () => {
  let linkReads = 0;
  const result = await establishDirectoryEntityLinkFromIntentWithClient(
    {
      execute(query) {
        const sql = typeof query === "string" ? query : query.sql;
        if (sql.includes("FROM app_listing")) {
          return Promise.resolve({
            rows: [{
              product_did: "did:plc:app-owner",
              profile_did: null,
              legacy_profile_did: null,
            }],
            rowsAffected: 1,
          });
        }
        if (sql.includes("FROM account_host_claim")) {
          return Promise.resolve({
            rows: [{ claimant_did: "did:plc:host-owner" }],
            rowsAffected: 1,
          });
        }
        if (sql.includes("SELECT * FROM directory_entity_link")) {
          linkReads++;
          return Promise.resolve({
            rows: [{
              host: "pds.example",
              app_listing_id: "app-123",
              relationship: "same_operator",
              status: "verified",
              source: "claimed",
              host_owner_did: "did:plc:host-owner",
              app_owner_did: "did:plc:app-owner",
              host_approved_at: 1,
              app_approved_at: 1,
              created_at: 1,
              updated_at: 1,
            }],
            rowsAffected: 1,
          });
        }
        if (sql.includes("INSERT INTO app_host_link_intent_consumption")) {
          return Promise.resolve({ rows: [], rowsAffected: 0 });
        }
        if (sql.includes("FROM app_host_link_intent_consumption")) {
          return Promise.resolve({
            rows: [{
              host: "pds.example",
              app_listing_id: "app-123",
              app_owner_did: "did:plc:app-owner",
              expires_at: 1_800_003_600_000,
            }],
            rowsAffected: 0,
          });
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
    {
      intent: boundIntent(),
      currentHostDid: "did:plc:host-owner",
      verifiedHostOwnerDid: "did:plc:host-owner",
      now: 1_800_000_100_000,
    },
  );
  assertEquals(result.ok, true);
  assertEquals(result.link?.status, "verified");
  assertEquals(linkReads, 1);
});

Deno.test("signed app-host completion rechecks expiry before consuming the jti", async () => {
  let consumptionWrites = 0;
  const result = await establishDirectoryEntityLinkFromIntentWithClient(
    {
      execute(query) {
        const sql = typeof query === "string" ? query : query.sql;
        if (sql.includes("FROM app_listing")) {
          return Promise.resolve({
            rows: [{
              product_did: "did:plc:app-owner",
              profile_did: null,
              legacy_profile_did: null,
            }],
            rowsAffected: 1,
          });
        }
        if (sql.includes("FROM account_host_claim")) {
          return Promise.resolve({
            rows: [{ claimant_did: "did:plc:host-owner" }],
            rowsAffected: 1,
          });
        }
        if (sql.includes("SELECT * FROM directory_entity_link")) {
          return Promise.resolve({ rows: [], rowsAffected: 0 });
        }
        if (sql.includes("app_host_link_intent_consumption")) {
          consumptionWrites++;
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
    {
      intent: boundIntent({ expiresAt: 1_800_000_100_000 }),
      currentHostDid: "did:plc:host-owner",
      verifiedHostOwnerDid: "did:plc:host-owner",
      now: 1_800_000_100_000,
    },
  );
  assertEquals(result.ok, false);
  assertEquals(consumptionWrites, 0);
  assertEquals(result.error, "This app-to-host setup link has expired.");
});
