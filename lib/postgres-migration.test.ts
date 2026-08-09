import {
  POSTGRES_SCHEMA_MIGRATION_LOCK_SQL,
  withPostgresSchemaMigrationLock,
} from "./postgres-migration.ts";

Deno.test("Postgres deploy migration locks inside the schema transaction", () => {
  const schema = [
    "-- schema",
    "BEGIN;",
    "CREATE TABLE example (id text PRIMARY KEY);",
    "COMMIT;",
  ].join("\n");

  const locked = withPostgresSchemaMigrationLock(schema);
  assertOrdered(locked, [
    "BEGIN;",
    POSTGRES_SCHEMA_MIGRATION_LOCK_SQL,
    "CREATE TABLE example",
    "COMMIT;",
  ]);
  assertOccurrences(locked, POSTGRES_SCHEMA_MIGRATION_LOCK_SQL, 1);
});

Deno.test("Postgres deploy migration fails closed without one transaction", () => {
  for (
    const schema of [
      "CREATE TABLE example (id text);",
      "BEGIN;\nCREATE TABLE example (id text);",
      "CREATE TABLE example (id text);\nCOMMIT;",
      "BEGIN;\nBEGIN;\nCOMMIT;",
      "BEGIN;\nCOMMIT;\nCOMMIT;",
      `BEGIN;\n${POSTGRES_SCHEMA_MIGRATION_LOCK_SQL}\nCOMMIT;`,
    ]
  ) {
    assertThrows(() => withPostgresSchemaMigrationLock(schema));
  }
});

Deno.test("Railway lock wraps the real Postgres baseline without changing its source", async () => {
  const schema = await Deno.readTextFile("sql/neon/001_initial.sql");
  if (schema.includes(POSTGRES_SCHEMA_MIGRATION_LOCK_SQL)) {
    throw new Error(
      "The shared Neon/Postgres schema must not contain the Railway advisory lock",
    );
  }

  const locked = withPostgresSchemaMigrationLock(schema);
  assertOrdered(locked, [
    "BEGIN;",
    POSTGRES_SCHEMA_MIGRATION_LOCK_SQL,
    "CREATE EXTENSION IF NOT EXISTS pg_trgm",
    "COMMIT;",
  ]);
  assertOccurrences(locked, POSTGRES_SCHEMA_MIGRATION_LOCK_SQL, 1);
});

function assertOrdered(haystack: string, needles: string[]): void {
  let cursor = -1;
  for (const needle of needles) {
    const index = haystack.indexOf(needle, cursor + 1);
    if (index < 0) throw new Error(`Expected to find ${needle}`);
    if (index <= cursor) {
      throw new Error(`Expected ${needle} after prior value`);
    }
    cursor = index;
  }
}

function assertOccurrences(
  haystack: string,
  needle: string,
  expected: number,
): void {
  const actual = haystack.split(needle).length - 1;
  if (actual !== expected) {
    throw new Error(
      `Expected ${expected} occurrences of ${needle}, got ${actual}`,
    );
  }
}

function assertThrows(fn: () => unknown): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error("Expected function to throw");
}
