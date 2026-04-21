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

The login flow requests this scope (see `lib/oauth.ts`):

```
atproto include:com.atmosphereaccount.registry.fullPermissions blob:image/*
```

- **`include:...`** — the authorization server resolves this NSID via DNS and
  reads the schema record's `title` / `detail` to render the consent dialog. It
  also expands the `permissions[]` array into the actual granted scope. If
  resolution fails the PDS returns `invalid_scope`, which is exactly what
  blocked logins until DNS was set up.
- **`blob:image/*`** is a top-level scope on purpose. The atproto permission
  spec
  [explicitly disallows `blob` permissions inside
  permission sets](https://atproto.com/specs/permission#permission-sets) — they
  must always be requested separately.

If you change the permission set's `title`, `detail`, or `permissions[]`,
remember the consent dialog won't reflect it until you `lex:publish:update`
**and** the cache on the user's auth server expires.

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
