# Infrastructure

Atmosphere Account is an AT Protocol appview plus a public web app. Production
is intentionally split into a public shell, an appview/API runtime, an indexer,
and a relational Postgres store for appview data plus off-protocol control-plane
state:

- **Public web shell:** Fresh/Deno server on Deno Deploy for public pages, docs,
  OAuth metadata, the hosted login picker, static SDK assets, and light edge
  rendering.
- **Appview/API runtime:** Fresh/Deno server on Railway for DB-backed app, host,
  account, login, review/favorite, developer, admin, and generated-asset routes.
  The Railway service may still be named `web` in the Railway UI, but
  architecturally it is the appview/API service.
- **Indexer worker:** one always-on Railway process that consumes Jetstream,
  fetches authoritative PDS records, and updates the local appview projection.
- **Database:** Railway Postgres as the current relational store. It stores the
  appview read model, including source records, deduped listings, aggregates,
  account hosts, moderation state, and the worker lease. It also stores
  off-protocol control-plane state for hosted sign-in, including OAuth/session
  state, registered login apps, exact return URI policy, picker connections,
  replay protection, durable rate limits, and trust review state.

## Provider Direction

The MVP provider split is still sound, but the next product stage changes the
database requirements. Atmosphere Account is no longer only a small directory:
it is becoming a control plane for hosted sign-in, app registration, ATStore
interop, host claims, moderation, jobs, and admin observability.

Recommended target:

- **Public client/web shell:** Deno Deploy can continue to serve mostly static
  public pages, docs, and the standalone picker surface. If Deno remains in the
  architecture, it should call a Railway appview API for DB-backed data rather
  than connecting directly to Railway Postgres over a public TCP proxy.
- **Appview runtime:** Railway. DB-backed routes for apps, hosts, login state,
  developer registration, admin jobs, and account surfaces should run in Railway
  when they need direct database access. This lets Postgres traffic stay on
  Railway private networking.
- **Primary database:** Railway Postgres. The appview is write-concurrent,
  relational, query-heavy, and shares operational locality with the always-on
  indexer and backfill/admin jobs.
- **Indexer worker:** Railway. The worker should stay separate from the
  web/appview service because it holds a long-lived Jetstream WebSocket and
  performs remote PDS fetches. Railway now replaces the old Fly worker for this
  always-on process.
- **Object/media storage:** AT Protocol blobs stay canonical on the user's PDS.
  Avatar/icon display should prefer Bluesky's CDN when a DID/CID pair is
  available. Add S3/R2/Railway object storage only for generated or non-protocol
  media such as OG images, screenshots, or expensive derived assets.
  `profile.og_jpeg` should be the exception, not the pattern.
- **Cache/rate-limit layer:** add Redis/Valkey only when hosted login traffic
  grows beyond DB-backed sessions and signed stateless selection tokens. Good
  candidates: rate limits, token replay guards, short-lived app metadata cache,
  and popular `/apps` fragments.

Railway migration state lives in [RAILWAY_MIGRATION.md](./RAILWAY_MIGRATION.md).

Do not point `atmosphereaccount.com` at Railway until the intended public web
hosting model is confirmed. A Railway web/appview service can be used as the
server-side runtime, while Deno Deploy can remain the client/docs/picker host
after the appview boundary is made explicit.

Why Railway Postgres now:

- The app directory and login app tables are relational read models with dedupe,
  aggregates, review/favorite counts, admin queues, and backfill jobs.
- Hosted sign-in can create bursty request traffic from many third-party apps.
  Postgres plus pooled connections is a better fit than request-time SQLite
  migrations and raw FTS tables.
- Keeping the appview runtime, indexer, jobs, and database in one Railway
  project gives us private service networking and one operational control plane.
- The codebase needs a real migration history rather than lazy additive schema
  bootstrapping in `lib/db.ts`.

## Auth And Off-Protocol Control Plane

`login.atmosphereaccount.com` should feel like an edge-native sign-in surface,
but the edge is not the authority for Atmosphere Login. Deno Deploy owns the
fast public experience: the picker shell, SDK assets, public metadata, JWKS, and
safe cached reads. Railway owns the durable decisions that must be consistent
across every request.

Durable auth/control-plane state stays in Railway Postgres:

- registered developer apps and app identity shown in the picker
- exact allowed return URI policy
- development, unverified, trusted, and blocked app states
- saved Atmosphere picker connections
- selection-token replay protection
- durable rate-limit buckets for high-risk login flows
- OAuth/session state, admin review state, and audit-friendly timestamps

These tables are logically separate from indexed AT Protocol records even while
they share the same Railway Postgres service. The indexed appview read model can
be rebuilt from protocol records and backfills. The control plane cannot be
treated that way: if an app is blocked, a return URI is removed, or a selection
token has already been consumed, every region and every request must agree.

Current implementation note: DB-backed login routes should execute in the
Railway appview/API runtime or be proxied there from Deno. Deno should not
become a permanent public-TCP Postgres client just because the login page is
Deno-facing.

If the control plane outgrows the shared database, split it by schema first
(`auth.*` or `control_plane.*`) or into a second Railway Postgres service. Add
Redis/Valkey only for high-volume ephemeral concerns such as rate limits,
short-lived replay guards, or safe app metadata cache entries. Do not move the
authoritative trust, return URI, or connection records to an eventually
consistent edge cache.

Why not switch by env var only:

- The current query layer uses libSQL result shapes, `?` placeholders,
  SQLite-specific upserts, SQLite FTS5, `AUTOINCREMENT`, and request-time schema
  creation. A direct `DATABASE_URL=postgres://...` change would fail or produce
  subtle result-shape bugs.
- The safe migration is staged: schema parity, DB adapter, backfill/copy, smoke
  tests, read/write cutover, then Turso/Neon variable retirement.

## Railway Postgres Cutover

The generic Postgres runtime uses:

```sh
ATMOSPHERE_DB_BACKEND=postgres
POSTGRES_DATABASE_URL=${{Postgres.DATABASE_URL}}
POSTGRES_SSL_MODE=disable
```

Inside Railway, `${{Postgres.DATABASE_URL}}` resolves to the private database
connection string. Local operator scripts may use Railway's public database URL
temporarily for migration and copy tasks, but that is not the desired permanent
web runtime shape.

Postgres runtime tasks:

```sh
# Apply sql/neon/001_initial.sql to a generic Postgres database.
deno task db:migrate:postgres

# Dry-run Neon -> Railway Postgres copy.
deno task db:copy:postgres

# Copy rows into Railway Postgres. Use --reset only during an intentional
# cutover/backfill window.
deno task db:copy:postgres -- --write --reset

# Exercise route-shaped reads against Railway Postgres.
ATMOSPHERE_DB_BACKEND=postgres deno task db:smoke -- --backend=postgres
```

Cutover acceptance checks:

- Railway Postgres contains the copied appview rows.
- Railway indexer owns a fresh `worker_lease` heartbeat and writes to Railway
  Postgres.
- `/apps`, `/hosts`, app detail pages, login app registration, and account
  surfaces pass route-shaped smoke checks against the Postgres backend.
- Production web traffic stays on Deno Deploy and calls a Railway appview API.
  Avoid a permanent Deno Deploy to Railway public database connection.
- Neon and Turso env vars are removed only after the production web/appview
  runtime has been verified on Railway Postgres through one release window.

## Deno Web Shell + Railway Appview Mode

Set this on Deno Deploy when keeping Deno as the public web shell:

```sh
ATMOSPHERE_APPVIEW_URL=https://web-production-001c9.up.railway.app
APPVIEW_FETCH_TIMEOUT_MS=5000
```

With this set, public app/host list pages read from Railway appview JSON
endpoints instead of querying a local Deno-side database. `/api/health/ready`
also proxies Railway appview readiness so production health reflects the
Postgres-backed appview and fresh indexer lease.

Railway's HTTP service is the appview/API service, even if the Railway UI still
labels it `web`. Deno remains the public website, docs, static SDK, and hosted
picker. Detail pages and authenticated write flows should be moved behind the
appview API in later slices before Neon and Turso variables are fully removed
from the Deno app.

Run `deno task smoke:production` after Deno or Railway appview deploys. It runs
`smoke:public-shell` for production liveness/readiness, OAuth metadata, JWKS,
core HTML pages, and standalone SDK assets. The public shell health response and
proxied appview readiness response must both expose `release.runtime`; this
catches stale appview deployments where the Deno shell is current but Railway is
still serving an older server bundle. For exact release drift detection, use
provider-native Git metadata. Source-linked Railway services expose
`RAILWAY_GIT_COMMIT_SHA`; Deno Deploy may expose `DENO_GIT_COMMIT_SHA`. If the
Deno runtime does not, stamp only the Deno side before deploying, then run:

```sh
SMOKE_EXPECT_RELEASE_SHA="$(git rev-parse HEAD)" deno task smoke:production
```

The helper below stamps only Deno when its provider metadata is unavailable.
Railway must deploy the same pushed `main` commit from its connected GitHub
source:

```sh
git push origin main
deno task release:stamp -- --write --deno
SMOKE_EXPECT_RELEASE_SHA="$(git rev-parse HEAD)" deno task smoke:production
```

`release:stamp --write` intentionally fails when the worktree is dirty or HEAD
does not match its tracked upstream. Push the release commit first so GitHub can
verify the same SHA, and use `--allow-dirty`, `--allow-unpushed`, or an explicit
`--sha` only for a deliberate emergency override.

When both layers expose `release.gitSha`, the public-shell smoke also verifies
that Deno and Railway are serving the same commit. It also runs
`smoke:picker-assets` because the hosted picker is Deno-facing while
Fresh-generated island chunks may come from the appview bundle proxy. The picker
smoke checks HTML, CSS, static scripts, and generated `/assets` imports on both
`login.atmosphereaccount.com` and `atmosphereaccount.com`.

GitHub Actions also runs the `Production Smoke` workflow on a schedule and on
manual dispatch. It defaults to the checked-out SHA, so scheduled runs fail if
`main` has moved but the Deno shell or Railway appview is still serving an older
release. Treat it as an early warning, not as a replacement for running
`deno task smoke:production` immediately after an intentional deploy or DNS
change. Manual dispatch accepts `expected_release_sha` only as an override when
you intentionally need to smoke an older deployed release from GitHub.

The appview readiness payload includes `pdsInventory`. Only a successful scan
that reached the relay's final page satisfies freshness. The default 42-hour
window is monitored by the hourly Production Smoke workflow, which opens or
updates a GitHub issue on failure. A failed or partial scan remains visible as
the latest attempt but cannot refresh the heartbeat.

## Neon Migration Track

This section is retained for historical comparison and rollback experiments.
Neon is no longer the target primary appview database.

The first Postgres baseline lives at:

```sh
sql/neon/001_initial.sql
```

Apply it to a Neon database with a direct connection string, not a pooled
string, only when running a Neon comparison branch:

```sh
deno task db:migrate:neon
```

Use the pooled connection string for web requests and short-lived app work. Use
the direct connection string for migrations, dumps/restores, and long-running
administrative tasks.

Migration tooling now exists for the first safe Neon slice:

```sh
# Apply sql/neon/001_initial.sql to Neon.
deno task db:migrate:neon

# Dry-run the Turso -> Neon copy plan.
deno task db:backfill:neon

# Copy Turso rows into Neon. Use --reset only on a disposable Neon branch.
deno task db:backfill:neon -- --write
deno task db:backfill:neon -- --write --reset

# Compare Turso and Neon counts/primary-key sets.
deno task db:diff:neon

# Exercise route-shaped reads against Turso and Neon.
deno task db:smoke
deno task db:smoke -- --backend=neon
```

These tasks require `NEON_DIRECT_DATABASE_URL` or `NEON_DATABASE_URL`.

Runtime backend selection is controlled with
`ATMOSPHERE_DB_BACKEND=turso|neon|postgres`. In production Railway services, set
`ATMOSPHERE_DB_BACKEND=postgres`. Set `ATMOSPHERE_DB_BACKEND=turso` explicitly
when you need to inspect the legacy Turso database.

The Neon migration scripts load `.env` automatically and preserve already
exported shell variables. This lets an operator keep Turso credentials in `.env`
while exporting a temporary Neon branch URL in the terminal. If a dry-run
reports every Turso table as `0 rows ready`, check that `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN` are present in `.env` or exported in the shell; the scripts
now refuse to use the implicit `file:./local.db` fallback for backfill/diff.

Historical Neon cutover sequence:

1. Provision Neon project in the same broad region as the web and worker
   traffic, likely US East while the worker is in `iad`.
2. Apply `sql/neon/001_initial.sql` to a Neon branch with
   `deno task db:migrate:neon`.
3. Use the Neon compatibility client in `lib/neon.ts` for migration scripts. A
   full runtime cutover still needs conversion of SQLite-specific query paths
   before `withDb` can point at Neon.
4. Convert SQLite-only SQL as it is encountered:
   - `?` placeholders to adapter-managed Postgres parameters.
   - `INSERT OR REPLACE` to `INSERT ... ON CONFLICT ... DO UPDATE`.
   - `profile_fts MATCH` to `search_vector @@ plainto_tsquery(...)` or trigram
     search.
   - `last_insert_rowid()` to `RETURNING id`.
5. Backfill from Turso into Neon with `deno task db:backfill:neon -- --write`,
   preserving primary keys and AT URIs.
6. Compare row counts and primary-key sets with `deno task db:diff:neon`, then
   run the Jetstream worker in dual-write mode and compare aggregates, cursor
   movement, and sample app detail pages.
7. Flip reads for low-risk admin/status surfaces first, then `/apps`, then
   login/session paths.
8. Flip writes after the login picker and OAuth state tests pass against Neon.
9. Keep Turso read-only for rollback through one full release window.

Acceptance checks before any Postgres production cutover:

- `/signin`, `https://login.atmosphereaccount.com/login/select`, and
  selection-token verification pass end to end.
- `/apps`, `/apps/all`, app detail pages, review sorting, favorite counts, and
  admin backfill pages match Turso for sampled rows.
- Jetstream cursor, worker lease, job status, and failed-record inspector work
  under Postgres.
- Migration is run explicitly during deploy; request-time migrations are off in
  hosted production.
- Backups/restore are tested from a disposable branch or copy before the
  production switch.

## Current Architecture Findings

Strengths:

- The public shell, appview/API runtime, and indexer worker are already separate
  deployable units.
- The worker fetches authoritative records from PDSes instead of trusting only
  relay event payloads.
- Worker leasing prevents duplicate long-lived consumers.
- Admin backfill and failure tables now exist, which is the right observability
  direction for ATStore ingestion.

Risks to address while operating on Postgres:

- `lib/db.ts` contains schema, migrations, runtime connection logic, and health
  checks in one file. Split schema migrations from runtime clients.
- Lazy request migrations should stay local-only. Production deploys should run
  explicit migrations.
- App-directory background jobs are queued from the admin UI. Hosted web refuses
  to run them in-process by default, so Railway or an operator should drain
  queued work with `deno task app-directory:run-jobs`.
- Heavy one-shot backfills, including OG JPEG generation, should run from
  Railway/local CLI tasks such as `deno task backfill:og-jpegs`, not from Deno
  Deploy. Hosted web has an emergency override env var, but the safe default is
  to keep billable web CPU for user requests.
- Hosted web logs slow requests by path only, with query strings omitted so
  OAuth and login parameters do not leak. Set `LOG_SLOW_REQUESTS=false` to
  disable it or `SLOW_REQUEST_LOG_MS=1500` to tune the threshold.
- Hosted picker selection and selection-token verification use DB-backed
  fixed-window rate limits with salted bucket keys. If the DB is briefly
  unavailable, they fall back to the older in-memory guard so login does not go
  fully dark. Move the same scopes to Redis/Valkey if login volume makes hot DB
  counters too expensive.
- Browser-readable selection-token verification responses are CORS-bound to the
  registered app return origin. Preflight stays permissive enough for browsers
  to reach the endpoint, but actual JSON responses only expose themselves to
  exact registered callbacks or loopback-only local dev apps.
- OAuth state and app sessions are DB-backed. That is fine on Postgres, but
  high-volume hosted login may eventually need Redis for hot ephemeral state and
  replay guards.
- Large generated/non-protocol media should move to object storage instead of
  the relational DB. PDS blobs should remain PDS-owned and CDN-served where
  possible.

## Media Policy

Atmosphere Account should not become a general-purpose blob mirror for protocol
media.

- **Canonical source:** user-uploaded AT Protocol media lives on the user's PDS
  and is referenced by DID/CID in records.
- **Avatar-style display path:** profile avatars and app/account icons that are
  already DID/CID blobs should use Bluesky's CDN helper in `lib/avatar.ts`. This
  keeps hot UI paths off our web server without duplicating storage.
- **PDS proxy path:** banners, screenshots, SVG icons with access checks, and
  other non-avatar blob views can keep using narrow proxy routes that validate
  type, size, ownership, and cache headers.
- **Object storage path:** S3/R2/Railway object storage is reserved for
  generated or non-protocol assets such as OG images, screenshots we create, or
  future expensive derived media. Do not mirror every ATProto blob into
  Atmosphere-owned object storage unless we have a concrete reliability,
  control, or cost reason.

## Operational Commands

Run schema bootstrap explicitly before deploys and after additive DB changes:

```sh
deno task db:migrate
```

Run cleanup for expired OAuth/app sessions, Atmosphere Login replay keys, and
stale worker leases:

```sh
deno task db:maintain
```

Backfill ATStore listings and configured review/favorite repos:

```sh
deno task backfill:atstore
```

Rescore app trending aggregates:

```sh
deno task rescore:app-trending
```

Drain queued admin app-directory jobs outside the hosted web process:

```sh
deno task app-directory:run-jobs
deno task app-directory:run-jobs -- --limit=3
```

Backfill generated OG JPEG cache outside the hosted web process:

```sh
deno task backfill:og-jpegs
deno task backfill:og-jpegs -- --limit=50
```

## PDS Inventory

PDS discovery uses the relay-level `com.atproto.sync.listHosts` inventory by
default:

```sh
deno task pds:index -- --dry-run
deno task pds:index
```

A full scan uses pages of up to 1,000 PDS instances and writes them to
`pds_instance` in batches. The relay already supplies an account count for each
PDS, so routine host inventory does not enumerate or permanently store every
account DID. All `*.host.bsky.network` mushroom instances map to the single
public `bsky.network` account host; known provider endpoints such as
`blacksky.app` and `tngl.sh` similarly map to their friendly provider records.
Independent PDS instances remain in the raw inventory, including their current
relay status and last-active time. The append-only status history writes only
the initial state and subsequent transitions (including `not_seen` after a
complete scan), rather than duplicating every host on every scan. Their
relay-supplied DID counts make the directory sortable without storing the
individual account DIDs.

The public host directory is a curated projection, not a dump of that relay
inventory. A grouped host is public only when it is recently relay-active or
passes a current reachability check and also has an intentional-publication
signal: a claimed or verified profile, a seed maintained by Atmosphere, a safe
public HTTPS signup URL, or conservative PDS metadata. A self-published
Atmosphere host service record can enrich stored profile data, but does not by
itself establish domain authority or directory eligibility. The scheduled
inventory job also enriches a bounded batch of stale, active multi-account PDSes
through the standard `describeServer` endpoint. Open registration is an
independent public-intent signal; invite-based registration also requires
published operator contact and policy metadata. These detected providers can
appear before they are claimed, while claiming remains the way an operator
customizes and controls the profile. One-user and observed-only PDSes remain
private. Detection is refreshed daily, expires from public eligibility after
seven days without a successful check, and can be skipped or bounded with
`--skip-enrichment` and `--enrichment-limit=N`.

Claimed and verified hosts retain a 72-hour grace period after their last active
relay observation so a temporary outage does not make their directory page flap.
The normal activity window is 48 hours. The default public sort is total
observed accounts, then claimed/verified status, then name. The directory does
not repeat an “Active” badge on every listing; only exceptional temporary
unavailability is surfaced.

The Create Account picker applies a narrower projection again: a host must pass
the public reachability policy, be claimed, verified, or seeded, accept open or
invite-based signup, and publish a safe HTTPS signup URL. Signup and invite-code
entry remain entirely on the host's page.

Partial scans update only the raw inventory; public account-host totals,
last-active aggregation, and `not_seen` reconciliation change only after a
complete scan. Complete scans also refuse an empty result or an unexpected drop
of more than 5% in the PDS instance count. After verifying a legitimate large
removal, an operator can rerun with `--allow-large-drop`.

Run this as a short scheduled job, initially daily. It does not belong in the
always-on Jetstream process. The Jetstream worker still consumes Atmosphere's
app, profile, review, and host protocol records, but no longer performs extra
per-account DB writes merely to count PDS membership.

The previous PLC export walker and per-DID discovery tables were removed after
the relay inventory completed successfully in production. A complete PLC history
walk scales with account operations rather than PDS instances and is materially
more expensive in network, database, and execution time.

## Health Checks

- `GET /api/health` is a cheap liveness check. It does not touch the DB.
- `GET /api/health/ready` checks DB connectivity and reports the current
  Jetstream worker lease heartbeat when available.

The readiness endpoint should fail deploy/monitoring checks only when the web
app cannot reach the DB. A missing or stale indexer lease means ingestion is
behind, not that the web app is unable to serve.

## Worker Coordination

The Jetstream worker uses the `worker_lease` table to keep one active consumer:

- Lease name: `jetstream-indexer`
- TTL: 45 seconds
- Renewal interval: 15 seconds

This protects the relay, PDSes, and Turso from accidental duplicate consumers
during deploy overlap or manual scale-up. Event handling remains idempotent, so
replays after a crash are safe.

## Deployment Notes

The Fly worker deploy runs `scripts/migrate-db.ts` as a release command before
starting the worker. The runtime command must include `--node-modules-dir=auto`;
`fly.indexer.toml` intentionally repeats that flag because process commands
override the Dockerfile `CMD`.

Hosted environments must set:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN` for remote Turso URLs
- `SESSION_SECRET`
- OAuth keys when sign-in/write flows are enabled

The app intentionally refuses local DB and weak session-secret fallbacks in
hosted runtimes.
