# Atmosphere Account

[![CI](https://github.com/jobiwanken0bi/atmosphere-account/actions/workflows/ci.yml/badge.svg)](https://github.com/jobiwanken0bi/atmosphere-account/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jobiwanken0bi/atmosphere-account/actions/workflows/codeql.yml/badge.svg)](https://github.com/jobiwanken0bi/atmosphere-account/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Atmosphere Account is an open-source account, app-directory, host-registry, and
login interoperability service for the AT Protocol ecosystem. It provides the
shared "Continue with Atmosphere" account picker without becoming an OAuth token
broker or taking control away from a user's account host.

- **Live site:** [atmosphereaccount.com](https://atmosphereaccount.com)
- **Login picker:**
  [login.atmosphereaccount.com](https://login.atmosphereaccount.com)
- **GitHub:**
  [jobiwanken0bi/atmosphere-account](https://github.com/jobiwanken0bi/atmosphere-account)
- **Tangled:**
  [joebasser.com/atmosphere-account](https://tangled.org/@joebasser.com/atmosphere-account)

The project is actively developed and runs in production. Atmosphere Login v0.1
is the current compatibility contract; host lexicons that are explicitly marked
draft may still change before publication.

## What is in this repository?

- A Fresh/Deno public website and hosted account picker.
- A signed account-selection handoff with server-side verification helpers.
- An Atmosphere app directory, reviews, profiles, and shared-record tooling.
- A host directory with relay-based PDS inventory and conformance badges.
- A Railway appview, Jetstream indexer, and scheduled PDS inventory importer.
- Mock-host, conformance, OAuth, plain HTML, Fresh, and Next.js examples.
- A typed internationalization framework with locale negotiation and RTL-ready
  document metadata.

See [Architecture](./docs/ARCHITECTURE.md) for system boundaries and the
repository map. The security boundary is especially important: Atmosphere does
not store app OAuth tokens, recovery material, private keys, or PDS backups.

## Quick start

### Prerequisites

- [Deno](https://docs.deno.com/runtime/getting_started/installation) 2.7.12.
- Node/npm only for the Chromium browser installation used by the login E2E.

```sh
git clone https://github.com/jobiwanken0bi/atmosphere-account.git
cd atmosphere-account
deno install
cp .env.example .env
deno task dev:local
```

The local task uses `file:./local.db`. Seed representative local records with:

```sh
deno task dev:seed
```

Do not commit `.env`, `local.db`, `_fresh/`, or `node_modules/`; they are all
ignored.

## Checks

Run the same core checks used by CI:

```sh
deno task check
deno task test
deno task host:conformance:smoke
deno task build
```

The genuine browser flow additionally needs Chromium once:

```sh
npx playwright@1.61.1 install chromium
deno task e2e:login
```

`deno task check` includes repository community-file, local Markdown-link, and
i18n registry validation. `deno task i18n:check` runs the focused locale tests.

## Common tasks

| Task                               | Purpose                                             |
| ---------------------------------- | --------------------------------------------------- |
| `deno task dev:local`              | Start local development with a file-backed DB       |
| `deno task dev:seed`               | Add representative local records                    |
| `deno task build`                  | Build the Fresh production bundle                   |
| `deno task test`                   | Run the complete unit/integration test suite        |
| `deno task e2e:login`              | Exercise picker → signed verification → OAuth start |
| `deno task host:conformance:smoke` | Validate the bundled mock PDS                       |
| `deno task pds:index -- --dry-run` | Preview the relay PDS inventory                     |
| `deno task smoke:production`       | Smoke the public shell and picker assets            |
| `deno task db:migrate:postgres`    | Apply the Railway Postgres schema                   |

Operational and migration commands are documented in
[Infrastructure](./docs/INFRASTRUCTURE.md); they are not required for ordinary
UI, documentation, SDK, or i18n contributions.

## Internationalization

English is currently the only shipped locale, but the catalog contract is
designed for independent translation contributions:

- BCP 47 locale tags and text direction are registered in
  [`i18n/locales.ts`](./i18n/locales.ts).
- [`i18n/messages/en.tsx`](./i18n/messages/en.tsx) defines the complete typed
  catalog shape while allowing translated string values.
- Locale negotiation honors an explicit cookie and `Accept-Language`.
- Rendered documents emit `Content-Language`; multi-locale builds also emit the
  cache variance required to prevent cross-language responses.

Read [Internationalization](./docs/INTERNATIONALIZATION.md) before adding a
locale or new user-facing copy.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Atmosphere Login v0.1](./docs/ATMOSPHERE_LOGIN.md)
- [Integration examples](./docs/ATMOSPHERE_LOGIN_INTEGRATIONS.md)
- [Host dashboard](./docs/HOST_DASHBOARD.md)
- [Host lexicon draft](./docs/HOST_LEXICON.md)
- [Internationalization](./docs/INTERNATIONALIZATION.md)
- [Infrastructure](./docs/INFRASTRUCTURE.md)
- [Database recovery](./docs/DATABASE_RECOVERY.md)
- [Platform roadmap](./docs/ACCOUNT_PLATFORM_ROADMAP.md)

## Contributing

Contributions are welcome through either forge. GitHub is the canonical issue,
security, and CI surface; Tangled is a first-class source mirror and accepts
issues, forks, and pull requests. Maintainers mirror accepted changes so both
`main` branches stay identical.

Start with [CONTRIBUTING.md](./CONTRIBUTING.md), and follow the
[Code of Conduct](./CODE_OF_CONDUCT.md). General help belongs in the public
support channels described in [SUPPORT.md](./SUPPORT.md); suspected
vulnerabilities must follow [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © Joseph Basser. Contributions are accepted under the same
license.
