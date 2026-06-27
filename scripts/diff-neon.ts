import { withDb } from "../lib/db.ts";
import { loadDotEnvIfPresent, requireEnv } from "../lib/cli-env.ts";
import { createNeonExecuteClient, type DbExecuteClient } from "../lib/neon.ts";
import {
  NEON_APP_TABLES,
  parseArgs,
  quoteIdent,
  quoteQualifiedTable,
} from "../lib/neon-migration.ts";

interface DiffResult {
  table: string;
  sourceRows: number;
  destinationRows: number;
  countMatches: boolean;
  keysetChecked: boolean;
  missingInDestination: string[];
  extraInDestination: string[];
  skipped?: string;
}

function usage(exitCode = 2): never {
  const write = exitCode === 0 ? console.log : console.error;
  write(
    [
      "Usage: deno task db:diff:neon [--limit=N] [--tables=a,b] [--skip-tables=a,b]",
      "",
      "--limit controls the max row count for primary-key keyset comparison.",
      "Default limit is 50000.",
      "",
      "Environment:",
      "  TURSO_DATABASE_URL / TURSO_AUTH_TOKEN",
      "  NEON_DIRECT_DATABASE_URL or NEON_DATABASE_URL",
    ].join("\n"),
  );
  Deno.exit(exitCode);
}

async function sourceRowCount(table: string): Promise<number> {
  return await withDb(async (db) => {
    const result = await db.execute(
      `SELECT COUNT(*) AS count FROM ${quoteQualifiedTable(table)}`,
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}

async function destinationRowCount(
  db: DbExecuteClient,
  table: string,
): Promise<number> {
  const result = await db.execute(
    `SELECT COUNT(*) AS count FROM ${quoteQualifiedTable(table)}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function destinationPrimaryKeys(
  db: DbExecuteClient,
  table: string,
): Promise<string[]> {
  const result = await db.execute({
    sql: `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = ?
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `,
    args: [table],
  });
  return result.rows.map((row) => String(row.column_name));
}

async function readSourceKeys(
  table: string,
  primaryKeys: string[],
): Promise<Set<string>> {
  return await withDb(async (db) => {
    const columns = primaryKeys.map(quoteIdent).join(", ");
    const orderBy = primaryKeys.map(quoteIdent).join(", ");
    const result = await db.execute(
      `SELECT ${columns} FROM ${
        quoteQualifiedTable(table)
      } ORDER BY ${orderBy}`,
    );
    return new Set(result.rows.map((row) => keyForRow(row, primaryKeys)));
  });
}

async function readDestinationKeys(
  db: DbExecuteClient,
  table: string,
  primaryKeys: string[],
): Promise<Set<string>> {
  const columns = primaryKeys.map(quoteIdent).join(", ");
  const orderBy = primaryKeys.map(quoteIdent).join(", ");
  const result = await db.execute(
    `SELECT ${columns} FROM ${quoteQualifiedTable(table)} ORDER BY ${orderBy}`,
  );
  return new Set(result.rows.map((row) => keyForRow(row, primaryKeys)));
}

function keyForRow(
  row: Record<string, unknown>,
  primaryKeys: string[],
): string {
  return primaryKeys.map((key) => String(row[key])).join("\u001f");
}

function firstFew(values: Iterable<string>, limit = 5): string[] {
  const out: string[] = [];
  for (const value of values) {
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

async function diffTable(
  db: DbExecuteClient,
  table: string,
  keyLimit: number,
): Promise<DiffResult> {
  const [sourceRows, destinationRows, primaryKeys] = await Promise.all([
    sourceRowCount(table),
    destinationRowCount(db, table),
    destinationPrimaryKeys(db, table),
  ]);

  const result: DiffResult = {
    table,
    sourceRows,
    destinationRows,
    countMatches: sourceRows === destinationRows,
    keysetChecked: false,
    missingInDestination: [],
    extraInDestination: [],
  };

  if (!primaryKeys.length) {
    result.skipped = "no primary key";
    return result;
  }

  if (Math.max(sourceRows, destinationRows) > keyLimit) {
    result.skipped = `row count exceeds key comparison limit ${keyLimit}`;
    return result;
  }

  const [sourceKeys, destinationKeys] = await Promise.all([
    readSourceKeys(table, primaryKeys),
    readDestinationKeys(db, table, primaryKeys),
  ]);
  result.keysetChecked = true;
  result.missingInDestination = firstFew(
    [...sourceKeys].filter((key) => !destinationKeys.has(key)),
  );
  result.extraInDestination = firstFew(
    [...destinationKeys].filter((key) => !sourceKeys.has(key)),
  );
  return result;
}

const args = Deno.args.filter((arg) => arg !== "--");
if (args.includes("--help") || args.includes("-h")) usage(0);
await loadDotEnvIfPresent();
requireEnv(
  "TURSO_DATABASE_URL",
  "Neon diff needs an explicit Turso/libSQL source. Set it in .env or export it before running this task.",
);

const options = parseArgs(args);
const keyLimit = options.limit ?? 50_000;
const selectedTables = (options.tables.length ? options.tables : [
  ...NEON_APP_TABLES,
]).filter((table) => !options.skipTables.has(table));
const db = createNeonExecuteClient();
const results: DiffResult[] = [];

for (const table of selectedTables) {
  const result = await diffTable(db, table, keyLimit);
  results.push(result);
  const keyStatus = result.keysetChecked
    ? result.missingInDestination.length || result.extraInDestination.length
      ? "keys differ"
      : "keys match"
    : `keys skipped (${result.skipped})`;
  console.log(
    `[db:diff:neon] ${table}: turso=${result.sourceRows} neon=${result.destinationRows} ${
      result.countMatches ? "counts match" : "counts differ"
    }; ${keyStatus}`,
  );
  if (result.missingInDestination.length) {
    console.log(
      `  missing in Neon: ${result.missingInDestination.join(", ")}`,
    );
  }
  if (result.extraInDestination.length) {
    console.log(`  extra in Neon: ${result.extraInDestination.join(", ")}`);
  }
}

const failures = results.filter((result) =>
  !result.countMatches || result.missingInDestination.length ||
  result.extraInDestination.length
);
if (failures.length) {
  console.error(`[db:diff:neon] ${failures.length} table(s) differ`);
  Deno.exit(1);
}

console.log(`[db:diff:neon] all ${results.length} table(s) match`);
