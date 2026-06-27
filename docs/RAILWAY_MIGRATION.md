# Railway Worker Migration

Atmosphere Account now has a Railway project for the always-on Jetstream
indexer. The public web app can continue to run on Deno Deploy while Railway
owns the worker/appview indexing process.

- Project: `Atmosphere Account`
- Project ID: `f6fc622b-1fff-469e-9bb2-42210ac4a70c`
- Environment: `production`
- Services:
  - `indexer` (`6899add1-fe1b-4e40-a720-8e5f9bf88349`)

Repo-side deployment files:

- `railway.indexer.Dockerfile` runs the Jetstream indexer.

## Current State

Completed:

- Created the Railway project.
- Created separate `web` and `indexer` services during migration.
- Added Railway Dockerfiles for both deploy targets.
- Added `deno task railway:seed-secrets` for the operator to copy local `.env`
  secrets to Railway from their own terminal.
- Imported production variables with `deno task railway:seed-secrets`.
- Deployed `web` and `indexer` successfully to Railway during migration.
- Verified `/api/health`, `/api/health/ready`, and the indexer worker lease
  before deleting the standby web service.
- Added Railway custom domains for `atmosphereaccount.com` and
  `www.atmosphereaccount.com`, but do not point DNS at Railway unless we
  intentionally move the public web app from Deno Deploy to Railway.
- Deleted the unused Railway `web` service after confirming Deno Deploy remains
  the production web host.
- Stopped the old Fly indexer by scaling the `worker` process group to zero.
- Seeded non-secret production variables:
  - `DENO_ENV`
  - `FRESH_PUBLIC_SITE_URL`
  - `JETSTREAM_URL`
  - `ATPROTO_FETCH_TIMEOUT_MS`
  - `COMMUNITY_APP_LEXICON_ENABLED`

Remaining cutover work:

- Keep production DNS on Deno Deploy unless we intentionally cut the public web
  app over to Railway later.
- Continue the separate Turso to Neon migration track in
  [INFRASTRUCTURE.md](./INFRASTRUCTURE.md).

Codex cannot upload local `.env` secrets to Railway directly in this
environment, even with operator approval. Run this locally from the repo root
instead:

```sh
deno task railway:seed-secrets
```

## Required Secret Variables

Set these on `indexer`:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `ATMOSPHERE_DID`
- `ATSTORE_REPO_DID` if configured
- `ATSTORE_SOCIAL_REPO_DIDS` if configured

Do not copy local loopback values such as
`FRESH_PUBLIC_SITE_URL=http://127.0.0.1:5174` to production.

## Service Build Settings

The `indexer` service should use Dockerfile builds:

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
railway up --service indexer --environment production --detach \
  -m "Deploy Atmosphere Account indexer"
```

Verify:

```sh
railway logs --service indexer --environment production --lines 200 --json
```

Health checks:

- Indexer health: check `GET https://atmosphereaccount.com/api/health/ready` for
  a fresh worker lease.

## Worker Cutover

1. Deploy `indexer` and confirm the worker lease heartbeat is fresh.
2. Stop the Fly indexer only after Railway has owned the lease for at least one
   full lease window.
3. Leave production DNS on Deno Deploy unless we intentionally move the public
   web app to Railway.
4. Keep Fly config in the repo until the Railway worker has survived at least
   one production release.

### Optional Railway Web DNS

Railway briefly had custom domains registered for the optional web service.
Those are not required for the worker migration. Do not change Porkbun DNS while
Deno Deploy remains the public web host.

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
