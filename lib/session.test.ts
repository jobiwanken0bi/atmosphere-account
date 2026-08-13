import {
  databaseBoolean,
  SESSION_LOOKUP_SQL,
  sessionHostClaimCanSetMenuFlag,
  sessionManagedHostOwnershipSql,
  shouldBypassSessionForPublicMedia,
  shouldHydrateAccountDetails,
} from "./session.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("session details fully hydrate when no appview is configured", () => {
  assertEquals(shouldHydrateAccountDetails("/", false), true);
  assertEquals(shouldHydrateAccountDetails("/docs", false), true);
  assertEquals(shouldHydrateAccountDetails("/signin", false), true);
  assertEquals(shouldHydrateAccountDetails("/apps/manage", false), true);
});

Deno.test("session details stay lightweight for Deno shell pages when appview is configured", () => {
  assertEquals(shouldHydrateAccountDetails("/", true), false);
  assertEquals(shouldHydrateAccountDetails("/docs", true), false);
  assertEquals(shouldHydrateAccountDetails("/signin", true), false);
  assertEquals(
    shouldHydrateAccountDetails("/examples/atmosphere-login/app", true),
    false,
  );
});

Deno.test("session details fully hydrate inside the appview origin", () => {
  assertEquals(
    shouldHydrateAccountDetails("/account", true, true),
    true,
  );
  assertEquals(
    shouldHydrateAccountDetails("/apps/manage", true, true),
    true,
  );
  assertEquals(
    shouldHydrateAccountDetails("/hosts/example.com/manage", true, true),
    true,
  );
});

Deno.test("session details keep full hydration for dev-only local helpers", () => {
  assertEquals(shouldHydrateAccountDetails("/dev/account-demo", true), true);
});

Deno.test("public immutable media bypasses session database hydration", () => {
  for (
    const path of [
      "/api/atproto/blob",
      "/api/registry/avatar/did%3Aplc%3Aalice",
      "/api/registry/banner/did%3Aplc%3Aalice",
      "/api/registry/icon/did%3Aplc%3Aalice",
      "/api/registry/icon-bw/did%3Aplc%3Aalice",
      "/api/registry/og-banner/did%3Aplc%3Aalice",
      "/api/registry/project-og/example.test",
      "/api/registry/screenshot/did%3Aplc%3Aalice/0",
      "/api/registry/icons",
      "/api/registry/icons.zip",
    ]
  ) {
    assertEquals(shouldBypassSessionForPublicMedia("GET", path), true);
    assertEquals(shouldBypassSessionForPublicMedia("HEAD", path), true);
    assertEquals(shouldBypassSessionForPublicMedia("POST", path), false);
  }
  for (
    const path of [
      "/api/me/avatar",
      "/api/registry/icon-access/request",
      "/api/admin/backfill-og-jpegs",
      "/account",
    ]
  ) {
    assertEquals(shouldBypassSessionForPublicMedia("GET", path), false);
  }
});

Deno.test("session lookup carries indexed app and operational host ownership", () => {
  for (
    const fragment of [
      "listing.deleted_at IS NULL",
      "listing.product_did = s.did",
      "listing.profile_did = s.did",
      "listing.legacy_profile_did = s.did",
      "claim.claimant_did = s.did",
      "claim.verified_at IS NOT NULL",
      "INNER JOIN account_host host ON host.host = claim.host",
      "claim.method IN ('dns_txt', 'atproto_handle', 'pds_contact_email')",
      "claim.method = 'oauth_atproto_account'",
      "host.source IN ('manual', 'observed')",
      "lower(host.host) NOT IN (",
      "'bsky.network'",
      "claim.method = 'local_dev_fixture'",
      "lower(host.host) LIKE '%.test'",
    ]
  ) {
    assertEquals(SESSION_LOOKUP_SQL.includes(fragment), true);
  }
  assertEquals(
    SESSION_LOOKUP_SQL.includes("AS has_managed_app_profile"),
    true,
  );
  assertEquals(
    SESSION_LOOKUP_SQL.includes("AS has_managed_host_profiles"),
    true,
  );
  assertEquals(SESSION_LOOKUP_SQL.includes("AS has_managed_profiles"), false);
});

Deno.test("session ownership booleans normalize across database drivers", () => {
  for (const value of [true, 1, 1n, "1", "true"]) {
    assertEquals(databaseBoolean(value), true);
  }
  for (const value of [false, 0, 0n, "0", "false", null, undefined]) {
    assertEquals(databaseBoolean(value), false);
  }
});

Deno.test("session host menu policy preserves self-contained ownership", () => {
  for (
    const method of [
      "dns_txt",
      "atproto_handle",
      "pds_contact_email",
    ]
  ) {
    assertEquals(
      sessionHostClaimCanSetMenuFlag({
        host: "bsky.network",
        method,
        source: "seeded",
      }, false),
      true,
    );
  }
});

Deno.test("session host menu policy preserves ordinary legacy OAuth", () => {
  for (const source of ["manual", "observed"]) {
    assertEquals(
      sessionHostClaimCanSetMenuFlag({
        host: "pds.example.com",
        method: "oauth_atproto_account",
        source,
      }, false),
      true,
    );
  }
});

Deno.test("session host menu policy defers seeded OAuth authority", () => {
  for (const source of ["seeded", "manual", "observed", null]) {
    assertEquals(
      sessionHostClaimCanSetMenuFlag({
        host: "bsky.network",
        method: "oauth_atproto_account",
        source,
      }, false),
      false,
    );
  }
  assertEquals(
    sessionHostClaimCanSetMenuFlag({
      host: "unrecognized.example",
      method: "oauth_atproto_account",
      source: null,
    }, false),
    false,
  );
});

Deno.test("session host menu policy limits local fixtures to dev .test hosts", () => {
  const fixture = {
    host: "host.test",
    method: "local_dev_fixture",
    source: "manual",
  };
  assertEquals(sessionHostClaimCanSetMenuFlag(fixture, true), true);
  assertEquals(sessionHostClaimCanSetMenuFlag(fixture, false), false);
  assertEquals(
    sessionHostClaimCanSetMenuFlag({ ...fixture, host: "host.example" }, true),
    false,
  );

  const productionSql = sessionManagedHostOwnershipSql(false);
  const developmentSql = sessionManagedHostOwnershipSql(true);
  assertEquals(productionSql.includes("AND 1 = 0"), true);
  assertEquals(developmentSql.includes("AND 1 = 1"), true);
});

Deno.test("session ownership predicates have SQLite and Postgres indexes", async () => {
  const [sqliteSchema, postgresSchema] = await Promise.all([
    Deno.readTextFile(new URL("./db.ts", import.meta.url)),
    Deno.readTextFile(
      new URL("../sql/neon/001_initial.sql", import.meta.url),
    ),
  ]);
  for (const schema of [sqliteSchema, postgresSchema]) {
    for (
      const index of [
        "app_listing_product_owner ON app_listing(product_did, deleted_at)",
        "app_listing_profile_owner ON app_listing(profile_did, deleted_at)",
        "app_listing_legacy ON app_listing(legacy_profile_did)",
        "account_host_claim_claimant ON account_host_claim(claimant_did)",
      ]
    ) {
      assertEquals(schema.includes(index), true);
    }
  }
});
