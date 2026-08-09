import { NEON_APP_TABLES } from "./neon-migration.ts";

Deno.test("NEON_APP_TABLES tracks app tables from the Postgres baseline schema", async () => {
  const schema = await Deno.readTextFile("sql/neon/001_initial.sql");
  const schemaTables = [
    ...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/g),
  ].map((match) => match[1])
    .filter((table) => table !== "schema_migration")
    .sort();

  assertStringArrayEquals([...NEON_APP_TABLES].sort(), schemaTables);
});

Deno.test("new databases do not create retired passkey tables", async () => {
  const schema = await Deno.readTextFile("sql/neon/001_initial.sql");
  for (
    const table of [
      "passkey_account",
      "passkey_credential",
      "passkey_ceremony",
    ]
  ) {
    if (
      schema.includes(table) ||
      NEON_APP_TABLES.some((active) => active === table)
    ) {
      throw new Error(`Retired passkey table is still active: ${table}`);
    }
  }
});

Deno.test("Postgres baseline removes legacy per-DID PDS discovery tables", async () => {
  const schema = await Deno.readTextFile("sql/neon/001_initial.sql");
  for (const table of ["pds_host_account", "pds_discovery_cursor"]) {
    if (!schema.includes(`DROP TABLE IF EXISTS ${table}`)) {
      throw new Error(`Expected baseline schema to drop ${table}`);
    }
  }
});

Deno.test("Postgres baseline adds the verified preferred account host field", async () => {
  const schema = await Deno.readTextFile("sql/neon/001_initial.sql");
  if (
    !schema.includes(
      "ADD COLUMN IF NOT EXISTS preferred_account_host text",
    )
  ) {
    throw new Error(
      "Expected the login_app preferred account host migration to be additive",
    );
  }
});

Deno.test("Postgres baseline links login environments to one stable app profile", async () => {
  const schema = await Deno.readTextFile("sql/neon/001_initial.sql");
  for (
    const column of [
      "app_did text",
      "app_profile_uri text",
      "link_status text NOT NULL DEFAULT 'relink_required'",
      "profile_identity_fingerprint text",
      "profile_identity_updated_at bigint",
      "review_revision text",
      "environment_revision text",
    ]
  ) {
    if (!schema.includes(`ADD COLUMN IF NOT EXISTS ${column}`)) {
      throw new Error(`Expected additive login_app ${column} migration`);
    }
  }
  if (!schema.includes("SELECT COUNT(*)") || !schema.includes(") = 1;")) {
    throw new Error(
      "Legacy login environments must auto-link only to one unambiguous app profile",
    );
  }
  if (
    !schema.includes(
      "WHERE COALESCE(environment_revision, '') = ''",
    )
  ) {
    throw new Error(
      "Expected existing login environments to receive owner-edit revisions",
    );
  }
});

Deno.test("Postgres baseline adds app hero fallback media", async () => {
  const schema = await Deno.readTextFile("sql/neon/001_initial.sql");
  if (!schema.includes("ADD COLUMN IF NOT EXISTS hero_fallback_url text")) {
    throw new Error("Expected the app hero fallback migration to be additive");
  }
});

Deno.test("Postgres baseline reserves one app record target per DID", async () => {
  const schema = await Deno.readTextFile("sql/neon/001_initial.sql");
  const table = schema.match(
    /CREATE TABLE IF NOT EXISTS app_profile_target\s*\(([\s\S]*?)\);/i,
  )?.[1] ?? "";
  if (
    !/did text PRIMARY KEY/i.test(table) || !/rkey text NOT NULL/i.test(table)
  ) {
    throw new Error("app_profile_target must make the controlling DID unique");
  }
});

Deno.test("SQLite baseline reserves one app record target per DID", async () => {
  const schema = await Deno.readTextFile(new URL("./db.ts", import.meta.url));
  const table = schema.match(
    /CREATE TABLE IF NOT EXISTS app_profile_target\s*\(([\s\S]*?)\)/i,
  )?.[1] ?? "";
  if (
    !/did TEXT PRIMARY KEY/i.test(table) || !/rkey TEXT NOT NULL/i.test(table)
  ) {
    throw new Error("SQLite app_profile_target must make each DID unique");
  }
});

Deno.test("Postgres baseline adds durable public host intent evidence", async () => {
  const schema = await Deno.readTextFile("sql/neon/001_initial.sql");
  for (
    const column of [
      "public_intent_status text NOT NULL DEFAULT 'unknown'",
      "public_intent_source text",
      "public_intent_checked_at bigint",
      "public_intent_attempted_at bigint",
      "public_intent_evidence_json text",
    ]
  ) {
    if (!schema.includes(`ADD COLUMN IF NOT EXISTS ${column}`)) {
      throw new Error(
        `Expected the account_host ${column} migration to be additive`,
      );
    }
  }
});

Deno.test("Postgres CREATE TABLE blocks never define a column twice", async () => {
  const schema = await Deno.readTextFile("sql/neon/001_initial.sql");
  const tables = createTableColumns(schema);
  if (tables.length === 0) {
    throw new Error("Expected to find Postgres CREATE TABLE definitions");
  }

  for (const { table, columns } of tables) {
    const seen = new Set<string>();
    for (const column of columns) {
      if (seen.has(column)) {
        throw new Error(`${table} defines column ${column} more than once`);
      }
      seen.add(column);
    }
  }

  const accountHost = tables.find(({ table }) => table === "account_host");
  if (!accountHost) throw new Error("Expected account_host CREATE TABLE block");
  const publicIntentCount =
    accountHost.columns.filter((column) => column === "public_intent_status")
      .length;
  if (publicIntentCount !== 1) {
    throw new Error(
      `account_host must define public_intent_status exactly once, got ${publicIntentCount}`,
    );
  }
});

Deno.test("Postgres baseline adds explicit operator directory visibility", async () => {
  const schema = await Deno.readTextFile("sql/neon/001_initial.sql");
  for (
    const column of [
      "operator_listing_opt_in integer",
      "operator_listing_opted_at bigint",
    ]
  ) {
    if (!schema.includes(`ADD COLUMN IF NOT EXISTS ${column}`)) {
      throw new Error(
        `Expected the account_host ${column} migration to be additive`,
      );
    }
  }
});

function assertStringArrayEquals(actual: string[], expected: string[]): void {
  if (actual.length === expected.length) {
    const mismatch = actual.find((value, index) => value !== expected[index]);
    if (!mismatch) return;
  }
  throw new Error(
    `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function createTableColumns(
  schema: string,
): Array<{ table: string; columns: string[] }> {
  const tableConstraintKeywords = new Set([
    "check",
    "constraint",
    "exclude",
    "foreign",
    "primary",
    "unique",
  ]);
  return [
    ...schema.matchAll(
      /CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)^\);/gim,
    ),
  ].map((match) => ({
    table: match[1].toLowerCase(),
    columns: [
      ...match[2].matchAll(
        /^ {2}([a-z_][a-z0-9_]*)\s+/gim,
      ),
    ].map((column) => column[1].toLowerCase())
      .filter((column) => !tableConstraintKeywords.has(column)),
  }));
}
