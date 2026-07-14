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
 * `@libsql/client/web` (HTTP only, no natives). Local `file:` URLs use the
 * full client because the web client cannot open local files.
 */
import {
  createNeonExecuteClient,
  type DbExecuteClient,
  neonRuntimeDatabaseUrl,
} from "./neon.ts";
import {
  createPostgresExecuteClient,
  postgresDatabaseUrl,
} from "./postgres.ts";

export type DatabaseBackend = "turso" | "neon" | "postgres";

export type DbClient = DbExecuteClient;

interface DbRuntimeState {
  client: DbClient | null;
  clientPromise: Promise<DbClient> | null;
  migrated: boolean;
  migrationPromise: Promise<void> | null;
  backend: DatabaseBackend | null;
}

const dbRuntimeState = ((globalThis as typeof globalThis & {
  __ATMOSPHERE_DB_RUNTIME_STATE__?: DbRuntimeState;
}).__ATMOSPHERE_DB_RUNTIME_STATE__ ??= {
  client: null,
  clientPromise: null,
  migrated: false,
  migrationPromise: null,
  backend: null,
});

function getEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

export function dbBackend(): DatabaseBackend {
  const raw = getEnv("ATMOSPHERE_DB_BACKEND")?.trim().toLowerCase();
  if (!raw) {
    return getEnv("POSTGRES_DATABASE_URL") || getEnv("DATABASE_URL") ||
        getEnv("POSTGRES_URL")
      ? "postgres"
      : getEnv("NEON_DATABASE_URL") || getEnv("NEON_DIRECT_DATABASE_URL")
      ? "neon"
      : "turso";
  }
  if (raw === "turso" || raw === "libsql" || raw === "sqlite") {
    return "turso";
  }
  if (raw === "neon") {
    return "neon";
  }
  if (raw === "postgres" || raw === "postgresql") return "postgres";
  throw new Error(
    `Unsupported ATMOSPHERE_DB_BACKEND=${raw}. Expected "turso", "neon", or "postgres".`,
  );
}

export function isPostgresBackend(): boolean {
  const backend = dbBackend();
  return backend === "neon" || backend === "postgres";
}

/** Hosted runtimes must have an explicit Turso URL. Falling back to a
 * local file database is useful for `deno task dev`, but on Deno Deploy
 * it masks configuration mistakes as an empty registry and broken OAuth
 * because the web libSQL client can't actually open `file:./local.db`. */
function isHostedRuntime(): boolean {
  return !!(getEnv("DENO_DEPLOYMENT_ID") ??
    getEnv("DENO_REGION") ??
    getEnv("VERCEL") ??
    getEnv("FLY_APP_NAME") ??
    getEnv("RAILWAY_PROJECT_ID") ??
    getEnv("RAILWAY_ENVIRONMENT_ID") ??
    getEnv("RENDER") ??
    getEnv("NETLIFY") ??
    getEnv("K_SERVICE"));
}

function resolveDbUrl(): string {
  const url = getEnv("TURSO_DATABASE_URL");
  if (url) return url;
  if (isHostedRuntime()) {
    throw new Error(
      "No hosted database URL is configured. Production should normally set ATMOSPHERE_DB_BACKEND=postgres with POSTGRES_DATABASE_URL/DATABASE_URL. Turso deployments must set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.",
    );
  }
  return "file:./local.db";
}

function shouldLoadNativeFileClient(url: string): boolean {
  return url.startsWith("file:");
}

function shouldRunRequestMigrations(): boolean {
  if (dbBackend() === "neon" || dbBackend() === "postgres") return false;
  const setting = getEnv("ATMOSPHERE_REQUEST_MIGRATIONS");
  if (setting) return /^(1|true|yes)$/i.test(setting);
  return shouldLoadNativeFileClient(resolveDbUrl());
}

function getClient(): Promise<DbClient> {
  const backend = dbBackend();
  if (dbRuntimeState.backend && dbRuntimeState.backend !== backend) {
    dbRuntimeState.client = null;
    dbRuntimeState.clientPromise = null;
    dbRuntimeState.migrated = false;
    dbRuntimeState.migrationPromise = null;
  }
  dbRuntimeState.backend = backend;
  if (dbRuntimeState.client) return Promise.resolve(dbRuntimeState.client);
  if (!dbRuntimeState.clientPromise) {
    dbRuntimeState.clientPromise = (async () => {
      if (backend === "neon") {
        dbRuntimeState.client = createNeonExecuteClient(
          neonRuntimeDatabaseUrl(),
        );
        return dbRuntimeState.client;
      }
      if (backend === "postgres") {
        dbRuntimeState.client = createPostgresExecuteClient(
          postgresDatabaseUrl(),
        );
        return dbRuntimeState.client;
      }
      const url = resolveDbUrl();
      const authToken = getEnv("TURSO_AUTH_TOKEN");
      if (/^(libsql|https?):\/\//.test(url) && !authToken) {
        throw new Error(
          "TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL points at a remote Turso database.",
        );
      }
      if (shouldLoadNativeFileClient(url)) {
        const { createClient } = await import("@libsql/client");
        dbRuntimeState.client = createClient({
          url,
          authToken,
        }) as unknown as DbClient;
        return dbRuntimeState.client;
      }
      const { createClient } = await import("@libsql/client/web");
      dbRuntimeState.client = createClient({
        url,
        authToken,
      }) as unknown as DbClient;
      return dbRuntimeState.client;
    })();
  }
  return dbRuntimeState.clientPromise;
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
    lexicons_json TEXT NOT NULL DEFAULT '{}',
    account_indicators_json TEXT NOT NULL DEFAULT '[]',
    screenshots TEXT NOT NULL DEFAULT '[]',
    avatar_cid TEXT,
    avatar_mime TEXT,
    banner_cid TEXT,
    banner_mime TEXT,
    og_jpeg BLOB,
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
    website_url TEXT,
    website_visible INTEGER NOT NULL DEFAULT 0,
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
  /**
   * Account hosts are services that hold Atmosphere accounts. Seeded rows
   * describe known umbrella hosts (for example Bluesky); observed rows are
   * discovered from signed-in account PDS endpoints and can be claimed later.
   */
  `CREATE TABLE IF NOT EXISTS account_host (
    host TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    data_location TEXT,
    inferred_location TEXT,
    inferred_location_source TEXT,
    inferred_location_checked_at INTEGER,
    inferred_location_evidence_json TEXT,
    homepage_url TEXT,
    signup_url TEXT,
    service_endpoint TEXT,
    account_management_url TEXT,
    dashboard_url TEXT,
    capability_manifest_url TEXT,
    capabilities_json TEXT,
    support_url TEXT,
    profile_handle TEXT,
    profile_did TEXT,
    bsky_profile_visible INTEGER NOT NULL DEFAULT 1,
    avatar_url TEXT,
    claim_handle TEXT,
    claim_did TEXT,
    signup_status TEXT NOT NULL DEFAULT 'unknown',
    verification_status TEXT NOT NULL DEFAULT 'observed',
    source TEXT NOT NULL DEFAULT 'observed',
    match_patterns TEXT NOT NULL DEFAULT '[]',
    service_record_uri TEXT,
    service_record_cid TEXT,
    service_observed_at INTEGER,
    public_intent_status TEXT NOT NULL DEFAULT 'unknown',
    public_intent_source TEXT,
    public_intent_checked_at INTEGER,
    public_intent_attempted_at INTEGER,
    public_intent_evidence_json TEXT,
    profile_checked_at INTEGER,
    observed_account_count INTEGER NOT NULL DEFAULT 0,
    observed_active_account_count INTEGER NOT NULL DEFAULT 0,
    last_active_at INTEGER,
    last_indexed_account_at INTEGER,
    last_checked_at INTEGER,
    last_observed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS account_host_claim (
    host TEXT PRIMARY KEY,
    claimant_did TEXT NOT NULL,
    claimant_handle TEXT NOT NULL,
    method TEXT NOT NULL,
    claimed_at INTEGER NOT NULL,
    verified_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS host_conformance (
    host TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    manifest_url TEXT,
    account_url TEXT,
    service_endpoint TEXT,
    report_json TEXT NOT NULL,
    checked_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(host) REFERENCES account_host(host) ON DELETE CASCADE
  )`,
  /**
   * Source records from account.atmosphere.host.* lexicons. The public
   * `account_host` table is the merged read model; these rows preserve the
   * protocol record that produced or enriched the host listing.
   */
  `CREATE TABLE IF NOT EXISTS host_record (
    uri TEXT PRIMARY KEY,
    cid TEXT,
    collection TEXT NOT NULL,
    repo_did TEXT NOT NULL,
    rkey TEXT NOT NULL,
    author_handle TEXT,
    raw_json TEXT NOT NULL,
    parsed_json TEXT NOT NULL,
    host TEXT,
    display_name TEXT,
    service_endpoint TEXT,
    indexed_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  /**
   * Cheap relay-level PDS inventory. This stores one row per PDS instance and
   * uses the relay's aggregate account count, so a full network refresh takes
   * a handful of listHosts requests and small batched DB upserts instead of
   * walking the complete PLC history.
   */
  `CREATE TABLE IF NOT EXISTS pds_instance (
    service_host TEXT PRIMARY KEY,
    service_endpoint TEXT NOT NULL,
    account_host TEXT NOT NULL,
    relay_url TEXT NOT NULL,
    relay_status TEXT NOT NULL,
    relay_account_count INTEGER NOT NULL DEFAULT 0,
    relay_seq INTEGER,
    is_bluesky_host INTEGER NOT NULL DEFAULT 0,
    first_observed_at INTEGER NOT NULL,
    last_observed_at INTEGER NOT NULL,
    last_active_at INTEGER,
    last_scan_id TEXT NOT NULL
  )`,
  /**
   * Append-only relay status transitions. This records the initial status and
   * subsequent changes without writing a duplicate history row on every scan.
   */
  `CREATE TABLE IF NOT EXISTS pds_instance_status_history (
    transition_id TEXT PRIMARY KEY,
    service_host TEXT NOT NULL,
    account_host TEXT NOT NULL,
    relay_url TEXT NOT NULL,
    relay_status TEXT NOT NULL,
    relay_account_count INTEGER,
    relay_seq INTEGER,
    observed_at INTEGER NOT NULL,
    scan_id TEXT NOT NULL
  )`,
  /**
   * One row per relay inventory attempt. `pds_instance.last_observed_at`
   * cannot prove that a scan reached the final page, so production freshness
   * monitoring keys off successful, complete attempts recorded here.
   */
  `CREATE TABLE IF NOT EXISTS pds_inventory_scan (
    scan_id TEXT PRIMARY KEY,
    relay_url TEXT NOT NULL,
    status TEXT NOT NULL,
    complete INTEGER NOT NULL DEFAULT 0,
    pages INTEGER,
    instance_count INTEGER,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    error TEXT
  )`,
  `DROP TABLE IF EXISTS pds_discovery_cursor`,
  `DROP TABLE IF EXISTS pds_host_account`,
  /**
   * Source records from app-directory lexicons. These rows preserve the
   * original AT Protocol record and a parsed projection so the public app
   * directory can be recomputed when merge rules change.
   */
  `CREATE TABLE IF NOT EXISTS app_record (
    uri TEXT PRIMARY KEY,
    cid TEXT NOT NULL,
    collection TEXT NOT NULL,
    source_type TEXT NOT NULL,
    repo_did TEXT NOT NULL,
    rkey TEXT NOT NULL,
    listing_id TEXT,
    raw_json TEXT NOT NULL,
    parsed_json TEXT NOT NULL,
    record_created_at INTEGER,
    record_updated_at INTEGER,
    indexed_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS app_listing (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tagline TEXT NOT NULL DEFAULT '',
    app_status TEXT,
    primary_url TEXT,
    icon_url TEXT,
    hero_url TEXT,
    hero_fallback_url TEXT,
    screenshot_urls TEXT NOT NULL DEFAULT '[]',
    links_json TEXT NOT NULL DEFAULT '[]',
    tags_json TEXT NOT NULL DEFAULT '[]',
    platforms_json TEXT NOT NULL DEFAULT '[]',
    category_slugs_json TEXT NOT NULL DEFAULT '[]',
    lexicons_json TEXT NOT NULL DEFAULT '{}',
    account_indicators_json TEXT NOT NULL DEFAULT '[]',
    source_refs_json TEXT NOT NULL DEFAULT '{}',
    canonical_source TEXT NOT NULL,
    canonical_uri TEXT NOT NULL,
    product_did TEXT,
    profile_did TEXT,
    legacy_profile_did TEXT,
    atstore_listing_uri TEXT,
    community_profile_uri TEXT,
    community_entry_uri TEXT,
    review_count INTEGER NOT NULL DEFAULT 0,
    average_rating REAL,
    favorite_count INTEGER NOT NULL DEFAULT 0,
    mention_count_24h INTEGER NOT NULL DEFAULT 0,
    mention_count_7d INTEGER NOT NULL DEFAULT 0,
    trending_score REAL,
    published_at INTEGER,
    updated_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS app_alias (
    alias_key TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    source_uri TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_review (
    uri TEXT PRIMARY KEY,
    listing_uri TEXT NOT NULL,
    listing_id TEXT,
    author_did TEXT NOT NULL,
    rkey TEXT NOT NULL,
    cid TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    body TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS app_favorite (
    uri TEXT PRIMARY KEY,
    listing_uri TEXT NOT NULL,
    listing_id TEXT,
    author_did TEXT NOT NULL,
    rkey TEXT NOT NULL,
    cid TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS app_mention (
    id TEXT PRIMARY KEY,
    listing_uri TEXT NOT NULL,
    listing_id TEXT,
    post_uri TEXT NOT NULL,
    post_cid TEXT,
    author_did TEXT NOT NULL,
    author_handle TEXT,
    post_text TEXT,
    post_created_at INTEGER NOT NULL,
    match_type TEXT NOT NULL,
    match_confidence REAL NOT NULL DEFAULT 1,
    match_evidence_json TEXT,
    indexed_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS app_record_failure (
    uri TEXT PRIMARY KEY,
    collection TEXT NOT NULL,
    source_type TEXT NOT NULL,
    repo_did TEXT NOT NULL,
    rkey TEXT NOT NULL,
    reason TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS app_directory_job (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    updated_at INTEGER NOT NULL,
    progress_label TEXT,
    listings_imported INTEGER NOT NULL DEFAULT 0,
    reviews_imported INTEGER NOT NULL DEFAULT 0,
    favorites_imported INTEGER NOT NULL DEFAULT 0,
    records_seen INTEGER NOT NULL DEFAULT 0,
    records_failed INTEGER NOT NULL DEFAULT 0,
    rescored INTEGER NOT NULL DEFAULT 0,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS app_featured (
    listing_id TEXT PRIMARY KEY,
    position INTEGER NOT NULL DEFAULT 0,
    label TEXT,
    added_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_moderation (
    listing_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'visible',
    reason TEXT,
    updated_at INTEGER NOT NULL,
    updated_by TEXT
  )`,
  /**
   * Off-protocol Atmosphere Login control-plane tables. They currently share
   * Railway Postgres with the appview read model, but they are not indexed
   * AT Protocol records and should not be treated as rebuildable projection
   * data. Keep durable writes appview/Railway-owned; the Deno public shell
   * should proxy these routes rather than connect directly to Postgres.
   *
   * Apps can use the hosted account picker without becoming OAuth token
   * clients of Atmosphere; this table controls which return URLs and origins
   * are trusted for selection tokens.
   */
  `CREATE TABLE IF NOT EXISTS login_app (
    client_id TEXT PRIMARY KEY,
    app_name TEXT NOT NULL,
    app_uri TEXT,
    logo_uri TEXT,
    allowed_return_uris TEXT NOT NULL DEFAULT '[]',
    allowed_origins TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'unverified',
    contact_did TEXT,
    preferred_account_host TEXT,
    review_status TEXT NOT NULL DEFAULT 'none',
    review_requested_at INTEGER,
    review_notes TEXT,
    review_decision_at INTEGER,
    review_decision_by TEXT,
    review_decision_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  /**
   * Audit/read model for accounts selected through Atmosphere Login. This
   * is not proof that the destination app completed OAuth; it records that
   * the user chose this account for that app via the universal picker.
   */
  `CREATE TABLE IF NOT EXISTS login_app_connection (
    client_id TEXT NOT NULL,
    did TEXT NOT NULL,
    handle TEXT NOT NULL,
    selected_count INTEGER NOT NULL DEFAULT 1,
    first_selected_at INTEGER NOT NULL,
    last_selected_at INTEGER NOT NULL,
    PRIMARY KEY (client_id, did)
  )`,
  /**
   * Durable replay protection for Atmosphere Login selection tokens. Rows are
   * tiny and expire with the token, giving reference/relying app flows a
   * multi-instance-safe way to reject repeated `jti` values.
   */
  `CREATE TABLE IF NOT EXISTS login_selection_replay (
    jti TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_picker_intent (
    code_hash TEXT PRIMARY KEY,
    did TEXT NOT NULL,
    client_id TEXT NOT NULL,
    return_uri TEXT NOT NULL,
    state TEXT NOT NULL,
    scope TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
  )`,
  /**
   * Shared fixed-window rate-limit buckets for high-risk hosted login flows.
   * Bucket keys are salted hashes, not raw IP addresses. Low-risk read routes
   * can keep using the in-memory limiter.
   */
  `CREATE TABLE IF NOT EXISTS rate_limit_bucket (
    bucket_key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  /**
   * Coarse-grained operational leases. The Jetstream indexer is idempotent,
   * but running two long-lived consumers wastes relay/PDS/DB capacity and can
   * move the shared cursor in surprising ways during deploy overlap. A short
   * DB-backed lease gives us one active consumer without adding Redis.
   */
  `CREATE TABLE IF NOT EXISTS worker_lease (
    name TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
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
  `CREATE INDEX IF NOT EXISTS account_host_verification ON account_host(verification_status)`,
  `CREATE INDEX IF NOT EXISTS account_host_signup ON account_host(signup_status)`,
  `CREATE INDEX IF NOT EXISTS account_host_source ON account_host(source)`,
  `CREATE INDEX IF NOT EXISTS account_host_profile_did ON account_host(profile_did)`,
  `CREATE INDEX IF NOT EXISTS account_host_claim_claimant ON account_host_claim(claimant_did)`,
  `CREATE INDEX IF NOT EXISTS host_conformance_status ON host_conformance(status, expires_at)`,
  `CREATE INDEX IF NOT EXISTS host_record_host ON host_record(host, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS host_record_collection ON host_record(collection, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS host_record_repo_rkey ON host_record(repo_did, collection, rkey)`,
  `CREATE INDEX IF NOT EXISTS pds_instance_account_host ON pds_instance(account_host, relay_status)`,
  `CREATE INDEX IF NOT EXISTS pds_instance_status ON pds_instance(relay_status, last_observed_at)`,
  `CREATE INDEX IF NOT EXISTS pds_instance_bluesky ON pds_instance(is_bluesky_host, relay_status)`,
  `CREATE INDEX IF NOT EXISTS pds_instance_status_history_host ON pds_instance_status_history(service_host, observed_at)`,
  `CREATE INDEX IF NOT EXISTS pds_instance_status_history_status ON pds_instance_status_history(relay_status, observed_at)`,
  `CREATE INDEX IF NOT EXISTS pds_inventory_scan_freshness ON pds_inventory_scan(status, complete, completed_at)`,
  `CREATE INDEX IF NOT EXISTS app_record_collection ON app_record(collection, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS app_record_listing ON app_record(listing_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS app_record_repo_rkey ON app_record(repo_did, collection, rkey)`,
  `CREATE INDEX IF NOT EXISTS app_alias_listing ON app_alias(listing_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS app_listing_slug ON app_listing(slug)`,
  `CREATE INDEX IF NOT EXISTS app_listing_canonical ON app_listing(canonical_source, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS app_listing_atstore ON app_listing(atstore_listing_uri)`,
  `CREATE INDEX IF NOT EXISTS app_listing_legacy ON app_listing(legacy_profile_did)`,
  `CREATE INDEX IF NOT EXISTS app_listing_trending ON app_listing(trending_score, updated_at)`,
  `CREATE INDEX IF NOT EXISTS app_listing_public_trending ON app_listing(deleted_at, trending_score DESC, updated_at DESC, published_at DESC)`,
  `CREATE INDEX IF NOT EXISTS app_listing_public_newest ON app_listing(deleted_at, published_at DESC, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS app_listing_public_name ON app_listing(deleted_at, name COLLATE NOCASE)`,
  `CREATE INDEX IF NOT EXISTS app_review_listing ON app_review(listing_id, deleted_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS app_review_subject ON app_review(listing_uri, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS app_favorite_listing ON app_favorite(listing_id, deleted_at, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS app_mention_listing_post ON app_mention(listing_id, post_uri)`,
  `CREATE INDEX IF NOT EXISTS app_mention_listing ON app_mention(listing_id, deleted_at, post_created_at)`,
  `CREATE INDEX IF NOT EXISTS app_mention_subject ON app_mention(listing_uri, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS app_record_failure_seen ON app_record_failure(last_seen_at DESC)`,
  `CREATE INDEX IF NOT EXISTS app_record_failure_source ON app_record_failure(source_type, collection)`,
  `CREATE INDEX IF NOT EXISTS app_directory_job_status ON app_directory_job(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS app_directory_job_kind_created ON app_directory_job(kind, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS app_featured_position ON app_featured(position)`,
  `CREATE INDEX IF NOT EXISTS app_moderation_status ON app_moderation(status)`,
  `CREATE INDEX IF NOT EXISTS login_app_status ON login_app(status)`,
  `CREATE INDEX IF NOT EXISTS login_app_review_status ON login_app(review_status, review_requested_at)`,
  `CREATE INDEX IF NOT EXISTS login_app_contact_did ON login_app(contact_did, updated_at)`,
  `CREATE INDEX IF NOT EXISTS login_app_connection_did ON login_app_connection(did, last_selected_at)`,
  `CREATE INDEX IF NOT EXISTS login_selection_replay_expires ON login_selection_replay(expires_at)`,
  `CREATE INDEX IF NOT EXISTS login_picker_intent_expires ON login_picker_intent(expires_at)`,
  `CREATE INDEX IF NOT EXISTS rate_limit_bucket_reset ON rate_limit_bucket(reset_at)`,
  `CREATE INDEX IF NOT EXISTS oauth_state_expires ON oauth_state(expires_at)`,
  `CREATE INDEX IF NOT EXISTS oauth_session_expires ON oauth_session(expires_at)`,
  `CREATE INDEX IF NOT EXISTS app_session_expires ON app_session(expires_at)`,
  `CREATE INDEX IF NOT EXISTS worker_lease_expires ON worker_lease(expires_at)`,
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
        column: "lexicons_json",
        ddl:
          "ALTER TABLE profile ADD COLUMN lexicons_json TEXT NOT NULL DEFAULT '{}'",
      },
      {
        table: "profile",
        column: "account_indicators_json",
        ddl:
          "ALTER TABLE profile ADD COLUMN account_indicators_json TEXT NOT NULL DEFAULT '[]'",
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
        column: "og_jpeg",
        ddl: "ALTER TABLE profile ADD COLUMN og_jpeg BLOB",
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
      {
        table: "app_user",
        column: "website_url",
        ddl: "ALTER TABLE app_user ADD COLUMN website_url TEXT",
      },
      {
        table: "app_user",
        column: "website_visible",
        ddl:
          "ALTER TABLE app_user ADD COLUMN website_visible INTEGER NOT NULL DEFAULT 0",
      },
      {
        table: "account_host",
        column: "data_location",
        ddl: "ALTER TABLE account_host ADD COLUMN data_location TEXT",
      },
      {
        table: "account_host",
        column: "inferred_location",
        ddl: "ALTER TABLE account_host ADD COLUMN inferred_location TEXT",
      },
      {
        table: "account_host",
        column: "inferred_location_source",
        ddl:
          "ALTER TABLE account_host ADD COLUMN inferred_location_source TEXT",
      },
      {
        table: "account_host",
        column: "inferred_location_checked_at",
        ddl:
          "ALTER TABLE account_host ADD COLUMN inferred_location_checked_at INTEGER",
      },
      {
        table: "account_host",
        column: "inferred_location_evidence_json",
        ddl:
          "ALTER TABLE account_host ADD COLUMN inferred_location_evidence_json TEXT",
      },
      {
        table: "account_host",
        column: "signup_url",
        ddl: "ALTER TABLE account_host ADD COLUMN signup_url TEXT",
      },
      {
        table: "account_host",
        column: "service_endpoint",
        ddl: "ALTER TABLE account_host ADD COLUMN service_endpoint TEXT",
      },
      {
        table: "account_host",
        column: "account_management_url",
        ddl: "ALTER TABLE account_host ADD COLUMN account_management_url TEXT",
      },
      {
        table: "account_host",
        column: "dashboard_url",
        ddl: "ALTER TABLE account_host ADD COLUMN dashboard_url TEXT",
      },
      {
        table: "account_host",
        column: "capability_manifest_url",
        ddl: "ALTER TABLE account_host ADD COLUMN capability_manifest_url TEXT",
      },
      {
        table: "account_host",
        column: "capabilities_json",
        ddl: "ALTER TABLE account_host ADD COLUMN capabilities_json TEXT",
      },
      {
        table: "account_host",
        column: "support_url",
        ddl: "ALTER TABLE account_host ADD COLUMN support_url TEXT",
      },
      {
        table: "account_host",
        column: "profile_handle",
        ddl: "ALTER TABLE account_host ADD COLUMN profile_handle TEXT",
      },
      {
        table: "account_host",
        column: "profile_did",
        ddl: "ALTER TABLE account_host ADD COLUMN profile_did TEXT",
      },
      {
        table: "account_host",
        column: "bsky_profile_visible",
        ddl:
          "ALTER TABLE account_host ADD COLUMN bsky_profile_visible INTEGER NOT NULL DEFAULT 1",
      },
      {
        table: "account_host",
        column: "avatar_url",
        ddl: "ALTER TABLE account_host ADD COLUMN avatar_url TEXT",
      },
      {
        table: "account_host",
        column: "service_record_uri",
        ddl: "ALTER TABLE account_host ADD COLUMN service_record_uri TEXT",
      },
      {
        table: "account_host",
        column: "service_record_cid",
        ddl: "ALTER TABLE account_host ADD COLUMN service_record_cid TEXT",
      },
      {
        table: "account_host",
        column: "service_observed_at",
        ddl: "ALTER TABLE account_host ADD COLUMN service_observed_at INTEGER",
      },
      {
        table: "account_host",
        column: "public_intent_status",
        ddl:
          "ALTER TABLE account_host ADD COLUMN public_intent_status TEXT NOT NULL DEFAULT 'unknown'",
      },
      {
        table: "account_host",
        column: "public_intent_source",
        ddl: "ALTER TABLE account_host ADD COLUMN public_intent_source TEXT",
      },
      {
        table: "account_host",
        column: "public_intent_checked_at",
        ddl:
          "ALTER TABLE account_host ADD COLUMN public_intent_checked_at INTEGER",
      },
      {
        table: "account_host",
        column: "public_intent_attempted_at",
        ddl:
          "ALTER TABLE account_host ADD COLUMN public_intent_attempted_at INTEGER",
      },
      {
        table: "account_host",
        column: "public_intent_evidence_json",
        ddl:
          "ALTER TABLE account_host ADD COLUMN public_intent_evidence_json TEXT",
      },
      {
        table: "account_host",
        column: "profile_checked_at",
        ddl: "ALTER TABLE account_host ADD COLUMN profile_checked_at INTEGER",
      },
      {
        table: "account_host",
        column: "observed_account_count",
        ddl:
          "ALTER TABLE account_host ADD COLUMN observed_account_count INTEGER NOT NULL DEFAULT 0",
      },
      {
        table: "account_host",
        column: "observed_active_account_count",
        ddl:
          "ALTER TABLE account_host ADD COLUMN observed_active_account_count INTEGER NOT NULL DEFAULT 0",
      },
      {
        table: "account_host",
        column: "last_indexed_account_at",
        ddl:
          "ALTER TABLE account_host ADD COLUMN last_indexed_account_at INTEGER",
      },
      {
        table: "account_host",
        column: "last_active_at",
        ddl: "ALTER TABLE account_host ADD COLUMN last_active_at INTEGER",
      },
      {
        table: "pds_instance",
        column: "last_active_at",
        ddl: "ALTER TABLE pds_instance ADD COLUMN last_active_at INTEGER",
      },
      {
        table: "account_host",
        column: "claim_handle",
        ddl: "ALTER TABLE account_host ADD COLUMN claim_handle TEXT",
      },
      {
        table: "account_host",
        column: "claim_did",
        ddl: "ALTER TABLE account_host ADD COLUMN claim_did TEXT",
      },
      {
        table: "login_app",
        column: "preferred_account_host",
        ddl: "ALTER TABLE login_app ADD COLUMN preferred_account_host TEXT",
      },
      {
        table: "login_app",
        column: "review_status",
        ddl:
          "ALTER TABLE login_app ADD COLUMN review_status TEXT NOT NULL DEFAULT 'none'",
      },
      {
        table: "login_app",
        column: "review_requested_at",
        ddl: "ALTER TABLE login_app ADD COLUMN review_requested_at INTEGER",
      },
      {
        table: "login_app",
        column: "review_notes",
        ddl: "ALTER TABLE login_app ADD COLUMN review_notes TEXT",
      },
      {
        table: "login_app",
        column: "review_decision_at",
        ddl: "ALTER TABLE login_app ADD COLUMN review_decision_at INTEGER",
      },
      {
        table: "login_app",
        column: "review_decision_by",
        ddl: "ALTER TABLE login_app ADD COLUMN review_decision_by TEXT",
      },
      {
        table: "login_app",
        column: "review_decision_reason",
        ddl: "ALTER TABLE login_app ADD COLUMN review_decision_reason TEXT",
      },
      {
        table: "app_listing",
        column: "app_status",
        ddl: "ALTER TABLE app_listing ADD COLUMN app_status TEXT",
      },
      {
        table: "app_listing",
        column: "hero_fallback_url",
        ddl: "ALTER TABLE app_listing ADD COLUMN hero_fallback_url TEXT",
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
  if (dbBackend() === "neon" || dbBackend() === "postgres") {
    throw new Error(
      "SQLite request migrations cannot run against Postgres. Use `deno task db:migrate:postgres` before running with ATMOSPHERE_DB_BACKEND=postgres.",
    );
  }
  if (dbRuntimeState.migrated) return Promise.resolve();
  if (dbRuntimeState.migrationPromise) return dbRuntimeState.migrationPromise;
  dbRuntimeState.migrationPromise = (async () => {
    const c = await getClient();
    for (const stmt of SCHEMA_STATEMENTS) {
      await c.execute(stmt);
    }
    await applyAdditiveMigrations(c);
    for (const stmt of POST_MIGRATION_INDEX_STATEMENTS) {
      await c.execute(stmt);
    }
    dbRuntimeState.migrated = true;
  })();
  return dbRuntimeState.migrationPromise;
}

/** Convenience: ensure schema is in place before running a callback. */
export async function withDb<T>(fn: (c: DbClient) => Promise<T>): Promise<T> {
  if (shouldRunRequestMigrations()) {
    await migrate();
  }
  const c = await getClient();
  return fn(c);
}

export async function checkDbHealth(): Promise<
  {
    ok: true;
    latencyMs: number;
    databaseKind: "file" | "remote" | "neon" | "postgres";
    backend: DatabaseBackend;
  }
> {
  const started = performance.now();
  await withDb(async (c) => {
    await c.execute("SELECT 1 AS ok");
  });
  return {
    ok: true,
    latencyMs: Math.max(0, Math.round(performance.now() - started)),
    databaseKind: dbBackend() === "neon"
      ? "neon"
      : dbBackend() === "postgres"
      ? "postgres"
      : resolveDbUrl().startsWith("file:")
      ? "file"
      : "remote",
    backend: dbBackend(),
  };
}
