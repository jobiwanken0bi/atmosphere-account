# Atmosphere Login v0.1

Atmosphere Login is a shared account picker for AT Protocol apps. It helps apps
show a consistent "Continue with Atmosphere" experience while preserving the
normal AT Protocol OAuth authority model.

Atmosphere does **not** broker OAuth access tokens. The picker returns a signed
account-selection token, then the relying app starts its own AT Protocol OAuth
flow with the selected account.

## Browser SDK

```html
<button
  data-atmosphere-login
  data-client-id="https://app.example.com/oauth/client-metadata.json"
  data-return-uri="https://app.example.com/auth/atmosphere/selected"
>
</button>
<script src="https://login.atmosphereaccount.com/atmosphere-login.js"></script>
```

The browser script exposes:

- `AtmosphereLogin.buildUrl(options)`
- `AtmosphereLogin.continue(options)`
- `AtmosphereLogin.continueWithAtmosphere(options)`
- `AtmosphereLogin.consumeSelection(options)`

Required options:

- `clientId`: absolute app client identifier.
- `returnUri`: absolute URL that receives the selection.

Optional options:

- `state`: caller-provided nonce. If omitted, the SDK creates one.
- `scope`: app-specific request hint displayed/preserved by Atmosphere.
- `atmosphereOrigin`: alternate Atmosphere origin for dev/test.

## Selection Token

After selection, Atmosphere redirects to `return_uri` with:

- `iss`
- `client_id`
- `did`
- `handle`
- `state`
- `selection_token`

The `selection_token` is an ES256 JWT with `typ:
atmosphere-login+jwt`.

Claims:

- `iss`: Atmosphere Account origin.
- `aud`: the requesting `client_id`.
- `sub`: selected account DID.
- `handle`: selected account handle.
- `pds_url`: selected account PDS URL when known.
- `return_uri`: exact redirect target used for this selection.
- `state`: app nonce.
- `scope`: optional request hint.
- `app_name`: display name shown in the picker.
- `iat`: issued-at seconds.
- `exp`: expiry seconds.
- `jti`: unique token id. Apps should store/reject reused IDs in durable storage
  until the token expires.

## Verification

Relying apps must verify:

- JWT signature using `/oauth/jwks.json`.
- `iss` equals the expected Atmosphere origin.
- `aud` equals their `client_id`.
- `state` equals the state they created.
- `return_uri` equals the route receiving the token.
- `exp` has not passed and `iat` is recent.
- `jti` has not already been consumed.

After verification, the app should start its own AT Protocol OAuth flow using
the selected `handle` or DID as the login hint. OAuth tokens stay between the
app and the user's account host.

Users manage the resulting PDS OAuth grants, devices, passwords, account
security, backups, recovery, deletion, and migration at their host-owned PDS
account page, usually `/account` on their PDS service endpoint. Atmosphere Login
can show picker history and apps that used the Atmosphere picker; it must not
imply it can revoke every PDS-issued grant or operate PDS account controls.

## Server Helper

The repo exports a Deno/TypeScript helper from `lib/atmosphere-login-sdk.ts`:

```ts
import { verifyAtmosphereSelectionToken } from "./lib/atmosphere-login-sdk.ts";

const result = await verifyAtmosphereSelectionToken({
  token,
  publicJwk,
  expectedIssuer: "https://login.atmosphereaccount.com",
  expectedAudience: "https://app.example.com/oauth/client-metadata.json",
  expectedState: state,
  expectedReturnUri: "https://app.example.com/auth/atmosphere/selected",
});
```

## Security Boundary

Atmosphere Login is an account picker and signed handoff. It is not:

- an OAuth token exchange service,
- a grant revocation authority,
- a device or session manager,
- a password, recovery, or account deletion surface,
- a key backup service,
- a PDS migration proxy.

Those operations belong to the user's account host.
