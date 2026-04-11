# Atmosphere Account

Marketing site for **Atmosphere Account** — built with [Fresh](https://fresh.deno.dev/) and Deno.

## Prerequisites

- [Deno](https://docs.deno.com/runtime/getting_started/installation) (v2+)

After cloning, install dependencies (creates `node_modules/` from the lockfile):

```sh
deno install
```

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
5. **Run command:** `deno task start` (or `deno serve -A _fresh/server.js` per `deno.json`).

Adjust if your host uses different entrypoints.

## License

Open source — see project maintainers for the chosen license.
