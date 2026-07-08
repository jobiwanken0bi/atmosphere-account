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

function assertStringArrayEquals(actual: string[], expected: string[]): void {
  if (actual.length === expected.length) {
    const mismatch = actual.find((value, index) => value !== expected[index]);
    if (!mismatch) return;
  }
  throw new Error(
    `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}
