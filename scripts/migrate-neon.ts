import { loadDotEnvIfPresent } from "../lib/cli-env.ts";
import { createNeonClient, neonDatabaseUrl } from "../lib/neon.ts";

const DEFAULT_SCHEMA_PATH = "sql/neon/001_initial.sql";

function usage(exitCode = 2): never {
  const write = exitCode === 0 ? console.log : console.error;
  write(
    [
      "Usage: deno task db:migrate:neon [schema.sql]",
      "",
      "Environment:",
      "  NEON_DIRECT_DATABASE_URL or NEON_DATABASE_URL",
    ].join("\n"),
  );
  Deno.exit(exitCode);
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
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
    current += ch;

    if (mode === "line_comment") {
      if (ch === "\n") mode = "normal";
      continue;
    }

    if (mode === "block_comment") {
      if (ch === "*" && next === "/") {
        current += next;
        i++;
        mode = "normal";
      }
      continue;
    }

    if (mode === "single") {
      if (ch === "'" && next === "'") {
        current += next;
        i++;
      } else if (ch === "'") {
        mode = "normal";
      }
      continue;
    }

    if (mode === "double") {
      if (ch === '"' && next === '"') {
        current += next;
        i++;
      } else if (ch === '"') {
        mode = "normal";
      }
      continue;
    }

    if (mode === "dollar") {
      if (dollarTag && sql.startsWith(dollarTag, i)) {
        current += dollarTag.slice(1);
        i += dollarTag.length - 1;
        mode = "normal";
        dollarTag = "";
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      current += next;
      i++;
      mode = "line_comment";
      continue;
    }

    if (ch === "/" && next === "*") {
      current += next;
      i++;
      mode = "block_comment";
      continue;
    }

    if (ch === "'") {
      mode = "single";
      continue;
    }

    if (ch === '"') {
      mode = "double";
      continue;
    }

    if (ch === "$") {
      const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag.slice(1);
        i += dollarTag.length - 1;
        mode = "dollar";
        continue;
      }
    }

    if (ch === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement.replace(/;$/, "").trim());
      current = "";
    }
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

const args = Deno.args.filter((arg) => arg !== "--");
if (args.includes("--help") || args.includes("-h")) usage(0);
const schemaPath = args[0] ?? DEFAULT_SCHEMA_PATH;
await loadDotEnvIfPresent();

const started = performance.now();
const sql = createNeonClient(neonDatabaseUrl());
const schema = await Deno.readTextFile(schemaPath);
const statements = splitSqlStatements(schema)
  .filter((stmt) => !/^(BEGIN|COMMIT|ROLLBACK)$/i.test(stmt.trim()));

let applied = 0;
for (const statement of statements) {
  await sql.query(statement, []);
  applied++;
}

const elapsed = Math.round(performance.now() - started);
console.log(
  `[db:migrate:neon] applied ${applied} statements from ${schemaPath} (${elapsed}ms)`,
);
