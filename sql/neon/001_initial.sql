-- Atmosphere Account Postgres/Neon baseline schema.
--
-- This is intentionally a compatibility-first port of lib/db.ts. It keeps
-- JSON-shaped fields as TEXT for the first cutover so current application
-- parsing code can be adapted without also changing every result shape.
-- Later migrations can promote hot JSON columns to jsonb behind typed
-- adapters once Neon is the primary database.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS schema_migration (
  id text PRIMARY KEY,
  applied_at bigint NOT NULL
);

INSERT INTO schema_migration (id, applied_at)
VALUES ('001_initial', (extract(epoch FROM clock_timestamp()) * 1000)::bigint)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS profile (
  did text PRIMARY KEY,
  handle text NOT NULL,
  profile_type text NOT NULL DEFAULT 'project',
  name text NOT NULL,
  description text NOT NULL,
  main_link text,
  ios_link text,
  android_link text,
  categories text NOT NULL DEFAULT '[]',
  subcategories text NOT NULL DEFAULT '[]',
  links text NOT NULL DEFAULT '[]',
  lexicons_json text NOT NULL DEFAULT '{}',
  account_indicators_json text NOT NULL DEFAULT '[]',
  screenshots text NOT NULL DEFAULT '[]',
  avatar_cid text,
  avatar_mime text,
  banner_cid text,
  banner_mime text,
  og_jpeg bytea,
  icon_cid text,
  icon_mime text,
  icon_status text,
  icon_reviewed_by text,
  icon_reviewed_at bigint,
  icon_rejected_reason text,
  icon_bw_cid text,
  icon_bw_mime text,
  icon_bw_status text,
  icon_bw_reviewed_by text,
  icon_bw_reviewed_at bigint,
  icon_bw_rejected_reason text,
  icon_access_status text,
  icon_access_email text,
  icon_access_requested_at bigint,
  icon_access_reviewed_at bigint,
  icon_access_reviewed_by text,
  icon_access_denied_reason text,
  takedown_status text,
  takedown_reason text,
  takedown_by text,
  takedown_at bigint,
  pds_url text NOT NULL,
  record_cid text NOT NULL,
  record_rev text NOT NULL,
  created_at bigint NOT NULL,
  indexed_at bigint NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(handle, '')), 'C')
  ) STORED
);

ALTER TABLE profile ADD COLUMN IF NOT EXISTS lexicons_json text NOT NULL DEFAULT '{}';
ALTER TABLE profile ADD COLUMN IF NOT EXISTS account_indicators_json text NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS profile_handle ON profile(handle);
CREATE INDEX IF NOT EXISTS profile_handle_trgm ON profile USING gin (handle gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profile_search_vector ON profile USING gin (search_vector);
CREATE INDEX IF NOT EXISTS profile_takedown ON profile(takedown_status);
CREATE INDEX IF NOT EXISTS profile_icon_access ON profile(icon_access_status);
CREATE INDEX IF NOT EXISTS profile_type_takedown ON profile(profile_type, takedown_status);

CREATE TABLE IF NOT EXISTS featured (
  did text PRIMARY KEY REFERENCES profile(did) ON DELETE CASCADE,
  badges text NOT NULL DEFAULT '[]',
  position integer NOT NULL DEFAULT 0,
  added_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS jetstream_cursor (
  id integer PRIMARY KEY CHECK (id = 1),
  cursor bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_state (
  key text PRIMARY KEY,
  value text NOT NULL,
  expires_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_session (
  did text PRIMARY KEY,
  value text NOT NULL,
  expires_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_key (
  kid text PRIMARY KEY,
  jwk text NOT NULL,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS app_session (
  id text PRIMARY KEY,
  did text NOT NULL,
  handle text NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS app_user (
  did text PRIMARY KEY,
  handle text NOT NULL,
  display_name text,
  bio text,
  avatar_cid text,
  avatar_mime text,
  bsky_client_id text NOT NULL DEFAULT 'bluesky',
  bsky_button_visible integer NOT NULL DEFAULT 1,
  website_url text,
  website_visible integer NOT NULL DEFAULT 0,
  account_type text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS app_user_handle ON app_user(handle);
CREATE INDEX IF NOT EXISTS app_user_account_type ON app_user(account_type);

CREATE TABLE IF NOT EXISTS report (
  id bigserial PRIMARY KEY,
  target_did text NOT NULL,
  reporter_did text,
  reporter_ip_hash text,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  admin_notes text,
  created_at bigint NOT NULL,
  resolved_at bigint,
  resolved_by text
);

CREATE INDEX IF NOT EXISTS report_status_target ON report(status, target_did);
CREATE INDEX IF NOT EXISTS report_dedup ON report(target_did, reporter_ip_hash, reason, created_at);

CREATE TABLE IF NOT EXISTS review (
  id bigserial PRIMARY KEY,
  target_did text NOT NULL,
  reviewer_did text NOT NULL,
  review_uri text,
  review_cid text,
  review_rkey text,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'visible',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  hidden_at bigint,
  hidden_by text,
  removed_at bigint,
  removed_by text,
  admin_notes text
);

CREATE UNIQUE INDEX IF NOT EXISTS review_target_reviewer ON review(target_did, reviewer_did);
CREATE UNIQUE INDEX IF NOT EXISTS review_uri_unique ON review(review_uri) WHERE review_uri IS NOT NULL;
CREATE INDEX IF NOT EXISTS review_target_status_rating ON review(target_did, status, rating);
CREATE INDEX IF NOT EXISTS review_target_status_created ON review(target_did, status, created_at);

CREATE TABLE IF NOT EXISTS review_report (
  id bigserial PRIMARY KEY,
  review_id bigint NOT NULL REFERENCES review(id) ON DELETE CASCADE,
  reporter_did text,
  reporter_ip_hash text,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  admin_notes text,
  created_at bigint NOT NULL,
  resolved_at bigint,
  resolved_by text
);

CREATE INDEX IF NOT EXISTS review_report_status_review ON review_report(status, review_id);
CREATE INDEX IF NOT EXISTS review_report_dedup ON review_report(review_id, reporter_ip_hash, reason, created_at);

CREATE TABLE IF NOT EXISTS review_response (
  review_id bigint PRIMARY KEY REFERENCES review(id) ON DELETE CASCADE,
  responder_did text NOT NULL,
  body text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_update (
  uri text PRIMARY KEY,
  cid text NOT NULL,
  rkey text NOT NULL,
  project_did text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  version text,
  tangled_commit_url text,
  tangled_repo_url text,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'visible',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  indexed_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS profile_update_project_status_created ON profile_update(project_did, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS profile_update_project_rkey ON profile_update(project_did, rkey);

CREATE TABLE IF NOT EXISTS account_host (
  host text PRIMARY KEY,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  data_location text,
  inferred_location text,
  inferred_location_source text,
  inferred_location_checked_at bigint,
  inferred_location_evidence_json text,
  homepage_url text,
  service_endpoint text,
  account_management_url text,
  dashboard_url text,
  capability_manifest_url text,
  capabilities_json text,
  support_url text,
  profile_handle text,
  profile_did text,
  bsky_profile_visible integer NOT NULL DEFAULT 1,
  avatar_url text,
  claim_handle text,
  claim_did text,
  signup_status text NOT NULL DEFAULT 'unknown',
  verification_status text NOT NULL DEFAULT 'observed',
  source text NOT NULL DEFAULT 'observed',
  match_patterns text NOT NULL DEFAULT '[]',
  service_record_uri text,
  service_record_cid text,
  service_observed_at bigint,
  profile_checked_at bigint,
  observed_account_count integer NOT NULL DEFAULT 0,
  observed_active_account_count integer NOT NULL DEFAULT 0,
  last_indexed_account_at bigint,
  last_checked_at bigint,
  last_observed_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS account_host_verification ON account_host(verification_status);
CREATE INDEX IF NOT EXISTS account_host_signup ON account_host(signup_status);
CREATE INDEX IF NOT EXISTS account_host_source ON account_host(source);

ALTER TABLE account_host ADD COLUMN IF NOT EXISTS data_location text;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS inferred_location text;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS inferred_location_source text;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS inferred_location_checked_at bigint;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS inferred_location_evidence_json text;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS service_endpoint text;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS account_management_url text;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS service_record_uri text;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS service_record_cid text;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS service_observed_at bigint;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS bsky_profile_visible integer NOT NULL DEFAULT 1;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS observed_account_count integer NOT NULL DEFAULT 0;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS observed_active_account_count integer NOT NULL DEFAULT 0;
ALTER TABLE account_host ADD COLUMN IF NOT EXISTS last_indexed_account_at bigint;

CREATE TABLE IF NOT EXISTS account_host_claim (
  host text PRIMARY KEY REFERENCES account_host(host) ON DELETE CASCADE,
  claimant_did text NOT NULL,
  claimant_handle text NOT NULL,
  method text NOT NULL,
  claimed_at bigint NOT NULL,
  verified_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS account_host_claim_claimant ON account_host_claim(claimant_did);

CREATE TABLE IF NOT EXISTS host_record (
  uri text PRIMARY KEY,
  cid text,
  collection text NOT NULL,
  repo_did text NOT NULL,
  rkey text NOT NULL,
  author_handle text,
  raw_json text NOT NULL,
  parsed_json text NOT NULL,
  host text,
  display_name text,
  service_endpoint text,
  indexed_at bigint NOT NULL,
  deleted_at bigint
);

CREATE INDEX IF NOT EXISTS host_record_host ON host_record(host, deleted_at);
CREATE INDEX IF NOT EXISTS host_record_collection ON host_record(collection, deleted_at);
CREATE INDEX IF NOT EXISTS host_record_repo_rkey ON host_record(repo_did, collection, rkey);

CREATE TABLE IF NOT EXISTS pds_host_account (
  did text PRIMARY KEY,
  handle text,
  service_endpoint text NOT NULL,
  service_host text NOT NULL,
  account_host text NOT NULL,
  source text NOT NULL,
  first_observed_at bigint NOT NULL,
  last_observed_at bigint NOT NULL,
  last_active_at bigint
);

CREATE INDEX IF NOT EXISTS pds_host_account_host ON pds_host_account(account_host, last_observed_at);
CREATE INDEX IF NOT EXISTS pds_host_account_service_host ON pds_host_account(service_host, last_observed_at);
CREATE INDEX IF NOT EXISTS pds_host_account_active ON pds_host_account(account_host, last_active_at);

CREATE TABLE IF NOT EXISTS pds_discovery_cursor (
  source text PRIMARY KEY,
  cursor text NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS app_record (
  uri text PRIMARY KEY,
  cid text NOT NULL,
  collection text NOT NULL,
  source_type text NOT NULL,
  repo_did text NOT NULL,
  rkey text NOT NULL,
  listing_id text,
  raw_json text NOT NULL,
  parsed_json text NOT NULL,
  record_created_at bigint,
  record_updated_at bigint,
  indexed_at bigint NOT NULL,
  deleted_at bigint
);

CREATE INDEX IF NOT EXISTS app_record_collection ON app_record(collection, deleted_at);
CREATE INDEX IF NOT EXISTS app_record_listing ON app_record(listing_id, deleted_at);
CREATE INDEX IF NOT EXISTS app_record_repo_rkey ON app_record(repo_did, collection, rkey);

CREATE TABLE IF NOT EXISTS app_listing (
  id text PRIMARY KEY,
  slug text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  tagline text NOT NULL DEFAULT '',
  app_status text,
  primary_url text,
  icon_url text,
  hero_url text,
  screenshot_urls text NOT NULL DEFAULT '[]',
  links_json text NOT NULL DEFAULT '[]',
  tags_json text NOT NULL DEFAULT '[]',
  platforms_json text NOT NULL DEFAULT '[]',
  category_slugs_json text NOT NULL DEFAULT '[]',
  lexicons_json text NOT NULL DEFAULT '{}',
  account_indicators_json text NOT NULL DEFAULT '[]',
  source_refs_json text NOT NULL DEFAULT '{}',
  canonical_source text NOT NULL,
  canonical_uri text NOT NULL,
  product_did text,
  profile_did text,
  legacy_profile_did text,
  atstore_listing_uri text,
  community_profile_uri text,
  community_entry_uri text,
  review_count integer NOT NULL DEFAULT 0,
  average_rating double precision,
  favorite_count integer NOT NULL DEFAULT 0,
  mention_count_24h integer NOT NULL DEFAULT 0,
  mention_count_7d integer NOT NULL DEFAULT 0,
  trending_score double precision,
  published_at bigint,
  updated_at bigint NOT NULL,
  indexed_at bigint NOT NULL,
  deleted_at bigint,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(tagline, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(slug, '')), 'C')
  ) STORED
);

ALTER TABLE app_listing ADD COLUMN IF NOT EXISTS app_status text;
CREATE UNIQUE INDEX IF NOT EXISTS app_listing_slug ON app_listing(slug);
CREATE INDEX IF NOT EXISTS app_listing_slug_trgm ON app_listing USING gin (slug gin_trgm_ops);
CREATE INDEX IF NOT EXISTS app_listing_name_trgm ON app_listing USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS app_listing_search_vector ON app_listing USING gin (search_vector);
CREATE INDEX IF NOT EXISTS app_listing_canonical ON app_listing(canonical_source, deleted_at);
CREATE INDEX IF NOT EXISTS app_listing_atstore ON app_listing(atstore_listing_uri);
CREATE INDEX IF NOT EXISTS app_listing_legacy ON app_listing(legacy_profile_did);
CREATE INDEX IF NOT EXISTS app_listing_trending ON app_listing(trending_score, updated_at);
CREATE INDEX IF NOT EXISTS app_listing_public_trending ON app_listing(deleted_at, trending_score DESC, updated_at DESC, published_at DESC);
CREATE INDEX IF NOT EXISTS app_listing_public_newest ON app_listing(deleted_at, published_at DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS app_listing_public_name ON app_listing(deleted_at, lower(name));

CREATE TABLE IF NOT EXISTS app_alias (
  alias_key text PRIMARY KEY,
  listing_id text NOT NULL REFERENCES app_listing(id) ON DELETE CASCADE,
  source_uri text NOT NULL,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS app_alias_listing ON app_alias(listing_id);

CREATE TABLE IF NOT EXISTS app_review (
  uri text PRIMARY KEY,
  listing_uri text NOT NULL,
  listing_id text REFERENCES app_listing(id) ON DELETE SET NULL,
  author_did text NOT NULL,
  rkey text NOT NULL,
  cid text NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body text NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  indexed_at bigint NOT NULL,
  deleted_at bigint
);

CREATE INDEX IF NOT EXISTS app_review_listing ON app_review(listing_id, deleted_at, created_at);
CREATE INDEX IF NOT EXISTS app_review_subject ON app_review(listing_uri, deleted_at);

CREATE TABLE IF NOT EXISTS app_favorite (
  uri text PRIMARY KEY,
  listing_uri text NOT NULL,
  listing_id text REFERENCES app_listing(id) ON DELETE SET NULL,
  author_did text NOT NULL,
  rkey text NOT NULL,
  cid text NOT NULL,
  created_at bigint NOT NULL,
  indexed_at bigint NOT NULL,
  deleted_at bigint
);

CREATE INDEX IF NOT EXISTS app_favorite_listing ON app_favorite(listing_id, deleted_at, created_at);

CREATE TABLE IF NOT EXISTS app_mention (
  id text PRIMARY KEY,
  listing_uri text NOT NULL,
  listing_id text REFERENCES app_listing(id) ON DELETE SET NULL,
  post_uri text NOT NULL,
  post_cid text,
  author_did text NOT NULL,
  author_handle text,
  post_text text,
  post_created_at bigint NOT NULL,
  match_type text NOT NULL,
  match_confidence double precision NOT NULL DEFAULT 1,
  match_evidence_json text,
  indexed_at bigint NOT NULL,
  deleted_at bigint
);

CREATE UNIQUE INDEX IF NOT EXISTS app_mention_listing_post ON app_mention(listing_id, post_uri);
CREATE INDEX IF NOT EXISTS app_mention_listing ON app_mention(listing_id, deleted_at, post_created_at);
CREATE INDEX IF NOT EXISTS app_mention_subject ON app_mention(listing_uri, deleted_at);

CREATE TABLE IF NOT EXISTS app_record_failure (
  uri text PRIMARY KEY,
  collection text NOT NULL,
  source_type text NOT NULL,
  repo_did text NOT NULL,
  rkey text NOT NULL,
  reason text NOT NULL,
  first_seen_at bigint NOT NULL,
  last_seen_at bigint NOT NULL,
  count integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS app_record_failure_seen ON app_record_failure(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS app_record_failure_source ON app_record_failure(source_type, collection);

CREATE TABLE IF NOT EXISTS app_directory_job (
  id text PRIMARY KEY,
  kind text NOT NULL,
  status text NOT NULL,
  created_by text,
  created_at bigint NOT NULL,
  started_at bigint,
  finished_at bigint,
  updated_at bigint NOT NULL,
  progress_label text,
  listings_imported integer NOT NULL DEFAULT 0,
  reviews_imported integer NOT NULL DEFAULT 0,
  favorites_imported integer NOT NULL DEFAULT 0,
  records_seen integer NOT NULL DEFAULT 0,
  records_failed integer NOT NULL DEFAULT 0,
  rescored integer NOT NULL DEFAULT 0,
  error text
);

CREATE INDEX IF NOT EXISTS app_directory_job_status ON app_directory_job(status, created_at);
CREATE INDEX IF NOT EXISTS app_directory_job_kind_created ON app_directory_job(kind, created_at DESC);

CREATE TABLE IF NOT EXISTS app_featured (
  listing_id text PRIMARY KEY REFERENCES app_listing(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  label text,
  added_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS app_featured_position ON app_featured(position);

CREATE TABLE IF NOT EXISTS app_moderation (
  listing_id text PRIMARY KEY REFERENCES app_listing(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'visible',
  reason text,
  updated_at bigint NOT NULL,
  updated_by text
);

CREATE INDEX IF NOT EXISTS app_moderation_status ON app_moderation(status);

CREATE TABLE IF NOT EXISTS login_app (
  client_id text PRIMARY KEY,
  app_name text NOT NULL,
  app_uri text,
  logo_uri text,
  allowed_return_uris text NOT NULL DEFAULT '[]',
  allowed_origins text NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'unverified',
  contact_did text,
  review_status text NOT NULL DEFAULT 'none',
  review_requested_at bigint,
  review_notes text,
  review_decision_at bigint,
  review_decision_by text,
  review_decision_reason text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS login_app_status ON login_app(status);
CREATE INDEX IF NOT EXISTS login_app_review_status ON login_app(review_status, review_requested_at);
CREATE INDEX IF NOT EXISTS login_app_contact_did ON login_app(contact_did, updated_at);

CREATE TABLE IF NOT EXISTS login_app_connection (
  client_id text NOT NULL REFERENCES login_app(client_id) ON DELETE CASCADE,
  did text NOT NULL,
  handle text NOT NULL,
  selected_count integer NOT NULL DEFAULT 1,
  first_selected_at bigint NOT NULL,
  last_selected_at bigint NOT NULL,
  PRIMARY KEY (client_id, did)
);

CREATE INDEX IF NOT EXISTS login_app_connection_did ON login_app_connection(did, last_selected_at);

CREATE TABLE IF NOT EXISTS login_selection_replay (
  jti text PRIMARY KEY,
  expires_at bigint NOT NULL,
  consumed_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS login_selection_replay_expires ON login_selection_replay(expires_at);

CREATE TABLE IF NOT EXISTS login_picker_intent (
  code_hash text PRIMARY KEY,
  did text NOT NULL,
  client_id text NOT NULL,
  return_uri text NOT NULL,
  state text NOT NULL,
  scope text,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  consumed_at bigint
);

CREATE INDEX IF NOT EXISTS login_picker_intent_expires ON login_picker_intent(expires_at);

CREATE TABLE IF NOT EXISTS rate_limit_bucket (
  bucket_key text PRIMARY KEY,
  count integer NOT NULL,
  reset_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limit_bucket_reset ON rate_limit_bucket(reset_at);

CREATE TABLE IF NOT EXISTS worker_lease (
  name text PRIMARY KEY,
  owner_id text NOT NULL,
  expires_at bigint NOT NULL,
  heartbeat_at bigint NOT NULL,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_state_expires ON oauth_state(expires_at);
CREATE INDEX IF NOT EXISTS oauth_session_expires ON oauth_session(expires_at);
CREATE INDEX IF NOT EXISTS app_session_expires ON app_session(expires_at);
CREATE INDEX IF NOT EXISTS worker_lease_expires ON worker_lease(expires_at);

COMMIT;
