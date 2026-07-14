# Architecture

Atmosphere Account is split into a public shell, a database-backed appview, and
short- or long-running workers. This keeps the globally cached website away from
direct production database access while preserving a small operational
footprint.

## Runtime components

| Component     | Runtime          | Responsibility                                          |
| ------------- | ---------------- | ------------------------------------------------------- |
| Public shell  | Deno Deploy      | Website, docs, login picker, OAuth metadata, SDK assets |
| Web/appview   | Railway          | Postgres-backed APIs, authenticated writes, readiness   |
| Indexer       | Railway          | Jetstream records, worker lease, derived directory data |
| PDS inventory | Railway cron     | Relay `listHosts` scan and complete-scan heartbeat      |
| Database      | Railway Postgres | Appview records, leases, cursors, conformance results   |

The public shell calls the Railway appview through its public API. It must not
receive a permanent Railway Postgres URL. Production provenance is exposed by
the health endpoints and verified with an exact-commit smoke test.

## Request and data flow

1. A browser requests the Deno shell or the dedicated login domain.
2. Public directory reads are served or proxied through the Railway appview.
3. Account selection produces a short-lived, signed, audience-bound handoff.
4. The relying app verifies that handoff and starts its own AT Protocol OAuth
   flow directly with the selected account's authorization server.
5. Jetstream and scheduled relay inventory update the Postgres-backed appview.

Atmosphere Login never exchanges or stores the relying app's OAuth token.

## Repository map

| Path          | Contents                                                     |
| ------------- | ------------------------------------------------------------ |
| `routes/`     | Fresh pages, APIs, OAuth, login, account, and admin routes   |
| `components/` | Server-rendered reusable UI                                  |
| `islands/`    | Hydrated interactive UI                                      |
| `lib/`        | Domain, protocol, database, security, and integration logic  |
| `worker/`     | Long-running Jetstream indexer                               |
| `scripts/`    | Migrations, smoke tests, importers, conformance, maintenance |
| `i18n/`       | Locale registry, negotiation, typed catalogs, provider       |
| `lexicons/`   | AT Protocol record schemas                                   |
| `static/`     | Public SDKs, examples, styles, images, and schemas           |
| `docs/`       | Public contracts, runbooks, architecture, and roadmap        |
| `sql/`        | Baseline relational schema for migration tooling             |

Keep HTTP parsing and rendering in routes, reusable policy in `lib/`, and
one-off/operator entrypoints in `scripts/`. Database changes must update the
runtime migration path, baseline schema, and migration tests together.

## Trust boundaries

- Return URLs and signed-token bindings are exact-match validated.
- Selection tokens are short-lived and include a replay identifier.
- Relying apps own OAuth tokens and must reject replayed selection IDs.
- PDS account controls, recovery, export, deletion, and migration remain on
  host-owned pages.
- Host records are self-asserted; conformance and local verification are
  separate signals.
- The database retains raw relay PDS inventory and status history, while the
  public host directory exposes only reachable providers with an explicit
  public-intent signal. That signal can come from a claimed or verified profile,
  curated seed, safe signup URL, or conservative `describeServer` enrichment;
  claiming is not required for an otherwise public provider to appear. A
  self-published host record can supply profile metadata, but does not by itself
  establish control of a domain or make an unverified PDS public. Observed-only
  personal PDSes are not directory entries.
- Admin routes are deny-by-default when no admin DID is configured.
- Public images and SVGs are proxied or sanitized with restrictive headers.

See [Atmosphere Login](./ATMOSPHERE_LOGIN.md),
[Host lexicon](./HOST_LEXICON.md), and [Security policy](../SECURITY.md) for the
detailed contracts.

## Internationalization

Locale middleware resolves a canonical BCP 47 tag from the explicit locale
cookie, then `Accept-Language`, then the default locale. The document receives
matching `lang` and `dir` attributes. Catalog structure is checked at compile
time, while runtime tests validate registration, non-empty messages, locale
names, and cache headers. See [Internationalization](./INTERNATIONALIZATION.md).

## Development and operations

Ordinary contributions can use the file-backed local database and do not need
hosted credentials. Production topology, migrations, backup policy, and exact
smoke commands live in [Infrastructure](./INFRASTRUCTURE.md) and
[Database recovery](./DATABASE_RECOVERY.md).
