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
    links TEXT NOT NULL DEFAULT '[]',
    avatar_cid TEXT,
    avatar_mime TEXT,
    icon_cid TEXT,
    icon_mime TEXT,
    icon_status TEXT,
    icon_reviewed_by TEXT,
    icon_reviewed_at INTEGER,
    icon_rejected_reason TEXT,
    takedown_status TEXT,
    takedown_reason TEXT,
    takedown_by TEXT,
    takedown_at INTEGER,
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
  /**
   * User reports against profiles. Anonymous reports carry a hashed IP
   * for dedup + rate-limit; signed-in reports also record the
   * reporter's DID. Admin actions write `status`, `admin_notes`,
   * `resolved_at`, `resolved_by`.
   */
  `CREATE TABLE IF NOT EXISTS report (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_did TEXT NOT NULL,
    reporter_did TEXT,
    reporter_ip_hash TEXT,
    reason TEXT NOT NULL,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    admin_notes TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS report_status_target ON report(status, target_did)`,
  `CREATE INDEX IF NOT EXISTS report_dedup ON report(target_did, reporter_ip_hash, reason, created_at)`,
  /**
   * Hot-path index for excluding taken-down profiles from public reads.
   * The vast majority of rows have NULL `takedown_status`, so a partial
   * index would be ideal; SQLite supports `WHERE` on indexes only via
   * CREATE INDEX … WHERE, but the planner won't always pick it for
   * `IS NULL` predicates. Plain index covers both directions.
   */
  `CREATE INDEX IF NOT EXISTS profile_takedown ON profile(takedown_status)`,
];

/**
 * Additive migrations applied after the base schema. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so we attempt the ALTER and swallow the
 * "duplicate column" error. SQLite makes column drops painful, so legacy
 * columns we no longer use (e.g. the old single-value `category`, `tags`,
 * the pre-`links[]` `website`/`repo_url`/`open_source`, `bsky_client`)
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
        column: "categories",
        ddl:
          "ALTER TABLE profile ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'",
      },
      {
        table: "profile",
        column: "links",
        ddl: "ALTER TABLE profile ADD COLUMN links TEXT NOT NULL DEFAULT '[]'",
      },
      {
        table: "profile",
        column: "icon_cid",
        ddl: "ALTER TABLE profile ADD COLUMN icon_cid TEXT",
      },
      {
        table: "profile",
        column: "icon_mime",
        ddl: "ALTER TABLE profile ADD COLUMN icon_mime TEXT",
      },
      {
        table: "profile",
        column: "icon_status",
        ddl: "ALTER TABLE profile ADD COLUMN icon_status TEXT",
      },
      {
        table: "profile",
        column: "icon_reviewed_by",
        ddl: "ALTER TABLE profile ADD COLUMN icon_reviewed_by TEXT",
      },
      {
        table: "profile",
        column: "icon_reviewed_at",
        ddl: "ALTER TABLE profile ADD COLUMN icon_reviewed_at INTEGER",
      },
      {
        table: "profile",
        column: "icon_rejected_reason",
        ddl: "ALTER TABLE profile ADD COLUMN icon_rejected_reason TEXT",
      },
      {
        table: "profile",
        column: "takedown_status",
        ddl: "ALTER TABLE profile ADD COLUMN takedown_status TEXT",
      },
      {
        table: "profile",
        column: "takedown_reason",
        ddl: "ALTER TABLE profile ADD COLUMN takedown_reason TEXT",
      },
      {
        table: "profile",
        column: "takedown_by",
        ddl: "ALTER TABLE profile ADD COLUMN takedown_by TEXT",
      },
      {
        table: "profile",
        column: "takedown_at",
        ddl: "ALTER TABLE profile ADD COLUMN takedown_at INTEGER",
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
