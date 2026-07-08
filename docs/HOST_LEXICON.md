# Atmosphere Host Lexicon Draft

This is the first-pass record model for making the Hosts page protocol-native.
The namespace is `account.atmosphere.host.*`.

## Goals

- Let PDS hosts publish their own public host metadata.
- Keep host records user-readable and appview-indexable.
- Separate self-declared host metadata from Atmosphere verification.
- Support host account routing and optional compatibility metadata without
  making Atmosphere the authority for keys, backups, devices, grants, or
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

Atmosphere's register/manage flow should prefill this profile from the signed-in
account's existing microblog profile when possible. If the host uploads a custom
avatar or logo, the image is uploaded to the host account's PDS as a blob and
referenced from the `images` array; Atmosphere does not need R2 for these public
host profile images.

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
"verified" in Atmosphere Account.

Atmosphere should derive trust from:

- OAuth claim flow from the expected admin account.
- Host handle/domain alignment.
- PDS service endpoint reachability.
- Optional `.well-known` proof when the host account handle is different from
  the host domain.
- Local moderation state.
- Future third-party attestations if needed.

This means a host card can show the publishing account, while "verified" remains
an Atmosphere-local or conformance-test result. A self-published record alone
does not prove that the author controls every hostname it names.

## Claim Proof

Known hosts can be pre-bound to a specific operator account, for example
`pckt.cafe` can be claimed by `pckt.blog`. New self-serve host claims need a
domain proof so someone cannot claim an arbitrary PDS domain by only submitting
a form.

Atmosphere accepts these claim paths:

- Pre-bound seeded authority, such as `blacksky.community` claimed by
  `blackskyweb.xyz`.
- Signed-in account handle exactly matches the host domain.
- `/.well-known/atmosphere-host.json` on the host domain names the signed-in DID
  or handle.
- Local `.test` hosts in development only, for visual testing.

Host registration also needs to publish
`account.atmosphere.host.service/{normalized-host}` from the signed-in account.
The DB-only fallback is only for local `.test` visual fixtures.

Example `/.well-known/atmosphere-host.json`:

```json
{
  "host": "pds.example.com",
  "owner": {
    "did": "did:plc:examplehost",
    "handle": "example.com"
  }
}
```

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
- Jetstream indexes `account.atmosphere.host.profile` and
  `account.atmosphere.host.service` records as they change.
- `deno task backfill:hosts [handle ...]` reads existing host records directly
  from each operator account's PDS and reuses the same parser/upsert path.
- Host detail pages expose indexed source records in the technical disclosure so
  operators can see which AT records shaped the listing.

## Account Management Boundary

The reference PDS exposes account management at `/account` on the PDS itself
when the host has enabled that surface. Atmosphere Account should therefore
route users to the host-owned account page when the host publishes an explicit
working URL for:

- OAuth grants and connected apps
- signed-in devices and sessions
- password changes
- account deactivation and deletion
- backup, export, restore, and migration workflows when supported

Atmosphere-owned UI should stay limited to Atmosphere Login picker connections,
host discovery, host claims, app directory state, and compatibility metadata. If
a host publishes extended compatibility metadata, treat it as optional
enhancement data; do not use it as a substitute for an explicit host account
page URL.

## OAuth Scopes

When the host register/manage UI writes these records, request scopes for:

```text
repo:account.atmosphere.host.profile
repo:account.atmosphere.host.service
blob:image/*
```

Normal account sign-in should not imply Atmosphere can manage PDS grants,
devices, passwords, or recovery material. Those controls remain host-owned even
when Atmosphere has permission to publish host registry records.

## Publishing Note

`account.atmosphere.*` is a draft namespace chosen for product clarity. Before
publishing it as a production lexicon namespace, confirm the DNS authority model
and publish the required `_lexicon...` TXT record for the namespace owner.
