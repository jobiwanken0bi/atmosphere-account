import { Pool } from "pg";
import { Buffer } from "node:buffer";
import {
  convertQuestionParameters,
  type DbExecuteClient,
  type DbValue,
} from "./neon.ts";

export function postgresDatabaseUrl(): string {
  const url = Deno.env.get("POSTGRES_DATABASE_URL") ??
    Deno.env.get("DATABASE_URL") ??
    Deno.env.get("POSTGRES_URL");
  if (!url) {
    throw new Error(
      "POSTGRES_DATABASE_URL, DATABASE_URL, or POSTGRES_URL is required when ATMOSPHERE_DB_BACKEND=postgres.",
    );
  }
  return url;
}

export function createPostgresExecuteClient(
  connectionString = postgresDatabaseUrl(),
): DbExecuteClient {
  const pool = new Pool(postgresPoolOptions(connectionString));
  attachPostgresPoolErrorHandler(pool);

  const client = {
    execute: (query: DbQuery, positionalArgs?: unknown[]) =>
      executePostgresQuery(pool, query, positionalArgs),
    withTransaction: <T>(fn: (transaction: DbExecuteClient) => Promise<T>) =>
      runPostgresTransaction(pool, fn),
    end: () => pool.end(),
  };
  return client as DbExecuteClient;
}

type DbQuery = string | { sql: string; args?: unknown[] };

interface PostgresQueryExecutor {
  query(
    statement: string,
    args?: Array<DbValue | Buffer>,
  ): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

interface PostgresTransactionConnection extends PostgresQueryExecutor {
  release(error?: Error): void;
}

interface PostgresTransactionPool {
  connect(): Promise<PostgresTransactionConnection>;
}

async function executePostgresQuery(
  executor: PostgresQueryExecutor,
  query: DbQuery,
  positionalArgs?: unknown[],
) {
  const statement = typeof query === "string" ? query : query.sql;
  const args = typeof query === "string"
    ? positionalArgs ?? []
    : query.args ?? [];
  const result = await executor.query(
    convertQuestionParameters(statement),
    args.map(valueForPostgres),
  );
  return {
    rows: result.rows as Record<string, unknown>[],
    rowsAffected: result.rowCount ?? 0,
  };
}

async function runPostgresTransaction<T>(
  pool: PostgresTransactionPool,
  fn: (transaction: DbExecuteClient) => Promise<T>,
): Promise<T> {
  const connection = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await connection.query("BEGIN");
    const transaction: DbExecuteClient = {
      execute: (query, positionalArgs) =>
        executePostgresQuery(connection, query, positionalArgs),
    };
    const result = await fn(transaction);
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await connection.query("ROLLBACK");
    } catch (rollbackError) {
      releaseError = errorValue(rollbackError);
      console.error(
        `[postgres] transaction rollback failed error=${
          errorName(rollbackError)
        }`,
      );
    }
    throw error;
  } finally {
    connection.release(releaseError);
  }
}

export async function runPostgresTransactionForTest<T>(
  pool: PostgresTransactionPool,
  fn: (transaction: DbExecuteClient) => Promise<T>,
): Promise<T> {
  return await runPostgresTransaction(pool, fn);
}

const DEFAULT_POSTGRES_POOL_MAX = 5;

interface PostgresPoolErrorEmitter {
  on(event: "error", listener: (error: Error) => void): unknown;
}

/**
 * node-postgres removes a failed idle client before emitting this event. The
 * listener prevents EventEmitter's default unhandled-error crash; the next
 * checkout creates a replacement connection on demand.
 */
export function attachPostgresPoolErrorHandler(
  pool: PostgresPoolErrorEmitter,
): void {
  pool.on("error", (error) => {
    console.info(
      `[postgres] idle pooled connection dropped; reconnecting on demand error=${error.name}`,
    );
  });
}

function errorName(value: unknown): string {
  return value instanceof Error ? value.name : typeof value;
}

function errorValue(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error("transaction rollback failed");
}

/**
 * Keep the small runtime pool alive instead of accepting node-postgres' 10s
 * idle timeout. Deno's Node socket compatibility layer retains closed socket
 * state under repeated pg connection churn, so a quiet/bursty service grows
 * its JavaScript heap every time the default idle timer retires the pool.
 *
 * Failed connections are still removed by node-postgres and `max` remains a
 * hard bound. At most five idle connections are retained by default.
 */
export function postgresPoolOptions(
  connectionString: string,
  rawPoolMax = Deno.env.get("POSTGRES_POOL_MAX"),
) {
  const parsedMax = Number(rawPoolMax ?? DEFAULT_POSTGRES_POOL_MAX);
  const max = Number.isSafeInteger(parsedMax) && parsedMax > 0
    ? parsedMax
    : DEFAULT_POSTGRES_POOL_MAX;
  return {
    connectionString,
    max,
    idleTimeoutMillis: 0,
    ssl: sslConfigForConnectionString(connectionString),
  };
}

export async function closePostgresExecuteClient(
  client: DbExecuteClient,
): Promise<void> {
  const maybe = client as DbExecuteClient & { end?: () => Promise<void> };
  await maybe.end?.();
}

function sslConfigForConnectionString(connectionString: string) {
  const envMode = Deno.env.get("POSTGRES_SSL_MODE")?.trim().toLowerCase();
  if (envMode === "disable" || envMode === "false" || envMode === "0") {
    return false;
  }
  if (envMode === "require" || envMode === "true" || envMode === "1") {
    return { rejectUnauthorized: false };
  }
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  if (sslMode === "disable") return false;
  if (
    sslMode === "require" || sslMode === "verify-ca" ||
    sslMode === "verify-full"
  ) {
    return { rejectUnauthorized: false };
  }
  if (
    url.hostname === "localhost" || url.hostname === "127.0.0.1" ||
    url.hostname === "::1" || url.hostname.endsWith(".railway.internal")
  ) {
    return false;
  }
  return { rejectUnauthorized: false };
}

function valueForPostgres(value: unknown): DbValue | Buffer {
  if (value == null) return null;
  if (
    typeof value === "string" || typeof value === "number" ||
    typeof value === "bigint" || typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return String(value);
}
