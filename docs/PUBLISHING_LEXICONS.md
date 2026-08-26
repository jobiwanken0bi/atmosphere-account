# Publishing Atmosphere Account lexicons

This project owns the `com.atmosphereaccount.registry.*` Lexicon namespace. The
schemas live in [`lexicons/`](../lexicons) and are the source of truth for both
our records and our OAuth permission set.

For the OAuth login flow to work, atproto authorization servers (the user's PDS)
must be able to resolve the permission-set lexicon
`com.atmosphereaccount.registry.fullPermissions` at runtime. Resolution is
DNS-based per the [atproto Lexicon spec](https://atproto.com/specs/lexicon), not
HTTP — serving the JSON at `/.well-known/atproto-lexicon/...` is **not**
sufficient.

This document explains the one-time setup and the day-to-day publish flow.

---

## Authority DID

All `com.atmosphereaccount.registry.*` lexicons are published by:

|            |                                                |
| ---------- | ---------------------------------------------- |
| **DID**    | `did:plc:ab7uvkn4kyf7l7prl26pz4r2`             |
| **Handle** | `atmosphereaccount.com`                        |
| **PDS**    | `https://stropharia.us-west.host.bsky.network` |

This is the Bluesky account registered for `atmosphereaccount.com`. It is the
**only** account that may publish or update lexicons under this namespace — DNS
authority for `_lexicon.registry.atmosphereaccount.com` points exclusively at
this DID.

> **Do not change which DID owns the namespace casually.** Rotating the
> authority DID invalidates every existing OAuth consent and breaks every
> resolver that has cached the old DID. If a rotation is ever truly needed, the
> [Lexicon spec § "Authority crisis"](https://atproto.com/specs/lexicon)
> describes the recovery path.

---

## One-time setup

### 1. DNS TXT record

Add the following record at Porkbun (the DNS provider for
`atmosphereaccount.com`):

| Type  | Host                | Answer                                 |
| ----- | ------------------- | -------------------------------------- |
| `TXT` | `_lexicon.registry` | `did=did:plc:ab7uvkn4kyf7l7prl26pz4r2` |

> Porkbun's DNS UI takes the **sub-domain part only** in the "Host" field, so
> enter `_lexicon.registry` (not the full
> `_lexicon.registry.atmosphereaccount.com`). The `did=` prefix in the value is
> required by the spec — do not omit it.

Verify propagation with:

```bash
dig +short TXT _lexicon.registry.atmosphereaccount.com @1.1.1.1
# expected: "did=did:plc:ab7uvkn4kyf7l7prl26pz4r2"
```

Or run our preview task, which performs the same lookup using `goat`:

```bash
deno task lex:check-dns
```

A clean run prints nothing about missing entries.

### 2. App password for `goat`

`goat lex publish` writes records to the authority account's PDS. It needs
credentials. **Always use an app password**, not the main account password:

1. Sign in to https://bsky.app as `atmosphereaccount.com`.
2. Settings → Privacy & Security → App Passwords → "Add app password".
3. Name it something obvious like `goat-lex-publish`.
4. Save it to your password manager — it's shown only once.

Export it for `goat`:

```bash
export GOAT_USERNAME=atmosphereaccount.com
export GOAT_PASSWORD='xxxx-xxxx-xxxx-xxxx'
```

(Or pass `--username` / `--app-password` to each invocation.)

### 3. First-time publish

```bash
deno task lex:lint        # style + best-practice check (warnings OK)
deno task lex:check-dns   # confirm DNS is in place
deno task lex:publish     # create the schema records
```

`goat lex publish` only creates records that don't already exist. To update an
existing schema record, use:

```bash
deno task lex:publish:update
```

Updates are constrained by the same backwards-compatibility rules as any atproto
lexicon — see [Lexicon § "Versioning"](https://atproto.com/specs/lexicon).

---

## Day-to-day workflow

When you add or modify a lexicon in `lexicons/`:

1. `deno task lex:lint` — fix any new warnings you can.
2. `deno task lex:status` — show what's drifted between local and live.
3. `deno task lex:publish:update` — push changes to the PDS.
4. Wait a few seconds, then verify resolution end-to-end:

   ```bash
   goat lex resolve com.atmosphereaccount.registry.fullPermissions
   ```

   You should see the schema record JSON. If you get an error, the most common
   causes are:

   - DNS TXT record missing or wrong (`deno task lex:check-dns`)
   - Schema record not yet replicated to the relay used by `goat resolve` (wait
     30-60s and retry)
   - Authentication failed (wrong `GOAT_PASSWORD` or expired app password)

---

## OAuth integration notes

This site uses action-specific OAuth authorization. The `scope` in
`/oauth/client-metadata.json` is the **maximum** this client may request; it is
not the scope sent with every authorization request. Each flow requests the
smallest allowlisted capability bundle needed by the action that opened it (see
`lib/oauth-scopes.ts`):

| Action                                    | Requested permission                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Sign in or use the hosted account picker  | `atproto` only                                                                                             |
| Write a new shared review                 | `include:fyi.atstore.authThirdPartyReviews`                                                                |
| Edit or delete a shared review            | `repo:fyi.atstore.listing.review?action=update&action=delete`                                              |
| Favorite or unfavorite an app             | `repo:fyi.atstore.listing.favorite?action=create&action=delete`                                            |
| Register or manage an app                 | the community app profile, ATStore profile/detail, transitional legacy app collections, and `blob:image/*` |
| Publish, edit, or delete What's New posts | `site.standard.publication` create/update and `site.standard.document` create/update/delete                |
| Claim or manage a host                    | `repo:account.atmosphere.host.profile`, `repo:account.atmosphere.host.service`, and `blob:image/*`         |

Every action bundle also includes `atproto`. When an already-authorized account
adds a capability, this site requests the union of its existing grant and the
new bundle. App and host management are independent, complete jobs. Each
includes its profile images from the first contextual authorization so routine
editing does not cause a second media prompt; their union is requested only for
an explicit combined app-and-host action. Host permission identifies the
repository that may publish the records, while DNS verification separately
proves ownership before a claim becomes effective. Browser input may name only
the capabilities allowlisted in `lib/oauth-scopes.ts`; arbitrary raw scope
strings are rejected.

What's New is a separate contextual job instead of part of every app-profile
authorization. New posts use the same Standard.site records ATStore indexes: one
`site.standard.publication` for the Atmosphere app page and one
`site.standard.document` per update. Do not replace these direct grants with
`include:site.standard.authFull`; that bundle includes unrelated subscription
and recommendation actions. The legacy `com.atmosphereaccount.registry.update`
collection remains read-compatible for existing history but is not used for new
posts.

The metadata maximum temporarily contains both the current allowlisted bundles
and the previous exact scope tokens. This is a rollout compatibility ceiling,
not the permission request: the public shell and authoritative AppView deploy
independently, and authorization servers cache client metadata. Deploy the
expanded metadata first and wait beyond its 300-second shared-cache window
before an AppView begins requesting the new Standard.site tokens. After that
convergence, keeping both generations in the ceiling prevents an `invalid_scope`
window while the AppView rollout completes. Current contextual requests do not
ask for `include:com.atmosphereaccount.registry.fullPermissions` or
`repo:com.atmosphereaccount.registry.update`. When a current action upgrades an
inherited legacy grant, the scope logic preserves known unrelated permissions
but removes that Atmosphere permission-set include and retired collection before
starting the new authorization request. The retired tokens can leave the
metadata ceiling in a later release after every runtime and authorization-server
cache has converged.

`blob:image/*` remains a top-level scope because the atproto permission spec
[explicitly disallows `blob` permissions inside permission
sets](https://atproto.com/specs/permission#permission-sets).

We still publish `com.atmosphereaccount.registry.fullPermissions` for legacy
grants and compatible authorization-server presentation. If you change the
permission set's `title`, `detail`, or `permissions[]`, compatible consent
dialogs won't reflect it until you `lex:publish:update` **and** the cache on the
user's auth server expires.

---

## Useful references

- [Lexicon spec](https://atproto.com/specs/lexicon) — the resolution algorithm,
  in detail.
- [Permissions spec](https://atproto.com/specs/permission) — what can and can't
  go into a permission set, and how scope strings are constructed.
- [Permission Sets guide](https://atproto.com/guides/permission-sets) — the
  friendly walk-through with examples.
- [Lexicon Garden — Adding Lexicons](https://lexicon.garden/help/adding-lexicons)
  — third-party guide that mirrors the steps above.
