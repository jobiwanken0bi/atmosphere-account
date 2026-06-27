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

Copy [`.env.example`](./.env.example) to `.env` and set `TURSO_AUTH_TOKEN` from
the [Turso](https://turso.tech/) dashboard (the example file already points at
this project’s database URL). For Explore, OAuth, and the indexer you will also
need the variables listed in that file.

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

Remote Turso (`libsql://…`) uses `@libsql/client/web` so the deploy runtime does
not need native `@libsql/*` platform binaries. Local `file:./local.db` still
uses the full client when running `deno task dev`.

If production is still on Deploy Classic (`dash.deno.com` / `alias.deno.net`),
migrate it to the new Deno Deploy platform before the Classic shutdown. See
[docs/DENO_DEPLOY_MIGRATION.md](./docs/DENO_DEPLOY_MIGRATION.md).

Adjust if your host uses different entrypoints.

## Infrastructure

See [docs/INFRASTRUCTURE.md](./docs/INFRASTRUCTURE.md) for the current
production shape:

- Fresh/Deno web app
- Railway-targeted always-on Jetstream indexer
- Turso/libSQL appview database

The Railway cutover runbook is in
[docs/RAILWAY_MIGRATION.md](./docs/RAILWAY_MIGRATION.md). The old Fly indexer
has been scaled to zero; Railway now owns the worker lease.

Useful operational commands:

```sh
deno task db:migrate
deno task db:migrate:neon
deno task db:backfill:neon
deno task db:diff:neon
deno task db:smoke
deno task db:maintain
deno task backfill:atstore
deno task rescore:app-trending
```

The Neon migration/backfill/diff commands load `.env` automatically for Turso
source credentials, while preserving any `NEON_*` URL exported in the shell.

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
