import {
  appIdentityDids,
  currentDirectoryOwnerApproval,
  directoryEntityStatusForApprovals,
  isDirectoryEntityRelationship,
  userControlsAppListing,
} from "./directory-entity-links.ts";

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
