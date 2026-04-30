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

/** Hosted runtimes must have an explicit Turso URL. Falling back to a
 * local file database is useful for `deno task dev`, but on Deno Deploy
 * it masks configuration mistakes as an empty registry and broken OAuth
 * because the web libSQL client can't actually open `file:./local.db`. */
function isHostedRuntime(): boolean {
  return !!(getEnv("DENO_DEPLOYMENT_ID") ??
    getEnv("DENO_REGION") ??
    getEnv("VERCEL"));
}

function resolveDbUrl(): string {
  const url = getEnv("TURSO_DATABASE_URL");
  if (url) return url;
  if (isHostedRuntime()) {
    throw new Error(
      "TURSO_DATABASE_URL is required in hosted deployments. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to the registry database credentials.",
    );
  }
  return "file:./local.db";
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
      if (/^(libsql|https?):\/\//.test(url) && !authToken) {
        throw new Error(
          "TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL points at a remote Turso database.",
        );
      }
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
    profile_type TEXT NOT NULL DEFAULT 'project',
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    main_link TEXT,
    ios_link TEXT,
    android_link TEXT,
    categories TEXT NOT NULL DEFAULT '[]',
    subcategories TEXT NOT NULL DEFAULT '[]',
    links TEXT NOT NULL DEFAULT '[]',
    screenshots TEXT NOT NULL DEFAULT '[]',
    avatar_cid TEXT,
    avatar_mime TEXT,
    banner_cid TEXT,
    banner_mime TEXT,
    icon_cid TEXT,
    icon_mime TEXT,
    icon_status TEXT,
    icon_reviewed_by TEXT,
    icon_reviewed_at INTEGER,
    icon_rejected_reason TEXT,
    icon_bw_cid TEXT,
    icon_bw_mime TEXT,
    icon_bw_status TEXT,
    icon_bw_reviewed_by TEXT,
    icon_bw_reviewed_at INTEGER,
    icon_bw_rejected_reason TEXT,
    icon_access_status TEXT,
    icon_access_email TEXT,
    icon_access_requested_at INTEGER,
    icon_access_reviewed_at INTEGER,
    icon_access_reviewed_by TEXT,
    icon_access_denied_reason TEXT,
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
   * App-level account type. OAuth identities can use the registry as
   * plain users (reviews only) or as projects (can publish registry
   * profiles). This is separate from the public `profile` table so
   * regular users never need to create a registry profile.
   */
  `CREATE TABLE IF NOT EXISTS app_user (
    did TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    display_name TEXT,
    bio TEXT,
    avatar_cid TEXT,
    avatar_mime TEXT,
    bsky_client_id TEXT NOT NULL DEFAULT 'bluesky',
    bsky_button_visible INTEGER NOT NULL DEFAULT 1,
    account_type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS app_user_handle ON app_user(handle)`,
  `CREATE INDEX IF NOT EXISTS app_user_account_type ON app_user(account_type)`,
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
   * Signed-in user reviews for registry profiles. Reviews are AppView-owned
   * moderation data, not ATProto records: this keeps aggregates and admin
   * actions local to the Explore surface.
   */
  `CREATE TABLE IF NOT EXISTS review (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_did TEXT NOT NULL,
    reviewer_did TEXT NOT NULL,
    review_uri TEXT,
    review_cid TEXT,
    review_rkey TEXT,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'visible',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    hidden_at INTEGER,
    hidden_by TEXT,
    removed_at INTEGER,
    removed_by TEXT,
    admin_notes TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS review_target_reviewer ON review(target_did, reviewer_did)`,
  `CREATE INDEX IF NOT EXISTS review_target_status_rating ON review(target_did, status, rating)`,
  `CREATE INDEX IF NOT EXISTS review_target_status_created ON review(target_did, status, created_at)`,
  /**
   * Reports against individual reviews. Kept separate from profile reports
   * because moderation targets and action surfaces differ.
   */
  `CREATE TABLE IF NOT EXISTS review_report (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER NOT NULL,
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
  `CREATE INDEX IF NOT EXISTS review_report_status_review ON review_report(status, review_id)`,
  `CREATE INDEX IF NOT EXISTS review_report_dedup ON review_report(review_id, reporter_ip_hash, reason, created_at)`,
  /**
   * Optional developer response for App Store-style owner replies. One
   * response per review; hidden/removed parent reviews are not served publicly.
   */
  `CREATE TABLE IF NOT EXISTS review_response (
    review_id INTEGER PRIMARY KEY,
    responder_did TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  /**
   * Project-owned update history ("What's New"). Records live on the
   * project account's PDS and this table is the local AppView projection.
   */
  `CREATE TABLE IF NOT EXISTS profile_update (
    uri TEXT PRIMARY KEY,
    cid TEXT NOT NULL,
    rkey TEXT NOT NULL,
    project_did TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    version TEXT,
    tangled_commit_url TEXT,
    tangled_repo_url TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'visible',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL
  )`,
];

/**
 * Indexes that depend on additively-migrated columns. Created AFTER
 * `applyAdditiveMigrations` so existing databases that pre-date the
 * column have a chance to gain it before the index references it.
 */
const POST_MIGRATION_INDEX_STATEMENTS: string[] = [
  /**
   * Hot-path index for excluding taken-down profiles from public reads.
   * The vast majority of rows have NULL `takedown_status`, so a partial
   * index would be ideal; SQLite supports `WHERE` on indexes only via
   * CREATE INDEX … WHERE, but the planner won't always pick it for
   * `IS NULL` predicates. Plain index covers both directions.
   */
  `CREATE INDEX IF NOT EXISTS profile_takedown ON profile(takedown_status)`,
  /**
   * Hot-path index for the admin "Icon access requests" queue. Only a
   * handful of rows are non-NULL at any time so the index stays cheap.
   */
  `CREATE INDEX IF NOT EXISTS profile_icon_access ON profile(icon_access_status)`,
  `CREATE INDEX IF NOT EXISTS profile_type_takedown ON profile(profile_type, takedown_status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS review_uri_unique ON review(review_uri) WHERE review_uri IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS profile_update_project_status_created ON profile_update(project_did, status, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS profile_update_project_rkey ON profile_update(project_did, rkey)`,
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
        column: "profile_type",
        ddl:
          "ALTER TABLE profile ADD COLUMN profile_type TEXT NOT NULL DEFAULT 'project'",
      },
      {
        table: "profile",
        column: "categories",
        ddl:
          "ALTER TABLE profile ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'",
      },
      {
        table: "profile",
        column: "main_link",
        ddl: "ALTER TABLE profile ADD COLUMN main_link TEXT",
      },
      {
        table: "profile",
        column: "ios_link",
        ddl: "ALTER TABLE profile ADD COLUMN ios_link TEXT",
      },
      {
        table: "profile",
        column: "android_link",
        ddl: "ALTER TABLE profile ADD COLUMN android_link TEXT",
      },
      {
        table: "profile",
        column: "links",
        ddl: "ALTER TABLE profile ADD COLUMN links TEXT NOT NULL DEFAULT '[]'",
      },
      {
        table: "profile",
        column: "screenshots",
        ddl:
          "ALTER TABLE profile ADD COLUMN screenshots TEXT NOT NULL DEFAULT '[]'",
      },
      {
        table: "profile",
        column: "banner_cid",
        ddl: "ALTER TABLE profile ADD COLUMN banner_cid TEXT",
      },
      {
        table: "profile",
        column: "banner_mime",
        ddl: "ALTER TABLE profile ADD COLUMN banner_mime TEXT",
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
        column: "icon_bw_cid",
        ddl: "ALTER TABLE profile ADD COLUMN icon_bw_cid TEXT",
      },
      {
        table: "profile",
        column: "icon_bw_mime",
        ddl: "ALTER TABLE profile ADD COLUMN icon_bw_mime TEXT",
      },
      {
        table: "profile",
        column: "icon_bw_status",
        ddl: "ALTER TABLE profile ADD COLUMN icon_bw_status TEXT",
      },
      {
        table: "profile",
        column: "icon_bw_reviewed_by",
        ddl: "ALTER TABLE profile ADD COLUMN icon_bw_reviewed_by TEXT",
      },
      {
        table: "profile",
        column: "icon_bw_reviewed_at",
        ddl: "ALTER TABLE profile ADD COLUMN icon_bw_reviewed_at INTEGER",
      },
      {
        table: "profile",
        column: "icon_bw_rejected_reason",
        ddl: "ALTER TABLE profile ADD COLUMN icon_bw_rejected_reason TEXT",
      },
      {
        table: "profile",
        column: "icon_access_status",
        ddl: "ALTER TABLE profile ADD COLUMN icon_access_status TEXT",
      },
      {
        table: "profile",
        column: "icon_access_email",
        ddl: "ALTER TABLE profile ADD COLUMN icon_access_email TEXT",
      },
      {
        table: "profile",
        column: "icon_access_requested_at",
        ddl: "ALTER TABLE profile ADD COLUMN icon_access_requested_at INTEGER",
      },
      {
        table: "profile",
        column: "icon_access_reviewed_at",
        ddl: "ALTER TABLE profile ADD COLUMN icon_access_reviewed_at INTEGER",
      },
      {
        table: "profile",
        column: "icon_access_reviewed_by",
        ddl: "ALTER TABLE profile ADD COLUMN icon_access_reviewed_by TEXT",
      },
      {
        table: "profile",
        column: "icon_access_denied_reason",
        ddl: "ALTER TABLE profile ADD COLUMN icon_access_denied_reason TEXT",
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
      {
        table: "review",
        column: "review_uri",
        ddl: "ALTER TABLE review ADD COLUMN review_uri TEXT",
      },
      {
        table: "review",
        column: "review_cid",
        ddl: "ALTER TABLE review ADD COLUMN review_cid TEXT",
      },
      {
        table: "review",
        column: "review_rkey",
        ddl: "ALTER TABLE review ADD COLUMN review_rkey TEXT",
      },
      {
        table: "app_user",
        column: "display_name",
        ddl: "ALTER TABLE app_user ADD COLUMN display_name TEXT",
      },
      {
        table: "app_user",
        column: "bio",
        ddl: "ALTER TABLE app_user ADD COLUMN bio TEXT",
      },
      {
        table: "app_user",
        column: "avatar_cid",
        ddl: "ALTER TABLE app_user ADD COLUMN avatar_cid TEXT",
      },
      {
        table: "app_user",
        column: "avatar_mime",
        ddl: "ALTER TABLE app_user ADD COLUMN avatar_mime TEXT",
      },
      {
        table: "app_user",
        column: "bsky_client_id",
        ddl:
          "ALTER TABLE app_user ADD COLUMN bsky_client_id TEXT NOT NULL DEFAULT 'bluesky'",
      },
      {
        table: "app_user",
        column: "bsky_button_visible",
        ddl:
          "ALTER TABLE app_user ADD COLUMN bsky_button_visible INTEGER NOT NULL DEFAULT 1",
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
    for (const stmt of POST_MIGRATION_INDEX_STATEMENTS) {
      await c.execute(stmt);
    }
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
