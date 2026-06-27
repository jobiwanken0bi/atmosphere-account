# Infrastructure

Atmosphere Account is an AT Protocol appview plus a public web app. The runtime
is intentionally split into two deployable units:

- **Web app:** Fresh/Deno server for public pages, OAuth, account management,
  app reviews/favorites, and admin surfaces.
- **Indexer worker:** one always-on process that consumes Jetstream, fetches
  authoritative PDS records, and updates the local appview projection.
- **Database:** Turso/libSQL as the current relational appview database. It
  stores source records, deduped listings, aggregates, account hosts, moderation
  state, OAuth state, sessions, and the worker lease.

## Provider Direction

The MVP provider split is still sound, but the next product stage changes the
database requirements. Atmosphere Account is no longer only a small directory:
it is becoming a control plane for hosted sign-in, app registration, ATStore
interop, host claims, moderation, jobs, and admin observability.

Recommended target:

- **Web app:** Deno Deploy. Keep the public web app, hosted Atmosphere Login
  picker, OAuth metadata/JWKS, account pages, app pages, and admin pages on Deno
  Deploy. If production is still on Deploy Classic, migrate to the new Deno
  Deploy platform before the Classic shutdown on July 20, 2026. See
  [DENO_DEPLOY_MIGRATION.md](./DENO_DEPLOY_MIGRATION.md).
- **Primary database:** Neon Postgres. The appview is now write-concurrent,
  relational, query-heavy, and needs safer migrations, branching, backfills, and
  operational visibility.
- **Indexer worker:** Railway. The worker should stay separate from the web app
  because it holds a long-lived Jetstream WebSocket and performs remote PDS
  fetches. Railway now replaces the old Fly worker for this always-on process.
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

There is no active Railway web service. Do not point `atmosphereaccount.com` at
Railway unless we intentionally create a new Railway web service and move the
public web app away from Deno Deploy later.

Why Neon now:

- The app directory and login app tables are relational read models with dedupe,
  aggregates, review/favorite counts, admin queues, and backfill jobs.
- Hosted sign-in can create bursty request traffic from many third-party apps.
  Postgres plus pooled connections is a better fit than request-time SQLite
  migrations and raw FTS tables.
- Neon branching gives us production-like preview/test databases for risky
  migrations and backfills.
- The codebase needs a real migration history rather than lazy additive schema
  bootstrapping in `lib/db.ts`.

Why not switch by env var only:

- The current query layer uses libSQL result shapes, `?` placeholders,
  SQLite-specific upserts, SQLite FTS5, `AUTOINCREMENT`, and request-time schema
  creation. A direct `DATABASE_URL=postgres://...` change would fail or produce
  subtle result-shape bugs.
- The safe migration is staged: schema parity, DB adapter, dual-write/backfill,
  diff, read cutover, write cutover, then Turso retirement.

## Neon Migration Track

The first Postgres baseline lives at:

```sh
sql/neon/001_initial.sql
```

Apply it to a new Neon database with a direct connection string, not a pooled
string:

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

These tasks require `NEON_DIRECT_DATABASE_URL` or `NEON_DATABASE_URL`. Keep
runtime reads/writes on Turso until the adapter conversion and parity checks
below are complete.

Runtime backend selection is controlled with `ATMOSPHERE_DB_BACKEND=turso|neon`.
The default is `turso`. Neon runtime mode is opt-in only while the compatibility
suite is being hardened.

The Neon migration scripts load `.env` automatically and preserve already
exported shell variables. This lets an operator keep Turso credentials in `.env`
while exporting a temporary Neon branch URL in the terminal. If a dry-run
reports every Turso table as `0 rows ready`, check that `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN` are present in `.env` or exported in the shell; the scripts
now refuse to use the implicit `file:./local.db` fallback for backfill/diff.

Cutover sequence:

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

Acceptance checks before production cutover:

- `/signin`, `/login/select`, and selection-token verification pass end to end.
- `/apps`, `/apps/all`, app detail pages, review sorting, favorite counts, and
  admin backfill pages match Turso for sampled rows.
- Jetstream cursor, worker lease, job status, and failed-record inspector work
  under Postgres.
- Migration is run explicitly during deploy; request-time migrations are off in
  hosted production.
- Backups/restore are tested from a Neon branch before the production switch.

## Current Architecture Findings

Strengths:

- The web app and appview worker are already separate deployable units.
- The worker fetches authoritative records from PDSes instead of trusting only
  relay event payloads.
- Worker leasing prevents duplicate long-lived consumers.
- Admin backfill and failure tables now exist, which is the right observability
  direction for ATStore ingestion.

Risks to address while moving to Neon:

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

Run cleanup for expired OAuth/app sessions and stale worker leases:

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
