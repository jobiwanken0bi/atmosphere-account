/**
 * Turso (libSQL) client + lazy schema migration. Single shared client per
 * runtime; safe to import from any route.
 *
 * Reads:
 *   - TURSO_DATABASE_URL    (e.g. libsql://atmosphere-registry-xyz.turso.io
 *                            or file:./dev.db for local development)
 *   - TURSO_AUTH_TOKEN      (required for remote, ignored for file:)
 *
 * If TURSO_DATABASE_URL is unset the client falls back to file:./local.db
 * so `deno task dev` works without configuration.
 *
 * **Deploy note:** The default `@libsql/client` entry pulls native bindings
 * (`@libsql/linux-x64-gnu`, etc.) that break on Linux/serverless when the
 * bundle was resolved for another OS. Remote Turso URLs use
 * `@libsql/client/web` (HTTP only, no natives). Local `file:` URLs still
 * use the full client in dev only.
 */
import type { Client } from "@libsql/client/web";

let _client: Client | null = null;
let _clientPromise: Promise<Client> | null = null;
let _migrated = false;
let _migrationPromise: Promise<void> | null = null;

function getEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

function resolveDbUrl(): string {
  return getEnv("TURSO_DATABASE_URL") ?? "file:./local.db";
}

/**
 * Production / `deno task start` must not load the native libsql binary; only
 * the web client. Vite sets import.meta.env.DEV in dev; omitting env is
 * treated as production (Deploy).
 */
function shouldLoadNativeFileClient(url: string): boolean {
  if (!url.startsWith("file:")) return false;
  return import.meta.env?.DEV === true;
}

function getClient(): Promise<Client> {
  if (_client) return Promise.resolve(_client);
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const url = resolveDbUrl();
      const authToken = getEnv("TURSO_AUTH_TOKEN");
      if (shouldLoadNativeFileClient(url)) {
        const { createClient } = await import("@libsql/client");
        _client = createClient({ url, authToken }) as unknown as Client;
        return _client;
      }
      const { createClient } = await import("@libsql/client/web");
      _client = createClient({ url, authToken });
      return _client;
    })();
  }
  return _clientPromise;
}

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS profile (
    did TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    categories TEXT NOT NULL DEFAULT '[]',
    subcategories TEXT NOT NULL DEFAULT '[]',
    website TEXT,
    repo_url TEXT,
    open_source INTEGER NOT NULL DEFAULT 0,
    bsky_client TEXT,
    avatar_cid TEXT,
    avatar_mime TEXT,
    pds_url TEXT NOT NULL,
    record_cid TEXT NOT NULL,
    record_rev TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS profile_handle ON profile(handle)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS profile_fts USING fts5(
    name, description, content='profile', content_rowid='rowid'
  )`,
  `CREATE TRIGGER IF NOT EXISTS profile_ai AFTER INSERT ON profile BEGIN
    INSERT INTO profile_fts(rowid, name, description)
    VALUES (new.rowid, new.name, new.description);
  END`,
  `CREATE TRIGGER IF NOT EXISTS profile_ad AFTER DELETE ON profile BEGIN
    INSERT INTO profile_fts(profile_fts, rowid, name, description)
    VALUES('delete', old.rowid, old.name, old.description);
  END`,
  `CREATE TRIGGER IF NOT EXISTS profile_au AFTER UPDATE ON profile BEGIN
    INSERT INTO profile_fts(profile_fts, rowid, name, description)
    VALUES('delete', old.rowid, old.name, old.description);
    INSERT INTO profile_fts(rowid, name, description)
    VALUES (new.rowid, new.name, new.description);
  END`,
  `CREATE TABLE IF NOT EXISTS featured (
    did TEXT PRIMARY KEY,
    badges TEXT NOT NULL DEFAULT '[]',
    position INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS jetstream_cursor (
    id INTEGER PRIMARY KEY CHECK(id=1),
    cursor INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_session (
    did TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_key (
    kid TEXT PRIMARY KEY,
    jwk TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_session (
    id TEXT PRIMARY KEY,
    did TEXT NOT NULL,
    handle TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
];

/**
 * Additive migrations applied after the base schema. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so we attempt the ALTER and swallow the
 * "duplicate column" error. SQLite makes column drops painful, so legacy
 * columns we no longer use (e.g. the old single-value `category`, `tags`)
 * are just left around and ignored — running `scripts/wipe-registry.ts`
 * recreates the table cleanly when desired.
 */
async function applyAdditiveMigrations(
  c: { execute: (s: string) => Promise<unknown> },
): Promise<void> {
  const additiveColumns: Array<{ table: string; column: string; ddl: string }> =
    [
      {
        table: "profile",
        column: "bsky_client",
        ddl: "ALTER TABLE profile ADD COLUMN bsky_client TEXT",
      },
      {
        table: "profile",
        column: "categories",
        ddl:
          "ALTER TABLE profile ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'",
      },
      {
        table: "profile",
        column: "repo_url",
        ddl: "ALTER TABLE profile ADD COLUMN repo_url TEXT",
      },
      {
        table: "profile",
        column: "open_source",
        ddl:
          "ALTER TABLE profile ADD COLUMN open_source INTEGER NOT NULL DEFAULT 0",
      },
    ];
  for (const m of additiveColumns) {
    try {
      await c.execute(m.ddl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate column|already exists/i.test(msg)) continue;
      console.warn(
        `[db] additive migration failed (${m.table}.${m.column}):`,
        msg,
      );
    }
  }
}

export function migrate(): Promise<void> {
  if (_migrated) return Promise.resolve();
  if (_migrationPromise) return _migrationPromise;
  _migrationPromise = (async () => {
    const c = await getClient();
    for (const stmt of SCHEMA_STATEMENTS) {
      await c.execute(stmt);
    }
    await applyAdditiveMigrations(c);
    _migrated = true;
  })();
  return _migrationPromise;
}

/** Convenience: ensure schema is in place before running a callback. */
export async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  await migrate();
  const c = await getClient();
  return fn(c);
}
