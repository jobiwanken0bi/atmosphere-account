# Passkeys in Atmosphere Login

This document is the design and security contract for passkey-assisted account
selection in Atmosphere Login.

## Decision

A passkey registered with Atmosphere authenticates a user to the Atmosphere
account picker and confirms which saved account they want to hand to an app. It
does **not** replace the app's AT Protocol OAuth flow, authorize the app at the
user's PDS, or create a portable PDS OAuth grant.

The supported flow is:

```text
relying app
  -> Atmosphere Login picker
  -> Atmosphere passkey assertion
  -> short-lived account-selection token
  -> relying app verifies the selection
  -> relying app starts its own AT Protocol OAuth flow
  -> account PDS/entryway authenticates the user and authorizes the app
```

The passkey can reduce the picker to one Face ID, Touch ID, device-PIN, or
security-key gesture. An account host with an existing browser session may also
make the following OAuth step brief. A new app's PDS authorization and consent
still belong to the PDS/entryway authorization server.

## Trust boundaries

There are three distinct relying relationships:

1. The user authenticates to Atmosphere Login with a WebAuthn credential.
2. Atmosphere gives the relying app a signed, audience-bound account-selection
   token.
3. The app obtains its own OAuth grant from the account's authoritative
   PDS/entryway.

These relationships must not be collapsed in implementation or product copy. The
selection token says which account the user selected. It is not a PDS access
token, an OAuth authorization code, or proof that the destination app completed
OAuth.

The [AT Protocol OAuth specification](https://atproto.com/specs/oauth) requires
the app to complete the authorization-code flow, verify the returned account DID
against the authoritative authorization-server issuer, and use PAR, PKCE, and
DPoP. Even an identity-only client requesting only `atproto` must complete that
verification.

### Why the Atmosphere passkey cannot become a PDS OAuth key

- A WebAuthn credential is scoped to the relying party ID that registered it. A
  credential for Atmosphere cannot be exercised by an unrelated PDS or app.
- The credential private key stays with its authenticator. WebAuthn assertions
  sign WebAuthn's authenticator data and client-data hash; they do not expose a
  general-purpose signing key for DPoP JWTs.
- ATProto access and refresh tokens are bound to both the OAuth `client_id` and
  a unique session DPoP key. The specification says they must not be shared or
  reused across clients or devices.
- WebAuthn user verification is authentication to Atmosphere. It is not consent
  to the resource permissions requested by a different OAuth client.
- [OAuth Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693) is an
  optional extension requiring authorization-server support and policy. It is
  not part of the required ATProto OAuth profile and cannot provide a universal
  portability mechanism.

## Production RP and origin

The production WebAuthn relying party is intentionally narrow:

- RP ID: `login.atmosphereaccount.com`
- allowed origin: `https://login.atmosphereaccount.com`

Do not widen the RP ID to `atmosphereaccount.com`, accept arbitrary subdomain
origins, or add relying-app origins. WebAuthn's phishing resistance depends on
strict RP and origin validation, and a parent-domain RP would make every
accepted subdomain part of the credential's security boundary.

`PASSKEY_RP_ID`, when configured in production, must exactly equal the dedicated
login hostname. It cannot be used as an escape hatch to select the parent
domain. When the public login edge proxies a ceremony to the appview, the
forwarded public origin is accepted only with the edge's short-lived HMAC proof.
Direct appview callers cannot nominate a public origin, and their forwarded IP
headers do not create independent durable-rate-limit identities.

Local development uses its own `localhost` credential namespace. A localhost
passkey is not a production passkey and should never be copied into production
data. All non-local environments require HTTPS.

Related Origin Requests are not a mechanism for arbitrary Atmosphere apps to
share this credential. Apps should redirect to the Atmosphere origin; they
should never receive a WebAuthn assertion or invoke the Atmosphere credential
from their own origin.

## Enrollment

Enrollment is allowed only after a fresh AT Protocol OAuth authentication to
Atmosphere. “Fresh” has a precise meaning here: the authorization server must
advertise `login` in `prompt_values_supported`, and Atmosphere sends
`prompt=login`. A new OAuth transaction without that prompt may silently reuse
an authorization-server browser session and is not sufficient for passkey
management. Hosts that do not advertise the capability are rejected instead of
being presented as fresh authentication.

The flow is:

1. Complete Atmosphere's identity-only OAuth flow with the account host.
2. Verify the token response `sub` DID and confirm that the resolved DID's PDS
   maps to the authorization-server issuer used by the flow.
3. Ask the user explicitly whether they want to add a passkey for that account.
4. Create and verify the WebAuthn registration ceremony.
5. Bind the verified credential record to the immutable DID and the current
   Atmosphere OAuth session.

The successful callback issues a DID-bound, HMAC-authenticated management ticket
for ten minutes. The ticket is `HttpOnly`, `Secure` in production, and
`SameSite=Strict`. Viewing, adding, or removing passkeys requires both the
normal account session and that ticket. Logout, add-account, account switch,
forget-account, unrelated OAuth callbacks, and passkey-based identity changes
clear it. Synthetic local-picker accounts bypass this proof only in local
development.

Never register a passkey silently, from a selection token alone, or from a stale
browser session. Adding another passkey, linking another DID, or changing the
DID associated with a credential requires fresh user verification or fresh
ATProto OAuth.

Registration options are:

- `residentKey: "required"` so the account can be found without typing a handle;
- `userVerification: "required"` so possession of an unlocked device alone is
  insufficient;
- `attestation: "none"` because this consumer flow does not need device-model
  attestation;
- no forced `authenticatorAttachment`, so synced passkeys, platform
  authenticators, roaming security keys, and cross-device authentication can all
  work.

The WebAuthn `user.id`/user handle must be a unique, opaque random value of at
most 64 bytes. It must not contain a DID, handle, email address, or unsalted
hash of identifying data. A credential record maps to one DID; a DID may have
multiple credential records. Handles and display names are presentation data
only because they can change.

Store at least the credential ID, credential public key, opaque user handle,
DID, signature counter, transports, backup-eligibility and backup-state flags,
creation and last-use timestamps, a user-facing credential name, and revocation
state. Never store biometric data; browsers and authenticators do not provide it
to the relying party.

## Passkey-assisted selection

An incoming picker request is still validated as it is today: the app,
`client_id`, exact `return_uri`, `state`, and trust status are resolved before
an account can be returned.

The server then creates a cryptographically random, short-lived, single-use
WebAuthn challenge. Its durable server-side intent must bind the ceremony to:

- purpose (`authenticate` rather than `register`);
- the selected DID, when already known;
- picker request or intent ID;
- requesting `client_id`;
- exact `return_uri`;
- requesting `state` and any displayed scope hint;
- expected RP ID and origin;
- creation and expiry timestamps.

The UI should show the requesting app and account before an explicit "Continue
with passkey" action. Conditional mediation/autofill may be offered when the
browser reports support, but the explicit action and existing OAuth fallback
must remain. A browser or authenticator cancellation is a normal cancelled flow,
not an authentication failure to be retried automatically.

The verification endpoint must atomically consume the challenge and validate:

- ceremony type and exact challenge;
- exact origin and RP ID hash;
- credential ID and opaque user handle;
- assertion signature using the stored public key;
- user-presence and user-verification flags;
- challenge purpose, expiry, and bound picker request;
- current local credential revocation state and a usable Atmosphere OAuth link.

Only after verification succeeds may Atmosphere create the existing audience-,
state-, and return-URI-bound selection token. The app must still verify and
consume that token once, then start app-owned ATProto OAuth with the selected
DID or handle as `login_hint`.

The WebAuthn credential key must never be used as, derived into, or presented as
the OAuth DPoP key. DPoP remains a separate key pair generated and managed for
the relevant OAuth client session.

## Threat model and controls

| Threat                                     | Required control                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phishing or credential use on another site | Exact production RP ID and origin checks; HTTPS; no wildcard or parent-domain origins.                                                                             |
| Challenge or assertion replay              | High-entropy challenges, short expiry, purpose binding, durable atomic consumption, and rate limits.                                                               |
| OAuth/account-linking mix-up               | Require an advertised `prompt=login`, issue a short DID-bound management ticket, and bind challenge, DID, client, state, and exact return URI together.            |
| Malicious or impersonating destination app | Preserve app registration, trust-state warnings, exact return-URI matching, audience binding, and blocked-app enforcement.                                         |
| Passkey treated as OAuth consent           | Clearly display the account/app action and always continue into app-owned ATProto OAuth.                                                                           |
| Stolen selection token                     | Short expiry, signature verification, `iss`/`aud`/`state`/`return_uri` checks, and durable `jti` replay rejection.                                                 |
| Stale handle or account migration          | Bind to DID, resolve current display/hosting data, and re-run the ATProto issuer-authority checks when OAuth must be renewed.                                      |
| Revoked PDS grant                          | Require a usable Atmosphere OAuth session before passkey selection; fall back to fresh OAuth when refresh fails or the issuer changes, with the bounded lag below. |
| Direct appview/header spoofing             | Accept forwarded origin and caller identity only with an edge-signed short-lived proof; use one coarse limiter bucket for untrusted direct callers.                |
| Credential-membership probing              | Return the same external status and message for unknown, revoked, and invalid-signature assertions.                                                                |
| XSS or compromised subdomain               | Keep the RP narrowly scoped, minimize third-party script on the login origin, and enforce a restrictive Content Security Policy.                                   |
| Lost or compromised authenticator          | Allow multiple credentials, per-credential revocation, clear recent-use information, and recovery through fresh ATProto OAuth.                                     |

WebAuthn signature counters are a risk signal, not standalone proof of cloning.
Some authenticators legitimately keep the counter at zero, and synced or
concurrently used credentials can produce non-monotonic observations. Store and
evaluate the counter, but apply a risk policy rather than universally locking an
account on a mismatch. Track the backup-eligibility and backup-state flags for
security visibility without rejecting synced passkeys merely because they are
backed up.

The current verifier gives SimpleWebAuthn the stored counter for device-bound
credentials, retaining strict monotonic validation there. For a credential
recorded as multi-device it verifies with a zero baseline, then stores the
returned value as telemetry along with the current backup/device flags. This
avoids rejecting a legitimate synced passkey used concurrently on two devices.

Rate-limit registration-option, registration-verification,
authentication-option, and authentication-verification endpoints. Challenges
must not be usable across purposes or accounts. Session cookies remain `Secure`,
`HttpOnly`, and appropriately `SameSite`; passkeys do not replace CSRF,
session-fixation, or return-URI defenses.

PDS-side OAuth revocation is not necessarily observable immediately. If the
stored Atmosphere access token remains outside its refresh window,
`getValidSession()` can consider the link usable until token refresh or expiry.
The passkey result is only an Atmosphere selection and the destination app must
still complete its own authoritative OAuth flow, which bounds the impact. Do not
claim immediate PDS-revocation propagation; use an explicit forced-refresh or
token-status mechanism if that becomes a product requirement.

The dedicated login origin should continue moving toward a nonce/hash-based
script policy with narrower network destinations. The current same-origin
WebAuthn policy, framing denial, HTTPS, no-referrer/no-store headers, and strict
RP validation do not make inline-script permission harmless if HTML injection is
introduced later.

## Recovery and revocation

Users should be able to register multiple passkeys, name them, inspect recent
use, and revoke them individually. Removing the server-side public key makes a
credential unusable at Atmosphere, but does not necessarily remove its private
copy from a synced passkey provider; the user should be told to remove that
stale copy there as well.

The preferred recovery paths are:

1. another already registered passkey; or
2. repeating the original ATProto OAuth identity proof with the authoritative
   account host, then enrolling a replacement passkey.

Do not introduce a weaker email-only recovery path for a DID link. Sensitive
actions such as adding/removing a DID, adding a passkey, or deleting the last
passkey require recent user verification or a new ATProto OAuth proof with an
advertised `prompt=login` capability.

Atmosphere passkey revocation, Atmosphere's OAuth grant at the PDS, and OAuth
grants previously issued to destination apps are separate. Atmosphere can revoke
its local credential and forget its PDS session, but it cannot revoke every
app's PDS-issued grant or app-owned login session. Product copy and account
controls must keep that distinction clear.

## Account creation

A passkey does not create an ATProto account. Direct account creation remains a
host-owned OAuth extension: Atmosphere may send `prompt=create` only to hosts
that explicitly advertise the capability, and the host owns credentials, invite
codes, recovery, and any host-native passkey enrollment.

The ATProto OAuth profile permits additional optional authorization parameters
but does not require servers to process them. `prompt=create` must therefore
remain capability-gated. If a host offers a passkey during account creation,
that credential is registered for the host's authorization-server RP ID, not for
Atmosphere.

## Future options

### Host-native passkeys or an upstream identity provider

The cleanest way to use Face ID or Touch ID for the actual OAuth authorization
step is for the PDS/entryway authorization server to support passkeys itself.
The ATProto OAuth specification expressly allows authorization servers to use
passkeys or upstream OpenID Connect providers for user authentication.

A host could choose Atmosphere as such an upstream identity provider, but that
requires an explicit trust relationship and account mapping at each host. It is
not a protocol-wide feature and must not be inferred from an Atmosphere
selection token.

### Atmosphere as an identity-only provider

Atmosphere could later expose a standard authorization-code/OIDC service for
apps that need identity only. In that model the passkey could authenticate the
user and Atmosphere would issue its own assertion to an app that explicitly
trusts Atmosphere as issuer. That would be a deliberate centralized-broker
product with its own client registration, consent, claims, revocation, session,
privacy, and recovery design.

It would not give an app a PDS access token and must not be presented as native
ATProto OAuth. The current selection-token picker should not drift into that
model implicitly.

### Browser-mediated federation

FedCM may eventually let browsers remember decentralized accounts and mediate
sign-in without visible redirects. Bluesky is funding work on decentralized
Identity Provider Registration, but that work is still incubating and is not a
production dependency for this implementation.

## Official references

- [AT Protocol OAuth specification](https://atproto.com/specs/oauth) —
  authoritative account/issuer verification, client metadata, authorization
  requests, PAR, PKCE, DPoP, token binding, and authorization-interface rules.
- [AT Protocol OAuth: authorization requests](https://atproto.com/specs/oauth#authorization-requests)
  — mandatory request fields and the optional nature of additional parameters.
- [AT Protocol OAuth: tokens and session lifetime](https://atproto.com/specs/oauth#tokens-and-session-lifetime)
  — client-ID and DPoP-session binding and token sharing prohibition.
- [AT Protocol OAuth: authorization interface](https://atproto.com/specs/oauth#authorization-interface)
  — the PDS/entryway owns user authentication and app authorization and may use
  passkeys or upstream identity providers.
- [Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/) — RP-ID and
  origin scoping, discoverable credentials, user verification, assertion
  validation, privacy, backup state, and signature-counter guidance.
- [FIDO Alliance passkey overview](https://fidoalliance.org/passkeys/) — passkey
  user experience, phishing resistance, and device/synced credential models.
- [OAuth 2.0 Security Best Current Practice, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)
  — current OAuth redirect, token, sender-constraint, and browser-flow security
  guidance.
- [OAuth 2.0, RFC 6749 section 4.1.2](https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2)
  — authorization codes are short-lived and bound to a client identifier and
  redirect URI.
- [OAuth DPoP, RFC 9449](https://datatracker.ietf.org/doc/html/rfc9449) — DPoP
  sender-constrains OAuth tokens to a separate client-held signing key.
- [OAuth Token Exchange, RFC 8693](https://datatracker.ietf.org/doc/html/rfc8693)
  — optional token-exchange semantics and authorization-server policy.
- [SimpleWebAuthn server documentation](https://simplewebauthn.dev/docs/packages/server)
  — the production library's registration and authentication option and
  verification contracts.
- [MDN: conditional WebAuthn mediation](https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredential/isConditionalMediationAvailable_static)
  — browser capability detection for optional passkey autofill. The current UI
  intentionally keeps an explicit user-triggered button.
- [FIDO guidance on multiple authenticators and recovery](https://fidoalliance.org/white-paper-multiple-authenticators-for-reducing-account-recovery-needs-for-fido-enabled-consumer-accounts/)
  — multiple credentials and repeating original identity proofing for recovery.
- [FIDO synced-passkey deployment guidance](https://fidoalliance.org/wp-content/uploads/2024/05/Synced-Passkey-Deployment_-Emerging-Practices-for-Consumer-Use-Cases_2024-May-31.pdf)
  — user verification, backup, management, naming, and recovery considerations.
- [AT Protocol: Working to Decentralize FedCM](https://atproto.com/blog/working-to-decentralize-fedcm)
  — current browser-mediated federation work and its early-stage decentralized
  provider-registration dependency.
