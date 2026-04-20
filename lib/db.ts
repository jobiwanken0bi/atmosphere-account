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
 */
import { type Client, createClient } from "@libsql/client";

let _client: Client | null = null;
let _migrated = false;
let _migrationPromise: Promise<void> | null = null;

function getEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

export function db(): Client {
  if (_client) return _client;
  const url = getEnv("TURSO_DATABASE_URL") ?? "file:./local.db";
  const authToken = getEnv("TURSO_AUTH_TOKEN");
  _client = createClient({ url, authToken });
  return _client;
}

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS profile (
    did TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategories TEXT NOT NULL DEFAULT '[]',
    website TEXT,
    support_url TEXT,
    bsky_handle TEXT,
    atmosphere_handle TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    avatar_cid TEXT,
    avatar_mime TEXT,
    pds_url TEXT NOT NULL,
    record_cid TEXT NOT NULL,
    record_rev TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS profile_category ON profile(category)`,
  `CREATE INDEX IF NOT EXISTS profile_handle ON profile(handle)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS profile_fts USING fts5(
    name, description, tags, content='profile', content_rowid='rowid'
  )`,
  `CREATE TRIGGER IF NOT EXISTS profile_ai AFTER INSERT ON profile BEGIN
    INSERT INTO profile_fts(rowid, name, description, tags)
    VALUES (new.rowid, new.name, new.description, new.tags);
  END`,
  `CREATE TRIGGER IF NOT EXISTS profile_ad AFTER DELETE ON profile BEGIN
    INSERT INTO profile_fts(profile_fts, rowid, name, description, tags)
    VALUES('delete', old.rowid, old.name, old.description, old.tags);
  END`,
  `CREATE TRIGGER IF NOT EXISTS profile_au AFTER UPDATE ON profile BEGIN
    INSERT INTO profile_fts(profile_fts, rowid, name, description, tags)
    VALUES('delete', old.rowid, old.name, old.description, old.tags);
    INSERT INTO profile_fts(rowid, name, description, tags)
    VALUES (new.rowid, new.name, new.description, new.tags);
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

export function migrate(): Promise<void> {
  if (_migrated) return Promise.resolve();
  if (_migrationPromise) return _migrationPromise;
  _migrationPromise = (async () => {
    const c = db();
    for (const stmt of SCHEMA_STATEMENTS) {
      await c.execute(stmt);
    }
    _migrated = true;
  })();
  return _migrationPromise;
}

/** Convenience: ensure schema is in place before running a callback. */
export async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  await migrate();
  return fn(db());
}
