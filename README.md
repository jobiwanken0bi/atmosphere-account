# Atmosphere Account

Marketing site for **Atmosphere Account** — built with
[Fresh](https://fresh.deno.dev/) and Deno.

Open source under the [MIT License](./LICENSE). Contributions welcome — fork the
repo on either [GitHub](https://github.com/jobiwanken0bi/atmosphere-account) or
[tangled](https://tangled.org/@joebasser.com/atmosphere-account) and open a PR.

## Prerequisites

- [Deno](https://docs.deno.com/runtime/getting_started/installation) (v2+)

After cloning, install dependencies (creates `node_modules/` from the lockfile):

```sh
deno install
```

Copy [`.env.example`](./.env.example) to `.env` and fill in the variables for
the surface you are running. Local development can use `file:./local.db`; the
production appview/indexer runtime uses Railway Postgres.

## Development

```sh
deno task dev
```

Opens the Vite dev server with hot reload.

## Production build

```sh
deno task build
deno task start
```

`build` runs `deno install` then `vite build` so a clean clone (and Deno Deploy)
gets `node_modules` before Vite runs. `start` serves from `_fresh/server.js`.

## Deploy (Deno Deploy)

1. Push this repository to GitHub (or GitLab).
2. In [Deno Deploy](https://console.deno.com/), create an app from the repo.
3. Set **Root directory** to the repository root (this folder).
4. **Build step:** `deno task build` (installs npm deps, then runs Vite —
   required on Deploy)
5. **Run command:** `deno task start` (or `deno serve -A _fresh/server.js` per
   `deno.json`).

The public Deno Deploy app should remain the main website and login picker. Set
`ATMOSPHERE_APPVIEW_URL` on Deno Deploy when it should read public appview data
from Railway's appview API. Do not set a Railway Postgres database URL on Deno
Deploy as the permanent architecture.

If production is still on Deploy Classic (`dash.deno.com` / `alias.deno.net`),
migrate it to the new Deno Deploy platform before the Classic shutdown. See
[docs/DENO_DEPLOY_MIGRATION.md](./docs/DENO_DEPLOY_MIGRATION.md).

Adjust if your host uses different entrypoints.

## Infrastructure

See [docs/INFRASTRUCTURE.md](./docs/INFRASTRUCTURE.md) for the current
production shape:

- Fresh/Deno web app
- Railway appview/indexer services
- Railway Postgres appview database

The Railway cutover runbook is in
[docs/RAILWAY_MIGRATION.md](./docs/RAILWAY_MIGRATION.md). The old Fly indexer
has been scaled to zero; Railway now owns the worker lease.

Useful operational commands:

```sh
deno task db:migrate
deno task db:migrate:neon
deno task db:backfill:neon
deno task db:diff:neon
deno task db:migrate:postgres
deno task db:copy:postgres
deno task db:smoke
deno task smoke:production
deno task db:maintain
deno task backfill:atstore
deno task rescore:app-trending
```

The Postgres migration/copy commands are used for Railway Postgres. The older
Neon commands are retained for comparison and rollback/migration experiments.
`smoke:production` runs the public-shell and picker asset smoke checks.
`smoke:public-shell` checks production liveness/readiness, OAuth metadata, JWKS,
core HTML pages, and standalone SDK assets. `smoke:picker-assets` verifies the
hosted picker HTML, CSS, static scripts, generated Fresh assets, and imported
chunks from both the login and main Atmosphere domains.

Health endpoints:

- `/api/health` — liveness, no DB dependency
- `/api/health/ready` — DB readiness and indexer heartbeat

## Contributing

PRs and forks welcome on either forge:

- **GitHub:** https://github.com/jobiwanken0bi/atmosphere-account
- **tangled:** https://tangled.org/@joebasser.com/atmosphere-account

Both forges mirror the same `main` branch.

## License

[MIT](./LICENSE) © Joseph Basser
