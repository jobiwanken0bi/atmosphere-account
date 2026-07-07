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
  const pool = new Pool({
    connectionString,
    max: Number(Deno.env.get("POSTGRES_POOL_MAX") ?? 5),
    ssl: sslConfigForConnectionString(connectionString),
  });

  const client = {
    async execute(
      query: string | { sql: string; args?: unknown[] },
      positionalArgs?: unknown[],
    ) {
      const statement = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string"
        ? positionalArgs ?? []
        : query.args ?? [];
      const converted = convertQuestionParameters(statement);
      const result = await pool.query(
        converted,
        args.map(valueForPostgres),
      );
      return {
        rows: result.rows as Record<string, unknown>[],
        rowsAffected: result.rowCount ?? 0,
      };
    },
    end: () => pool.end(),
  };
  return client as DbExecuteClient;
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
