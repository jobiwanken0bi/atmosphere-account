# Railway web cutover audit and staging rehearsal

Audit date: 2026-10-23. Production DNS, services, variables, signing keys, and
database were not changed. No branch was merged.

## Recommendation

Keep Fresh and Deno, and serve the public web app from Railway alongside the
existing Railway appview/database/workers. The application already has a working
Docker build and Postgres adapter. No framework rewrite or production database
migration is needed for this hosting cutover.

For production, the existing `web` service can serve both
`atmosphereaccount.com` and `login.atmosphereaccount.com`. The rehearsal uses
two services because each service gets one generated Railway domain; this also
exercises shared database state and signing keys across processes. It does not
establish a requirement for two production web services.

## Verified production baseline

Project: `f6fc622b-1fff-469e-9bb2-42210ac4a70c` (Atmosphere Account). Production
environment: `796c980c-e678-4d2f-96f8-618f326344d6`.

| Surface                          | Current provider | Observed result                                   |
| -------------------------------- | ---------------- | ------------------------------------------------- |
| Main public domain               | Deno Deploy      | Health 200; release `8axk9cp2kp9d`                |
| Login public domain              | Deno Deploy      | Same release; readiness redirects to main         |
| Railway `web`                    | Railway          | Healthy Postgres; fresh indexer and PDS inventory |
| Postgres, indexer, PDS inventory | Railway          | Existing production deployments healthy           |

The Deno main site's readiness response identifies the existing Railway appview:
`https://web-production-001c9.up.railway.app`. Its database backend is already
Postgres. The Deno shell and Railway web report the same source artifact digest:
`web-source-v1:sha256:7837a826f99ddc7f8291f7885eaef410b9f0ce32ebbf7585f74a2b907d8242c7`.

Main, login, and Railway public JWKS documents match. Their canonical JSON
SHA-256 is `942d88c331aa3c1272aa8cd940377ef0e0f363da8f70e7f2baa9270a04157286`.
This verifies public signing-key alignment; it does not prove equality of
private session or encryption secrets.

The production Railway web service was using roughly 0.19–0.21 GB of memory in
the two samples returned for the preceding hour. This is a baseline observation,
not a load test or a forecast for consolidated public traffic.

No runtime `Deno.openKv`, `Deno.Kv`, or `Deno.cron` dependency was found. The
container binds `0.0.0.0` and honors `PORT`; the existing image installs
jemalloc and uses Deno 2.8.3. Persistent application state belongs in Postgres,
not the container filesystem.

## Cutover blockers and checks

1. **Production Railway custom-domain ownership and TLS are not ready.** Both
   domains are attached to the production web service, but Railway reports
   `Verified: no` and `CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP`. A local
   `curl --connect-to` probe to the Railway service failed hostname certificate
   validation. TLS verification was not disabled. Domain sync `ACTIVE` alone is
   not a certificate-readiness signal.
2. **Preserve all existing production secret values.** Keep `SESSION_SECRET`,
   OAuth signing keys and kid, and the effective OAuth storage encryption key
   unchanged through cutover. Production Railway currently has no explicit
   `OAUTH_STORAGE_KEYS`; encryption falls back to a key derived from
   `SESSION_SECRET`. Adding a fresh storage key without retaining the old
   effective key would make existing encrypted grants unreadable. Staging uses
   newly generated secrets and provides no evidence about old-cookie continuity.
3. **The original preview checkout was not a release candidate.** Its full type
   check reported 11 errors from stale auth models. The production release was
   subsequently ported onto current main (`fe85419`) in an isolated worktree,
   preserving newer auth and hosting fixes. Full checks and 1,299 tests pass (2
   ignored); the dependency audit, host conformance smoke, and compiled build
   pass. Independent review covers the integrated delta. The owner waived the
   Claude-specific review requirement for this project on October 23, 2026.
4. **Validate production target ports before routing traffic.** Both existing
   custom domains target port 8080. The rehearsal explicitly uses port 8000 for
   `PORT`, public domains, and health checks. Keep all three aligned with the
   actual production runtime listener; do not assume the rehearsal port is the
   correct existing production value.
5. **Validate production-specific cookie and rollout continuity.** Staging real
   identity-only OAuth, callbacks, saved accounts, shared encryption/signatures,
   and browser-session survival across deployment now pass. Existing production
   cookies, old encrypted grants, an in-flight Deno-to-Railway OAuth transition,
   and production cross-domain remembered-account sharing still need explicit
   verification. The generated staging domains cannot reproduce the
   parent-domain cookie scope of the real site and login subdomain.
6. **Retain observability and recovery.** Confirm current backup/restore
   coverage before the eventual change. Railway deployment health checks gate
   activation but do not monitor a deployment continuously after activation.
   Keep external health and auth monitoring. Keep the Deno release available
   through the rollback window.

Current future DNS targets reported by Railway (recorded, not applied):

| Name    | Future CNAME target       | Additional ownership record                            |
| ------- | ------------------------- | ------------------------------------------------------ |
| `@`     | `kh3rch74.up.railway.app` | `_railway-verify` TXT; obtain value from Railway       |
| `login` | `7ntmvlt9.up.railway.app` | `_railway-verify.login` TXT; obtain value from Railway |

Public DNS still points to Deno. Capture a full DNS export, existing apex and
login record types/values, TTLs, and proxy settings before any later change; do
not use this table as a complete rollback DNS record set.

## Isolated staging resources

Environment: `cutover-rehearsal` (`9dd6cd28-ceaf-4167-8325-fa58cabff097`),
created empty without duplicating production configuration.

| Service         | ID                                     | Endpoint                                                 |
| --------------- | -------------------------------------- | -------------------------------------------------------- |
| `cutover-web`   | `3fd66b11-d059-4783-bddf-cceb5d5e5393` | <https://cutover-web-cutover-rehearsal.up.railway.app>   |
| `cutover-login` | `3ef741b9-59b3-4749-82e3-eb3156e950e5` | <https://cutover-login-cutover-rehearsal.up.railway.app> |
| `Postgres-nNi-` | `a9b851ec-04f0-4082-9d4c-cccc345d2d0f` | Private database; no public TCP proxy                    |

Both app services use the existing `railway.web.Dockerfile`, production mode,
the isolated database via a Railway reference variable, and the two staging
origins. Appview proxy variables are empty. Six fresh secrets were generated in
memory and sent through CLI stdin to both staging services. No production
secret, production database contents, or staging-persona credential was copied.

No staging indexer or inventory worker was started. Therefore freshness and
`degraded` warnings are expected and must remain visible; this rehearsal does
not exercise a running ingestion pipeline.

Source snapshot:

- Base commit: `ee0497d2ad3b695bce7b39564bf79c076b1a67f1`.
- Branch: `agent/progressive-auth-ux-security`, with existing uncommitted work.
- Snapshot manifest digest:
  `15fbac8968e03f4ff239259a2cad9539e2f4b85e81e635b9557dae3143be5c82`.
- Release ID: `cutover-rehearsal-15fbac8968e0`.
- Source upload contains tracked and non-ignored working-tree files, excludes
  dotenv secrets, local databases, dependency/build folders, repository and
  agent metadata, and symlinks.
- Four synthetic `.ui-preview.example` host fixtures are the only intended seed
  data. Their signup endpoints are synthetic and cannot complete real signup.
- A temporary, environment-ID-guarded pre-deploy bootstrap checks that `pg_trgm`
  already exists, removes the extension-install statement from the schema,
  applies the application schema, and inserts those synthetic hosts.

Local rehearsal files and filtered evidence are under
`/private/tmp/account-cutover-audit/`. The snapshot contains
`rehearsal/bootstrap.ts`, `rehearsal/hosts.json`, and `rehearsal/snapshot.json`;
these temporary files are not a general production migration workflow. Railway
retains the uploaded source artifact. The manifest digest identifies the
uploaded working tree, not a reviewed Git release or container digest.

## Application changes and validation

- Host info controls now align beneath the avatar on mobile and desktop. The
  control retains its separate button semantics and opens the existing mobile
  bottom sheet / desktop dialog. Descriptions remain out of the list rows.
- Login-domain routing now serves `/api/health`, `/api/health/ready`, and
  `/api/login/account-hosts` and `/api/identity/preview` locally. Previously
  health and host-search requests were redirected to the main domain. Ordinary
  app pages remain redirected.
- The first live login-origin probe returned the main origin's OAuth client ID
  and callback. Railway terminates TLS before forwarding HTTP to Deno; the old
  origin check required the request's scheme to match configured HTTPS exactly.
  Public origin resolution now recovers HTTPS for an exact configured request
  host, including port matching. Unknown hosts and arbitrary
  forwarded-host/proto headers do not gain trust. Regression tests exercise
  distinct staging origins. A subsequent live probe confirmed the login origin's
  own client ID and callback.
- Browser form helpers now read action/method attributes rather than native form
  properties that named controls can shadow. A hidden field named `action` was
  interfering with enhanced sign-in submission. The live corrected form
  completed OAuth and returned to the signed-in account dashboard.
- Docker exclusions now cover additional `.env.*` files, SQLite sidecar files,
  and local agent/cloud configuration directories.
- Added `scripts/smoke-railway-cutover.ts`, requiring explicit staging origins
  and an expected release ID. It rejects production Atmosphere domains and
  checks both origins' direct Postgres readiness, OAuth metadata/JWKS,
  host-search JSON, create-account HTML, CSS, recursively imported island
  assets, origin redirects, and rejection of cross-origin POSTs. It reports
  missing worker freshness.

Focused validation: **89 tests passed** across the sign-in form and route,
origin resolution, login-domain routing, create-account host eligibility, i18n,
CSRF/security, and the browser sign-in/handoff/skeleton helpers. Focused lint,
formatting and type checks pass. The original preview checkout’s separate
full-project type-check blockers listed above remain unresolved.

Mobile and desktop local browser checks confirm avatar/info alignment, separate
signup links, 44px mobile hit areas, no horizontal page overflow at narrow
widths, dialog opening, Escape dismissal, and focus restoration. The deployed
Railway create-account page also loaded its four fixtures and opened/dismissed
host details with working island hydration.

### Rehearsal status: passed for the web cutover scope

The operator installed `pg_trgm`; a read-only check confirmed it before
retrying. The environment-guarded pre-deploy bootstrap then initialized **44
application tables** and **four synthetic host fixtures**. Both app services and
the isolated Postgres service are healthy.

Final deployment IDs:

- Web: `dcec1f2a-f2b8-4a92-a074-e3540ed552f9`.
- Login: `697d3ab1-30d4-4d18-b412-2a0a920f74b1`.
- Expected release on both: `cutover-rehearsal-15fbac8968e0`.

The full live smoke passed on both origins: direct Postgres readiness, exact
release, origin-correct OAuth client IDs/callbacks/JWKS, matching public signing
keys, host search and expected fixtures, identity preview, create-account HTML,
one stylesheet and 13 recursively imported JavaScript assets per origin,
site-to-login/login-to-site redirects, and foreign-Origin POST rejection (403)
on `/oauth/login`. The real staging persona's identity preview also returned an
exact DID match on both origins. Inventory/indexer freshness warnings are
expected: no staging ingestion workers were started.

Cross-service persistence rehearsal passed:

- Web minted a disposable synthetic app session and remembered-account cookie,
  encrypted its temporary test payload, and stored it in staging Postgres.
- Login decrypted that payload, verified the session HMAC and persisted session,
  and verified the remembered-account signature using its own service process.
- Secure, HttpOnly, and SameSite=Lax session-cookie flags were verified.
- The synthetic session and temporary state row were removed; a read-only check
  found zero leftover synthetic sessions. No cookie, token or secret was
  printed.

Real OAuth browser rehearsal passed with `stagingsupporter.bsky.social`:

- Both origin-specific clients reached the real Bluesky authorization server,
  requested identity-only access, and completed their callbacks/token exchanges.
- Primary-origin login reached the signed-in account dashboard and displayed a
  saved account. Reloading after the final web deployment retained that session.
- The corrected JavaScript form, including its hidden `action` field, completed
  another login and returned to the account dashboard.
- Stored persona grants were encrypted and their checked scopes were `atproto`.
  No repo/profile write permission was requested and no account repository
  record was changed. Existing browser authentication was sufficient; no
  staging-persona credential was copied or printed.

Cookie-scope limitation: the generated Railway domains are separate hosts. An
active app-session cookie created by login-origin OAuth stays on the login host;
its subsequent redirect to main-origin `/account` does not transfer that cookie.
The normal primary-origin account-management sign-in succeeds. Staging therefore
verifies each origin's OAuth and service persistence, but cannot attest to the
production parent-domain remembered-account cookie or existing production-cookie
continuity. Do not widen cookie scope to a shared Railway hosting suffix.

Evidence is in `/private/tmp/account-cutover-audit/`: `final-full-smoke.log`,
`session-rehearsal.jsonl`, `staging-state.json`, `final-focused-tests.log`, and
the snapshot manifest/summary. Screenshots are saved with this chat's
visualization artifacts. The rehearsal does not test account creation at the
synthetic hosts, a running ingestion pipeline, production DNS/TLS,
higher-privilege app workflows, load/latency under public traffic, or backup
restoration.

To repeat the public checks against the deployed rehearsal:

```sh
deno run --allow-net --allow-env scripts/smoke-railway-cutover.ts \
  --site-origin=https://cutover-web-cutover-rehearsal.up.railway.app \
  --login-origin=https://cutover-login-cutover-rehearsal.up.railway.app \
  --expected-release-id=cutover-rehearsal-15fbac8968e0 \
  --expected-host=harbor.ui-preview.example
```

## Production sequence (authorized separately on October 23, 2026)

1. Review the successful web rehearsal and decide whether additional
   higher-privilege app workflows, ingestion, load or restore rehearsals are
   required before release.
2. Choose a clean, reviewed release, pass required CI, and obtain independent
   approval covering its implementation. Verify compatibility with the existing
   production schema and preserve all branch protections.
3. Verify effective production session/encryption secrets and signer continuity;
   keep canonical site/login URLs unchanged. Keep the existing production DB and
   workers. Remove shell-to-appview self-proxy configuration from any public
   Railway web service.
4. Confirm listener/target/health-check ports, backup and recovery coverage,
   custom-domain ownership and valid TLS, and export existing DNS records.
   Deploy the reviewed Railway release without changing public DNS.
5. With separate production cutover authorization, change only the intended
   public DNS routes. Verify exact releases, certificates, both OAuth client
   IDs, asset delivery, host search, fresh workers, and login/callback/session
   flows.
6. If verification fails, restore the exported Deno DNS records. Keep DB,
   secrets, and schema compatible while old and new routing may coexist. Do not
   roll back or delete shared production data as part of a web-hosting rollback.

The staging resources remain available and incur normal Railway resource usage
until explicitly cleaned up. No production cutover should be inferred from a
successful staging build.

## Platform references

- [Railway environments](https://docs.railway.com/environments)
- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway deployment health checks](https://docs.railway.com/deployments/healthchecks)

## Integrated production release preparation — October 23, 2026

The release is based on current main, not the older preview branch. It carries
only the host chooser presentation, origin/health routing fixes, Docker context
exclusions, and this rehearsal evidence. The latest main already includes the
form-property shadowing fixes. The host-details button now says “Continue”.

Production readback confirms port 8080, 50 public tables, and an installed
`pg_trgm` extension. The Postgres migration runner now verifies that extension
and excludes its installation statement; a missing extension blocks deployment
for the database operator to install it. Existing schema locking and seed sync
remain in place. No schema change or auth-key rotation is required.

Porkbun’s existing records were saved before any edits. Railway ownership TXT
records have been added and resolve publicly; routing still points to Deno while
release validation completes. Mail, AT Protocol records, and nameservers are
unchanged. Final cutover acceptance follows `RAILWAY_PUBLIC_HOSTING.md`.

The integrated browser rehearsal exposed an additional current-main canonical
HTML redirect loop behind Railway TLS termination. The canonical browser guard
now shares the exact configured-host recovery helper used by OAuth. Requests for
unknown hosts and mismatched ports still canonicalize. The staging smoke now
sends browser HTML headers and verifies each service’s native deployment ID and
the expected shared artifact digest. API-only probes did not expose this
browser-navigation failure.

The Railway dashboard confirms PITR coverage through the current day and
scheduled daily, weekly and monthly volume backups (latest daily: October 23).
The provider’s October 21 security incident is still under investigation; its
preliminary report says attacker access was closed October 22 at 03:32 UTC and
builds are restored. It recommends rotating secrets stored before October 21.
Credential rotation is a separate operation from this hosting cutover; no
production auth key has been changed by this release.
