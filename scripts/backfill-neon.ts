import { withDb } from "../lib/db.ts";
import { loadDotEnvIfPresent, requireEnv } from "../lib/cli-env.ts";
import {
  createNeonExecuteClient,
  type DbExecuteClient,
  type DbValue,
} from "../lib/neon.ts";
import {
  NEON_APP_TABLES,
  parseArgs,
  quoteIdent,
  quoteQualifiedTable,
} from "../lib/neon-migration.ts";

const CHUNK_SIZE = 500;

interface ColumnInfo {
  name: string;
  ordinal: number;
  hasDefault: boolean;
  isGenerated: boolean;
}

interface TableBackfillResult {
  table: string;
  sourceRows: number;
  copiedRows: number;
  skipped: boolean;
  reason?: string;
}

function usage(exitCode = 2): never {
  const write = exitCode === 0 ? console.log : console.error;
  write(
    [
      "Usage: deno task db:backfill:neon [--write] [--reset] [--limit=N]",
      "                                  [--tables=a,b] [--skip-tables=a,b]",
      "                                  [--allow-missing-source-tables]",
      "",
      "Default is dry-run. Use --write to copy data.",
      "--reset truncates selected Neon tables before copying and requires --write.",
      "",
      "Environment:",
      "  TURSO_DATABASE_URL / TURSO_AUTH_TOKEN",
      "  NEON_DIRECT_DATABASE_URL or NEON_DATABASE_URL",
    ].join("\n"),
  );
  Deno.exit(exitCode);
}

function valueForDb(value: unknown): DbValue {
  if (value == null) return null;
  if (
    typeof value === "string" || typeof value === "number" ||
    typeof value === "bigint" || typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return String(value);
}

async function sourceColumns(table: string): Promise<string[]> {
  return await withDb(async (db) => {
    const result = await db.execute(
      `PRAGMA table_info(${quoteIdent(table)})`,
    );
    return result.rows.map((row) => String(row.name));
  });
}

async function destinationColumns(
  db: DbExecuteClient,
  table: string,
): Promise<ColumnInfo[]> {
  const result = await db.execute({
    sql: `
      SELECT column_name, ordinal_position, column_default,
        is_generated
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ?
      ORDER BY ordinal_position
    `,
    args: [table],
  });
  return result.rows.map((row) => ({
    name: String(row.column_name),
    ordinal: Number(row.ordinal_position),
    hasDefault: row.column_default != null,
    isGenerated: String(row.is_generated ?? "NEVER") !== "NEVER",
  }));
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

async function sourceRowCount(table: string): Promise<number> {
  return await withDb(async (db) => {
    const result = await db.execute(
      `SELECT COUNT(*) AS count FROM ${quoteQualifiedTable(table)}`,
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}

async function readSourceRows(
  table: string,
  columns: string[],
  limit: number,
  offset: number,
): Promise<Record<string, unknown>[]> {
  return await withDb(async (db) => {
    const columnList = columns.map(quoteIdent).join(", ");
    const result = await db.execute({
      sql: `SELECT ${columnList} FROM ${
        quoteQualifiedTable(table)
      } LIMIT ? OFFSET ?`,
      args: [limit, offset],
    });
    return result.rows as Record<string, unknown>[];
  });
}

function buildUpsertSql(
  table: string,
  columns: string[],
  primaryKeys: string[],
): string {
  const columnList = columns.map(quoteIdent).join(", ");
  const values = columns.map((_, index) => `$${index + 1}`).join(", ");
  const conflictTarget = primaryKeys.map(quoteIdent).join(", ");
  const updateColumns = columns.filter((column) =>
    !primaryKeys.includes(column)
  );
  const updates = updateColumns.map((column) =>
    `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`
  ).join(", ");

  return [
    `INSERT INTO ${quoteQualifiedTable(table)} (${columnList})`,
    `VALUES (${values})`,
    updateColumns.length
      ? `ON CONFLICT (${conflictTarget}) DO UPDATE SET ${updates}`
      : `ON CONFLICT (${conflictTarget}) DO NOTHING`,
  ].join(" ");
}

async function resetTables(db: DbExecuteClient, tables: string[]) {
  if (!tables.length) return;
  const tableList = tables.map(quoteQualifiedTable).join(", ");
  await db.execute(
    `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
  );
}

async function syncSequences(db: DbExecuteClient) {
  const serials = await db.execute(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_default LIKE 'nextval(%'
    ORDER BY table_name, ordinal_position
  `);

  for (const row of serials.rows) {
    const table = String(row.table_name);
    const column = String(row.column_name);
    await db.execute({
      sql: `
        SELECT setval(
          pg_get_serial_sequence(?, ?),
          GREATEST(COALESCE((SELECT MAX(${quoteIdent(column)}) FROM ${
        quoteQualifiedTable(table)
      }), 0), 1),
          (SELECT COUNT(*) > 0 FROM ${quoteQualifiedTable(table)})
        )
      `,
      args: [`public.${table}`, column],
    });
  }
}

async function backfillTable(
  db: DbExecuteClient,
  table: string,
  dryRun: boolean,
  limit: number | null,
  allowMissingSourceTables: boolean,
): Promise<TableBackfillResult> {
  const source = await sourceColumns(table);
  if (!source.length) {
    if (allowMissingSourceTables) {
      return {
        table,
        sourceRows: 0,
        copiedRows: 0,
        skipped: true,
        reason: "missing source table",
      };
    }
    throw new Error(`source table ${table} does not exist`);
  }

  const destination = await destinationColumns(db, table);
  if (!destination.length) {
    return {
      table,
      sourceRows: 0,
      copiedRows: 0,
      skipped: true,
      reason: "missing destination table",
    };
  }

  const sourceSet = new Set(source);
  const copyColumns = destination
    .filter((column) => !column.isGenerated)
    .map((column) => column.name)
    .filter((column) => sourceSet.has(column));
  if (!copyColumns.length) {
    return {
      table,
      sourceRows: 0,
      copiedRows: 0,
      skipped: true,
      reason: "no shared columns",
    };
  }

  const primaryKeys = await destinationPrimaryKeys(db, table);
  if (!primaryKeys.length) {
    return {
      table,
      sourceRows: 0,
      copiedRows: 0,
      skipped: true,
      reason: "no destination primary key",
    };
  }

  const total = await sourceRowCount(table);
  const sourceRows = limit == null ? total : Math.min(total, limit);
  if (dryRun || sourceRows === 0) {
    return { table, sourceRows, copiedRows: 0, skipped: false };
  }

  const upsertSql = buildUpsertSql(table, copyColumns, primaryKeys);
  let copiedRows = 0;
  for (let offset = 0; offset < sourceRows; offset += CHUNK_SIZE) {
    const size = Math.min(CHUNK_SIZE, sourceRows - offset);
    const rows = await readSourceRows(table, copyColumns, size, offset);
    for (const row of rows) {
      await db.execute({
        sql: upsertSql,
        args: copyColumns.map((column) => valueForDb(row[column])),
      });
      copiedRows++;
    }
  }

  return { table, sourceRows, copiedRows, skipped: false };
}

const args = Deno.args.filter((arg) => arg !== "--");
if (args.includes("--help") || args.includes("-h")) usage(0);
await loadDotEnvIfPresent();
requireEnv(
  "TURSO_DATABASE_URL",
  "Neon backfill needs an explicit Turso/libSQL source. Set it in .env or export it before running this task.",
);

const options = parseArgs(args);
if (options.reset && options.dryRun) {
  throw new Error("--reset requires --write");
}

const db = createNeonExecuteClient();
const selectedTables = (options.tables.length ? options.tables : [
  ...NEON_APP_TABLES,
]).filter((table) => !options.skipTables.has(table));

console.log(
  `[db:backfill:neon] ${
    options.dryRun ? "dry-run" : "write"
  } ${selectedTables.length} tables`,
);

if (!options.dryRun && options.reset) {
  console.log("[db:backfill:neon] truncating selected Neon tables");
  await resetTables(db, selectedTables);
}

const started = performance.now();
const results: TableBackfillResult[] = [];
for (const table of selectedTables) {
  const result = await backfillTable(
    db,
    table,
    options.dryRun,
    options.limit,
    options.allowMissingSourceTables,
  );
  results.push(result);
  const suffix = result.skipped
    ? `skipped (${result.reason})`
    : options.dryRun
    ? `${result.sourceRows} rows ready`
    : `${result.copiedRows}/${result.sourceRows} rows copied`;
  console.log(`[db:backfill:neon] ${table}: ${suffix}`);
}

if (!options.dryRun) await syncSequences(db);

const copied = results.reduce((sum, result) => sum + result.copiedRows, 0);
const ready = results.reduce((sum, result) => sum + result.sourceRows, 0);
const elapsed = Math.round(performance.now() - started);
console.log(
  `[db:backfill:neon] done (${
    options.dryRun ? ready : copied
  } rows, ${elapsed}ms)`,
);
