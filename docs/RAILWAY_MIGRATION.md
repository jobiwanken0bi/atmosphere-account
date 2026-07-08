# Railway Appview Migration

Atmosphere Account now has a Railway project for the always-on Jetstream indexer
and Railway Postgres appview database. The public web/client layer can continue
to run on Deno Deploy after the appview boundary is explicit, but any DB-backed
runtime should run on Railway or call a Railway appview API.

- Project: `Atmosphere Account`
- Project ID: `f6fc622b-1fff-469e-9bb2-42210ac4a70c`
- Environment: `production`
- Services:
  - `web` / appview runtime (`dd06ab3e-e2d0-4b53-b4a5-124794ec9b83`)
  - `indexer` (`6899add1-fe1b-4e40-a720-8e5f9bf88349`)
  - `Postgres` (`da15565c-bcbd-4c6e-8ab2-356fc8f7566c`)

Repo-side deployment files:

- `railway.indexer.Dockerfile` runs the Jetstream indexer.
- `railway.web.Dockerfile` runs the Fresh/Deno web/appview server when the
  server-side runtime is deployed on Railway.

## Current State

Completed:

- Created the Railway project.
- Created separate `web`, `indexer`, and `Postgres` services during migration.
- Added Railway Dockerfiles for both deploy targets.
- Added `deno task railway:seed-secrets` for the operator to copy local `.env`
  secrets to Railway from their own terminal.
- Imported production variables with `deno task railway:seed-secrets`.
- Applied the Postgres schema to Railway Postgres with
  `deno task db:migrate:postgres`.
- Copied appview data into Railway Postgres with `deno task db:copy:postgres`.
- Deployed `indexer` successfully to Railway against Railway Postgres.
- Verified the indexer worker lease heartbeat in Railway Postgres.
- Added Railway custom domains for `atmosphereaccount.com` and
  `www.atmosphereaccount.com`, but do not point DNS at Railway unless we
  intentionally move the public web app from Deno Deploy to Railway.
- Recreated the Railway `web` service as a Postgres-backed appview/web runtime
  for verification.
- Stopped the old Fly indexer by scaling the `worker` process group to zero.
- Seeded non-secret production variables:
  - `DENO_ENV`
  - `FRESH_PUBLIC_SITE_URL`
  - `FRESH_PUBLIC_LOGIN_URL`
  - `ATMOSPHERE_DB_BACKEND=postgres`
  - `POSTGRES_DATABASE_URL=${{Postgres.DATABASE_URL}}`
  - `POSTGRES_SSL_MODE=disable`
  - `JETSTREAM_URL`
  - `ATPROTO_FETCH_TIMEOUT_MS`
  - `COMMUNITY_APP_LEXICON_ENABLED`

Remaining cutover work:

- Keep the public website, docs, static SDK, and hosted picker on Deno Deploy.
- Treat Railway's HTTP service as the appview/API service, not the public web
  app. Renaming the Railway service from `web` to `appview` is recommended once
  the current release is stable.
- Set `ATMOSPHERE_APPVIEW_URL` on Deno Deploy to the Railway appview service URL
  after the Railway service is verified.
- Keep production DNS on Deno Deploy unless we intentionally decide to leave the
  Deno architecture later.
- Remove Neon and Turso runtime variables only after the production appview
  runtime is verified against Railway Postgres through a release window.

Codex cannot upload local `.env` secrets to Railway directly in this
environment, even with operator approval. Run this locally from the repo root
instead:

```sh
deno task railway:seed-secrets
```

## Required Secret Variables

Set these on `web` and `indexer`:

- `ATMOSPHERE_DB_BACKEND=postgres`
- `POSTGRES_DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `POSTGRES_SSL_MODE=disable`
- `ATMOSPHERE_DID`
- `ATSTORE_REPO_DID` if configured
- `ATSTORE_SOCIAL_REPO_DIDS` if configured

Keep `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` only for rollback or legacy
inspection while the cutover is fresh.

Do not copy local loopback values such as
`FRESH_PUBLIC_SITE_URL=http://127.0.0.1:5174` to production.

## Service Build Settings

Services should use Dockerfile builds:

- `web`: `railway.web.Dockerfile`
- `indexer`: `railway.indexer.Dockerfile`

If the Railway CLI readback still reports `RAILPACK`, set these in the Railway
dashboard under each service's build settings before deploying.

Set the indexer service start command to:

```sh
deno run -A --node-modules-dir=auto worker/indexer.ts
```

The `indexer` service must run one replica only. The app's `worker_lease` table
protects against duplicate consumers, but one active Railway replica avoids
wasted Jetstream/PDS/DB traffic.

## Deploy

After secrets and Dockerfile settings are in place:

```sh
railway up --service web --environment production --detach \
  -m "Deploy Atmosphere Account web/appview"

railway up --service indexer --environment production --detach \
  -m "Deploy Atmosphere Account indexer"
```

Verify:

```sh
railway logs --service web --environment production --lines 200 --json
railway logs --service indexer --environment production --lines 200 --json
```

Health checks:

- Web/appview health: check the Railway service domain or production domain for
  `GET /api/health` and `GET /api/health/ready`. Both endpoints include a
  `release` object with runtime/deployment metadata when the host provides it.
  When Deno proxies Railway readiness, the shell release remains top-level and
  the appview release appears at `appview.release`.
- Indexer health: check `GET /api/health/ready` for a fresh worker lease and
  verify `worker_lease` in Railway Postgres.
- Production smoke suite: run `deno task smoke:production` after Deno or Railway
  appview deploys. It checks liveness/readiness, OAuth metadata, JWKS, core
  HTML, standalone SDK assets, release metadata, and the hosted picker asset
  chain. The public picker remains on Deno Deploy, but its generated Fresh
  chunks are proxied from the appview bundle on trusted Atmosphere domains.

## Worker Cutover

1. Deploy `indexer` and confirm the worker lease heartbeat is fresh.
2. Stop the Fly indexer only after Railway has owned the lease for at least one
   full lease window.
3. Verify the web/appview runtime against Railway Postgres before changing any
   production DNS.
4. Keep Fly config in the repo until the Railway worker has survived at least
   one production release.

### Optional Railway Web DNS

Railway previously had custom domains registered for the optional web service.
Those are not required for the appview database/indexer migration. Do not change
Porkbun DNS while Deno Deploy remains the public web host.

If we later decide to move the public web app from Deno Deploy to Railway, set:

- `atmosphereaccount.com` CNAME/flattened CNAME/ALIAS to
  `5rld3mhe.up.railway.app`
- `www.atmosphereaccount.com` CNAME to `ikjfogeg.up.railway.app`

Railway also returned ownership verification TXT values if the DNS provider or
Railway dashboard asks for them:

- `_railway-verify.atmosphereaccount.com` TXT
  `railway-verify=3dbebdc3a0c562ef2194b9b097f54f7e153da479db69e648b70e69ed20041d45`
- `_railway-verify.www.atmosphereaccount.com` TXT
  `railway-verify=f26aed24946b90f5ed1295edaf6a42475e39c3a6cfd53b290c37541f33986f61`

After DNS propagates for a future web cutover, verify:

```sh
curl -s https://atmosphereaccount.com/api/health
curl -s https://atmosphereaccount.com/api/health/ready
```

### Stop The Old Fly Indexer

The old Fly worker was stopped from an authenticated Fly shell:

```sh
flyctl scale count 0 --process-group worker --app atmosphere-registry-indexer --yes
flyctl status --app atmosphere-registry-indexer
```
