# Atmosphere Account

Marketing site for **Atmosphere Account** — built with
[Fresh](https://fresh.deno.dev/) and Deno.

Open source under the [MIT License](./LICENSE). Contributions welcome — fork the
repo on either [GitHub](https://github.com/jobiwanken0bi/atmosphere-account) or
[tangled](https://tangled.sh/@joebasser.com/atmosphere-account) and open a PR.

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

`start` serves the app from `_fresh/server.js` (created by `build`).

## Deploy (Deno Deploy)

1. Push this repository to GitHub (or GitLab).
2. In [Deno Deploy](https://dash.deno.com/), create a project from the repo.
3. Set **Root directory** to the repository root (this folder).
4. **Build step:** `deno task build`
5. **Run command:** `deno task start` (or `deno serve -A _fresh/server.js` per
   `deno.json`).

Adjust if your host uses different entrypoints.

## Contributing

PRs and forks welcome on either forge:

- **GitHub:** https://github.com/jobiwanken0bi/atmosphere-account
- **tangled:** https://tangled.sh/@joebasser.com/atmosphere-account

Both forges mirror the same `main` branch.

## License

[MIT](./LICENSE) © Joseph Basser
