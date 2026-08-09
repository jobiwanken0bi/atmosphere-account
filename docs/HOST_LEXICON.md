# Atmosphere Host Lexicon Draft

This is the first-pass record model for making the Hosts page protocol-native.
The namespace is `account.atmosphere.host.*`.

## Goals

- Let PDS hosts publish their own public host metadata.
- Keep host records user-readable and appview-indexable.
- Separate self-declared host metadata from site verification.
- Support host account routing and optional compatibility metadata without
  making this site the authority for keys, backups, devices, grants, or
  recovery.
- Treat the host-published account page as the primary account-management
  surface; `/account` on the PDS is the recommended convention when it exists.
- Make the Hosts page dynamic from AT Protocol records plus local moderation.

## Records

### `account.atmosphere.host.profile`

One `self` record per host/operator account.

Use this for brand-level metadata:

- name
- description
- operator type
- images such as avatar, logo, banner, hero, and social card
- public links such as homepage, signup, support, account page, terms, and
  privacy
- public support/contact links
- optional references to `host.service` records

Example authors:

- `bsky.app` for Bluesky-operated hosts
- `pckt.blog` for pckt
- `margin.at` for Margin
- `npmx.dev` for npmx
- `blackskyweb.xyz` for Blacksky

The profile follows the community app profile style: a fixed `self` record,
minimal required fields, flexible optional arrays for links and images, and
token-backed `knownValues` so future host directories can add new roles without
breaking old records.

This site's claim and management flow should prefill this profile from the
signed-in account's existing microblog profile when possible. If the host
uploads a custom avatar or logo, the image is uploaded to the host account's PDS
as a blob and referenced from the `images` array; this site does not need R2 for
these public host profile images.

### `account.atmosphere.host.service`

One record per PDS host, hostname, or host cluster.

Use this for the actual Hosts page entry:

- canonical host address, such as `pckt.cafe`
- friendly display name
- PDS service endpoint
- optional account management URL for a known-working host-owned account page
- signup status and URL
- optional compatibility manifest URL
- host match patterns, such as `bsky.network` and `*.bsky.network`
- account-control capabilities
- public links and contact

AppViews should dedupe on normalized `host`, then apply local verification and
moderation.

Creating a host listing should publish both records:

- `account.atmosphere.host.profile/self`
- `account.atmosphere.host.service/{normalized-host}`

Editing the public host profile should republish the profile and refresh the
service record reference. Editing account-page routing should republish the
service record without rewriting the profile unless profile fields changed.

### `account.atmosphere.host.defs`

Shared object definitions for links, signup state, contact details, software
metadata, and host capabilities.

## Verification Model

Host records are self-asserted. They should not automatically make a host
"verified" in this directory.

For new production claims, this site derives operator authority from one proof:
a short-lived, one-time TXT challenge placed at the exact host domain. Service
reachability, email, social handles, host records, curated profile mappings,
conformance checks, and local moderation can inform directory metadata, but they
do not grant host management.

A future standardized, bidirectional PDS operator declaration may add another
claim proof after the declaration exists in a PDS specification and reference
implementation. It is not part of the current claim flow.

This means a host card can show the publishing account, while "verified" remains
a site-local or conformance-test result. A self-published record alone does not
prove that the author controls every hostname it names.

## Claim Proof

This site accepts these claim paths:

- Production: a short-lived, single-use TXT value at
  `_atmosphere-account.<host>`. The challenge is bound to the exact directory
  host and signed-in account DID, then consumed in the same transaction that
  records ownership.
- Development only: explicit local `.test` fixtures for visual testing.

Contact-email claims completed before the DNS-only policy remain operational so
existing managers are not silently locked out. New email claims and email-based
manager changes are not accepted.

An operator claims a production host by finding the exact PDS domain in the
detected-host flow, signing in with the account that should manage the listing,
and requesting a DNS challenge. They publish the displayed TXT value at
`_atmosphere-account.<host>` and ask the site to check it before the challenge
expires. The TXT value can be removed after the claim succeeds.

This site does not accept an email address, social handle, host record, or
product-specific HTTPS well-known file as ownership proof. Those values can
remain useful profile metadata, but only the DNS challenge establishes a new
production claim or completes a manager change.

## Hosts Page Read Model

The Hosts page read model merges:

- Seeded host records for known hosts.
- Observed PDS endpoints from account sign-ins.
- Indexed `account.atmosphere.host.profile` records.
- Indexed `account.atmosphere.host.service` records.
- Local verification, moderation, and conformance state.

Display precedence:

1. Verified local curation for safety-critical fields.
2. `host.service` record fields for the host domain, service endpoint, signup
   posture, account-management URL, host patterns, and capability declarations.
3. `host.profile` brand fields for name, description, avatar/logo, links, and
   support details when they match the host or service reference.
4. Observed host fallback.
5. Seed fallback.

Public UI should continue to use friendly names first, for example "Hosted by
Bluesky", while technical endpoints stay behind disclosures.

Implementation notes:

- Raw protocol records are stored in `host_record`.
- The merged public listing remains `account_host`.
- Indexing a self-declared record does not prove control of its host domain or
  independently grant public-directory eligibility. Unclaimed hosts still need a
  safe signup URL or conservative public-intent detection from their PDS.
- Jetstream indexes `account.atmosphere.host.profile` and
  `account.atmosphere.host.service` records as they change.
- `deno task backfill:hosts [handle ...]` reads existing host records directly
  from each operator account's PDS and reuses the same parser/upsert path.
- Host detail pages expose indexed source records in the technical disclosure so
  operators can see which AT records shaped the listing.

## Host and App Relationships

This site keeps the existing DID-based host/app match as a fallback so imported
ATStore listings do not become disconnected. Claimed host owners and verified
app owners can override that inference from their management pages with one of
three explicit relationships:

- `same_product`: the host is part of the app product.
- `same_operator`: the host and app are separate services run by the same
  organization.
- `host_only`: the matching listing represents only the host and the inferred
  App indicator should be suppressed.

When the host and app use different DIDs, `same_product` and `same_operator`
remain pending until both authenticated accounts approve them. Approval is tied
to the current host claim and one of the app listing's current identity DIDs; an
arbitrary request parameter cannot assert ownership. Either verified owner can
remove a relationship. A host claim change or app identity change makes a
claimed relationship ineligible for public display until the new owners approve
it. Curated relationships use the same stored model and pin the expected app
owner DID.

This relationship is currently appview control-plane state in
`directory_entity_link`. It does not grant PDS access, transfer ownership, or
change either account's AT Protocol identity.

## Account Management Boundary

The reference PDS exposes account management at `/account` on the PDS itself
when the host has enabled that surface. This site should therefore route users
to the host-owned account page when the host publishes an explicit working URL
for:

- OAuth grants and connected apps
- signed-in devices and sessions
- password changes
- account deactivation and deletion
- backup, export, restore, and migration workflows when supported

This site's UI should stay limited to Login with Atmosphere picker connections,
host discovery, host claims, app directory state, and compatibility metadata. If
a host publishes extended compatibility metadata, treat it as optional
enhancement data; do not use it as a substitute for an explicit host account
page URL.

## OAuth Scopes

When the host manage UI writes these records, request scopes for:

```text
repo:account.atmosphere.host.profile
repo:account.atmosphere.host.service
blob:image/*
```

The host-claim entry point requests this same complete bundle before the DNS
challenge. The OAuth grant allows that DID to publish host records and images;
it does not prove ownership or make the claim effective. Only successful DNS
verification does that. Reusing the same bundle after verification avoids a
second predictable authorization prompt when management opens.

Normal account sign-in should not imply this site can manage PDS grants,
devices, passwords, or recovery material. Those controls remain host-owned even
when this site has permission to publish host registry records.

## Publishing Note

`account.atmosphere.*` is a draft namespace chosen for product clarity. Before
publishing it as a production lexicon namespace, confirm the DNS authority model
and publish the required `_lexicon...` TXT record for the namespace owner.
