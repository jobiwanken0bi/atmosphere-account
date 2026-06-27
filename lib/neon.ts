import { neon } from "@neon/serverless";

export type DbValue =
  | string
  | number
  | bigint
  | boolean
  | Uint8Array
  | ArrayBuffer
  | null;

export interface DbExecuteResult {
  rows: Record<string, unknown>[];
  rowsAffected: number;
  lastInsertRowid?: number | bigint;
}

export interface DbExecuteClient {
  execute(
    query: string | { sql: string; args?: unknown[] },
    args?: unknown[],
  ): Promise<DbExecuteResult>;
}

export function neonDatabaseUrl(): string {
  const url = Deno.env.get("NEON_DIRECT_DATABASE_URL") ??
    Deno.env.get("NEON_DATABASE_URL");
  if (!url) {
    throw new Error(
      "NEON_DIRECT_DATABASE_URL or NEON_DATABASE_URL is required for Neon migration tasks.",
    );
  }
  return url;
}

export function neonRuntimeDatabaseUrl(): string {
  const url = Deno.env.get("NEON_DATABASE_URL") ??
    Deno.env.get("NEON_DIRECT_DATABASE_URL");
  if (!url) {
    throw new Error(
      "NEON_DATABASE_URL or NEON_DIRECT_DATABASE_URL is required when ATMOSPHERE_DB_BACKEND=neon.",
    );
  }
  return url;
}

export function createNeonClient(connectionString = neonDatabaseUrl()) {
  return neon(connectionString);
}

export function createNeonExecuteClient(
  connectionString = neonDatabaseUrl(),
): DbExecuteClient {
  const sql = createNeonClient(connectionString);
  return {
    async execute(query, positionalArgs) {
      const statement = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string"
        ? positionalArgs ?? []
        : query.args ?? [];
      const converted = convertQuestionParameters(statement);
      const result = await sql.query(converted, args.map(valueForNeon), {
        fullResults: true,
      });
      return {
        rows: result.rows as Record<string, unknown>[],
        rowsAffected: result.rowCount ?? 0,
      };
    },
  };
}

function valueForNeon(value: unknown): DbValue {
  if (value == null) return null;
  if (
    typeof value === "string" || typeof value === "number" ||
    typeof value === "bigint" || typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return value;
  return String(value);
}

/**
 * Converts the libSQL-style `?` placeholders used by most of the app into
 * Postgres `$1` placeholders. This intentionally handles SQL string literals
 * and comments so URLs or JSON blobs containing `?` are left alone.
 */
export function convertQuestionParameters(sql: string): string {
  let out = "";
  let index = 1;
  let mode:
    | "normal"
    | "single"
    | "double"
    | "line_comment"
    | "block_comment"
    | "dollar" = "normal";
  let dollarTag = "";

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (mode === "line_comment") {
      out += ch;
      if (ch === "\n") mode = "normal";
      continue;
    }

    if (mode === "block_comment") {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i++;
        mode = "normal";
      }
      continue;
    }

    if (mode === "single") {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i++;
      } else if (ch === "'") {
        mode = "normal";
      }
      continue;
    }

    if (mode === "double") {
      out += ch;
      if (ch === '"' && next === '"') {
        out += next;
        i++;
      } else if (ch === '"') {
        mode = "normal";
      }
      continue;
    }

    if (mode === "dollar") {
      if (dollarTag && sql.startsWith(dollarTag, i)) {
        out += dollarTag;
        i += dollarTag.length - 1;
        mode = "normal";
        dollarTag = "";
      } else {
        out += ch;
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      out += ch + next;
      i++;
      mode = "line_comment";
      continue;
    }

    if (ch === "/" && next === "*") {
      out += ch + next;
      i++;
      mode = "block_comment";
      continue;
    }

    if (ch === "'") {
      out += ch;
      mode = "single";
      continue;
    }

    if (ch === '"') {
      out += ch;
      mode = "double";
      continue;
    }

    if (ch === "$") {
      const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        out += dollarTag;
        i += dollarTag.length - 1;
        mode = "dollar";
        continue;
      }
    }

    if (ch === "?") {
      out += `$${index++}`;
      continue;
    }

    out += ch;
  }

  return out;
}
