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
- `popup`: opt into a separate browser window. Redirecting the current page is
  the default and recommended behavior.
- `closePopupOnComplete`: close an SDK-opened popup after a valid selection
  message. Defaults to `true`.

## Launch Behavior

Redirect mode navigates the app's existing browser tab to the picker and returns
to the registered `return_uri`. It is the default for desktop and mobile web.

Popup mode is an optional desktop convenience. The SDK centers the popup and
sizes it to the available screen, up to 800 by 900 CSS pixels with a 16-pixel
inset on each edge. Browsers may ignore those hints, promote the flow to a full
tab, or block it unless it starts directly from a user action.

Native mobile apps should open the picker URL in the platform authentication
browser (`ASWebAuthenticationSession` on Apple platforms or a Custom Tab on
Android) and return through an app/universal link. Native apps should not depend
on the JavaScript popup handoff.

## Picker Presentation

The picker shows remembered browser accounts and the requesting app's trust
status. Trusted and local development apps use a compact status pill. Unverified
apps receive an expanded warning before account selection. Blocked apps cannot
open the picker.

“Add another account” expands the full sign-in flow inside the picker, so the
requesting app and return path remain in place. Its Create Account tab searches
the grouped account-host directory by host name, domain, description, or
location. Open-signup and invite-accepting hosts are included by default and can
be filtered independently. Atmosphere never asks for an invite code: signup and
invite-code entry happen on the selected host's own page in a new browser tab,
and the user returns to the preserved picker to select the new account. Picker
results must also be recently active or directly reachable, claimed, verified,
or seeded, and backed by a safe public HTTPS signup URL. Raw relay-observed
personal PDSes are never offered as account-creation providers.

A registered app may set an optional `preferredAccountHost`. The host is pinned
first and labelled “Recommended by [app]”, but users can choose any other host.
Atmosphere accepts this field only when the app owner has a current verified
claim for that grouped host. The claim, signup URL, and joinable status are
checked again when the picker opens. A request URL cannot nominate a preferred
host.

For local visual testing, `GET /dev/login-picker` seeds four fictional saved
accounts with profile portraits and opens the redirect picker. The route and its
avatar mapping are disabled in hosted production environments.

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
imply it can revoke every PDS-issued grant or operate PDS account controls. The
reference interface is documented in the official
[AT Protocol account-management guide](https://atproto.com/guides/account-management).

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
