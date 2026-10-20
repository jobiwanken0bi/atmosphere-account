# Public hosting migration to Railway

The owner approved moving the public website and hosted login from Deno Deploy
to the existing Railway web service. This separates the hosting move from a
later runtime migration. The public URLs, OAuth client IDs, callback URLs,
cookies, signing keys, Postgres, and indexer stay in place.

[Deno's announcement](https://deno.com/blog/cloudflare) gives Deploy a six-month
shutdown window from October 2026. The runtime has a longer maintenance window;
it does not need to be replaced during the DNS change.

## Prepared state

As of October 20, 2026, public DNS still points to Deno Deploy. Railway already
runs the complete compiled Fresh app, and both public domain bindings are
attached to its `web` service on port 8080. The bindings need DNS verification
and TLS certificates before the move is complete.

- Project: `f6fc622b-1fff-469e-9bb2-42210ac4a70c`
- Environment: production, `796c980c-e678-4d2f-96f8-618f326344d6`
- Web service: `dd06ab3e-e2d0-4b53-b4a5-124794ec9b83`
- Current service URL: `https://web-production-001c9.up.railway.app`
- DNS provider: Porkbun; keep its nameservers.

Pre-cutover checks passed against the live service: Railway-mode
`smoke:readiness` verified the direct payload and native deployment provenance,
and the full production smoke passed against the still-active Deno public
domains. The only workflow calling these smoke tasks is `production-smoke.yml`;
it passes the repository hosting variable to both its readiness and full jobs.

The Railway web service must keep these settings:

```text
FRESH_PUBLIC_SITE_URL=https://atmosphereaccount.com
FRESH_PUBLIC_LOGIN_URL=https://login.atmosphereaccount.com
ATMOSPHERE_DB_BACKEND=postgres
DENO_ENV=production
```

`ATMOSPHERE_APPVIEW_URL` and `APPVIEW_BASE_URL` must be unset on Railway so it
renders locally instead of proxying to itself. Keep all existing auth secrets
and the private Postgres reference. Retain the Deno deployment as a rollback
target through verification.

## DNS records

Export the existing Porkbun records before editing. Preserve unrelated records,
including mail and AT Protocol verification. Add these ownership records first;
they do not move traffic:

| Type | Host                    | Value                                                                             |
| ---- | ----------------------- | --------------------------------------------------------------------------------- |
| TXT  | `_railway-verify`       | `railway-verify=3dbebdc3a0c562ef2194b9b097f54f7e153da479db69e648b70e69ed20041d45` |
| TXT  | `_railway-verify.login` | `railway-verify=ac3c5f3728fc7ac0aa2263a3df4fe502ca384e5392e2ebf9f93f1a4253fe5879` |

Read back Railway domain status and certificate readiness. Then replace only the
web routing records, using Porkbun's apex ALIAS support:

| Type  | Host                           | Target                    |
| ----- | ------------------------------ | ------------------------- |
| ALIAS | apex (`@` or blank in Porkbun) | `kh3rch74.up.railway.app` |
| CNAME | `login`                        | `7ntmvlt9.up.railway.app` |

Remove the old apex Deno A and AAAA when adding the apex ALIAS. Keeping either
would split traffic between providers. Replace the existing login CNAME rather
than adding another. Use a short TTL during the change and check both IPv4 and
IPv6 answers. Railway may need routing DNS to finish certificate issuance;
monitor domain status and HTTPS throughout the change. Check for CAA
restrictions before requesting certificates; any configured CAA policy must
permit Railway's certificate issuer.

## Release and acceptance

The smoke checks default to `deno-deploy` until the cutover. Deploy the
monitoring support first, then test the existing production topology. After both
canonical domains serve Railway, set the repository Actions variable
`SMOKE_PUBLIC_HOSTING=railway` and dispatch Production Smoke. An explicit local
check is:

```sh
SMOKE_EXPECT_ARTIFACT_DIGEST="$(deno task release:web-digest)" \
SMOKE_ALLOWED_APPVIEW_SHAS="$(deno task release:web-changed -- --sha=HEAD --allowed-appview-shas)" \
  deno task smoke:production --public-hosting=railway
```

Railway mode requires direct readiness from one Railway deployment, the exact
web artifact digest, an allowed full native Git SHA, healthy Postgres, a fresh
indexer lease, and a fresh complete inventory. It also verifies direct island
assets on both domains. Deno mode retains its split-provider checks. Use the
default strict checks for cutover acceptance, without the diagnostic
`--no-require-appview` or `--no-proxy-header` flags. DNS propagation can briefly
make scheduled checks report a topology mismatch between the record change and
the hosting-variable switch; compare authoritative DNS and both providers before
treating that mismatch as a serving failure.

Verify both domains' TLS, canonical redirects, public directory/detail pages,
docs, SDK assets, picker rendering, OAuth metadata and JWKS, an anonymous OAuth
start, and an existing saved login session. Confirm that public JWKS match the
pre-cutover keys. Watch web CPU/RAM, response times, errors, and database
connections after traffic moves. Anonymous rendering and metadata checks inside
the existing Railway container passed before DNS changes; edge routing, TLS,
browser hydration, and saved-session continuity still require cutover checks.
In-flight OAuth flows also depend on both providers continuing to use the same
Postgres OAuth-state store, as they do before this cutover.

Hashed Fresh assets already use a one-year immutable browser cache. Public HTML
is revalidated, and private auth responses stay uncached. Railway does not
automatically replace Deno's HTML edge cache; measure public response times
after cutover before adding a CDN or an application cache.

## Rollback

Restore the exported routing records if TLS, auth, or serving checks fail. The
observed pre-cutover targets were:

- Apex A: `69.67.170.170`
- Apex AAAA: `2602:f70f::1`
- Login CNAME: `atmosphere-account.atmospheremoney.deno.net`

Remove the Railway apex ALIAS when restoring A/AAAA. Set
`SMOKE_PUBLIC_HOSTING=deno-deploy` again and rerun Production Smoke. Keep the
Railway database and services running; this rollback changes public routing.

## Runtime follow-up

Use a separate release to move the web runtime and worker to Node.js LTS.
[Fresh's deployment documentation](https://usefresh.dev/docs/deployment) still
uses `deno serve`, so changing a Docker base image alone is insufficient.

A disposable Node 24 LTS prototype can serve the current compiled UI through a
small Deno API adapter. This makes preserving the Preact components and island
assets plausible, but the adapter is an experiment, not the production runtime.
The local Node 24.22.0 probe passed homepage/docs/host rendering, island assets,
SDK delivery, invalid-picker validation, Postgres directory reads, and commit
and rollback through the compiled Postgres adapter. It used a disposable local
Postgres 16 database with a host fixture and no production credentials. This
does not establish production auth or full readiness; the fixture has no live
indexer or inventory worker.

Before choosing it over a framework replacement, validate Postgres reads and
transactions, full OAuth/session flows, DNS security checks, media generation,
streaming and aborted requests, compression, cookies, forwarding headers, and
worker WebSockets. Replace application-owned Deno calls with standard Node/Web
APIs and keep any framework compatibility boundary small and explicit.
