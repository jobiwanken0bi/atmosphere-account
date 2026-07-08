# Deno Deploy Migration

Atmosphere Account keeps the public web app and hosted sign-in picker on Deno
Deploy. Production was deployed to the new Deno Deploy app on June 22, 2026.

The app is selected in the Deno CLI as:

- Organization: `atmospheremoney`
- App: `atmosphere-account`
- Production app URL: `https://atmosphere-account.atmospheremoney.deno.net`
- Production custom domain: `https://atmosphereaccount.com`
- Production login domain: `https://login.atmosphereaccount.com`

Official docs:

- Deno Deploy overview: https://docs.deno.com/deploy/
- Getting started: https://docs.deno.com/deploy/getting_started/
- Classic migration guide: https://docs.deno.com/deploy/migration_guide/

## Target Runtime Split

- **Deno Deploy:** public Fresh web app, OAuth routes, hosted Atmosphere Login
  picker, docs, static SDK assets, client metadata, and JWKS.
- **Railway appview/API:** public directory read model APIs for apps, hosts,
  search, reviews, favorites, admin status, and heavier appview reads.
- **Railway indexer/jobs:** always-on Jetstream indexer, backfills, rescoring,
  and heavier background jobs.
- **Railway Postgres:** canonical appview database used by the Railway appview
  and indexer services over Railway networking.

Do not point `atmosphereaccount.com` at Railway while Deno Deploy remains the
public web host. Do not set a Railway Postgres URL on Deno Deploy as the
permanent architecture; set `ATMOSPHERE_APPVIEW_URL` and let Deno call the
Railway appview API instead.

## Current Production State

Completed:

- Authenticated the Deno CLI as Joe Basser.
- Selected `atmospheremoney / atmosphere-account`.
- Deployed a non-production revision:
  `https://atmosphere-account-8xsphfpb5py3.atmospheremoney.deno.net`
- Verified preview liveness, readiness, DB access, Railway indexer heartbeat,
  OAuth client metadata, login JWKS, and Atmosphere Login manifest.
- Deployed production revision:
  `https://console.deno.com/atmospheremoney/atmosphere-account/builds/8xsphfpb5py3`
- Verified production:
  - `GET /api/health`
  - `GET /api/health/ready`
  - `HEAD /oauth/client-metadata.json`
  - `HEAD /oauth/jwks.json`
  - `HEAD /.well-known/atmosphere-login.json`

The hosted picker route `HEAD /login/select` returns `400` without query
parameters, which is expected for an invalid login request.

## Create Or Reuse A New-Platform Deno Deploy App

Atmosphere Account already has an app in the new Deno Deploy dashboard at
`console.deno.com`. Reuse that app. If this ever needs to be recreated, remember
that Deploy Classic projects at `dash.deno.com` are not automatically
transferred.

1. Go to `https://console.deno.com`.
2. Create or choose the production organization.
3. Create or open the new-platform app for Atmosphere Account.
4. Connect the GitHub repository.
5. Use the repository root as the app root.
6. Use the Fresh/framework preset if detected. Otherwise configure it as a
   dynamic server app.

Recommended build/runtime settings:

- Install command: `deno install`
- Build command: `deno task build`
- Runtime entrypoint: `_fresh/server.js`
- Runtime command, if the UI asks for a command instead of an entrypoint:
  `deno task start`

Local verification before creating the app:

```sh
deno task build
```

## Environment Variables

Deploy Classic used one environment set. The new Deno Deploy platform supports
separate production/development contexts, so copy production secrets into the
production context first.

Required production variables for the Deno public web shell:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `SESSION_SECRET`
- `REPORT_IP_SECRET`
- `OAUTH_PRIVATE_JWK`
- `OAUTH_PUBLIC_JWK`
- `OAUTH_KID`
- `ATMOSPHERE_DID`
- `ADMIN_DIDS`
- `ATSTORE_REPO_DID` if configured
- `ATSTORE_SOCIAL_REPO_DIDS` if configured
- `FRESH_PUBLIC_SITE_URL=https://atmosphereaccount.com`
- `FRESH_PUBLIC_LOGIN_URL=https://login.atmosphereaccount.com`
- `DENO_ENV=production`
- `ATPROTO_FETCH_TIMEOUT_MS=10000`
- `ATMOSPHERE_APPVIEW_URL=https://web-production-001c9.up.railway.app`
- `APPVIEW_FETCH_TIMEOUT_MS=5000`
- `COMMUNITY_APP_LEXICON_ENABLED=false` unless intentionally enabled

Keep legacy Turso/Neon variables only while there are Deno routes still reading
from the local app database. Remove them after detail pages and authenticated
write flows are routed through the Railway appview/API or otherwise verified on
the final architecture.

Do not set local loopback values such as
`FRESH_PUBLIC_SITE_URL=http://127.0.0.1:5174` in production.

## Pre-DNS Health Checks

Before touching Porkbun DNS, use the new Deno Deploy preview/production URL and
verify:

```sh
curl -s https://<new-deno-app-url>/api/health
curl -s https://<new-deno-app-url>/api/health/ready
curl -I https://<new-deno-app-url>/login/select
curl -I https://<new-deno-app-url>/oauth/client-metadata.json
curl -I https://<new-deno-app-url>/oauth/jwks.json
```

Expected:

- `/api/health` returns `ok: true`.
- `/api/health/ready` returns `service: atmosphere-account-web-shell`, an
  `appview.ok: true` object, Railway Postgres DB OK, and a fresh Railway indexer
  heartbeat.
- Login/OAuth/JWKS routes return successfully and do not expose secrets.

## Custom Domain Cutover

Only if the production domain ever needs to be reattached:

1. Add `atmosphereaccount.com` to the new Deno Deploy app.
2. Add `login.atmosphereaccount.com` to the same Deno Deploy app.
3. Add `www.atmosphereaccount.com` if we want the new app to answer `www`.
4. Add the `_acme-challenge` CNAME records Deno provides for certificate
   provisioning.
5. Update the existing Porkbun root `ALIAS` away from the Classic
   `alias.deno.net` target and to `atmosphere-account.atmospheremoney.deno.net`.
   If Porkbun will not accept an `ALIAS`, use `A @ 69.67.170.170` and
   `AAAA @ 2602:f70f::1`.
6. Add `CNAME login atmosphere-account.atmospheremoney.deno.net` or the Deno
   Deploy-provided target for the login custom domain.
7. Do not point `www` at Deno unless `www.atmosphereaccount.com` is also added
   to the Deno Deploy app and has a valid certificate.
8. Wait for DNS and certificate validation.
9. Verify production:

```sh
curl -s https://atmosphereaccount.com/api/health
curl -s https://atmosphereaccount.com/api/health/ready
curl -I https://atmosphereaccount.com/login/select
curl -I https://login.atmosphereaccount.com/login/select
curl -I https://login.atmosphereaccount.com/oauth/client-metadata.json
curl -I https://login.atmosphereaccount.com/oauth/jwks.json
deno task smoke:picker-assets
```

Deno's migration guide says DNS propagation may take up to 48 hours. Keep any
older Deploy Classic project available until the new domain is healthy.

## Rollback

If the new Deno app fails after DNS cutover:

1. Point Porkbun root `ALIAS` back to the previous Classic target.
2. Keep Railway indexer running; do not restart the old Fly worker unless the
   Railway worker lease becomes stale.
3. Confirm:

```sh
curl -s https://atmosphereaccount.com/api/health/ready
```

## Post-Cutover Cleanup

After at least one successful production release on the new Deno Deploy app:

- Remove the domain from the Deploy Classic project.
- Keep Railway web custom domains unconfigured unless we intentionally move the
  public web app to Railway later.
- Continue the Neon migration track in [INFRASTRUCTURE.md](./INFRASTRUCTURE.md).
