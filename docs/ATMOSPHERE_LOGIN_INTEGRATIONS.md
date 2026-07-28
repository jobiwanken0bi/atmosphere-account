# Atmosphere Login integration examples

Atmosphere Account ships three integration levels:

- **Fresh/Deno reference app:** `/examples/atmosphere-login/app` is executable
  and performs selection-token verification, replay consumption, AT Protocol
  OAuth start, callback completion, and an app-owned session.
- **Plain HTML:** `/examples/atmosphere-login-plain.html` demonstrates the
  browser button without a framework. Server-side verification remains required
  and is intentionally not hidden in client JavaScript.
- **Next.js App Router:** `examples/nextjs-atmosphere-login/README.md` contains
  a client button and a Route Handler that verifies the signed callback before
  redirecting to the app's own OAuth start endpoint.

For native mobile apps, open the same picker URL in the operating system's
authentication browser (`ASWebAuthenticationSession` or an Android Custom Tab)
and return through an app/universal link. Redirect mode remains the default for
mobile websites; the JavaScript popup mode is a desktop-only convenience.

All examples preserve the same security boundary: Atmosphere returns a
short-lived account selection, while the relying app owns AT Protocol OAuth,
tokens, and its authenticated session.

## Passkey-assisted picker

Passkey support does not change the relying-app integration contract. When a
user has explicitly enrolled an Atmosphere passkey after a capability-gated
ATProto OAuth `prompt=login` reauthentication, the hosted picker may use Face
ID, Touch ID, a device PIN, or a security key to authenticate that user and
confirm a saved account selection. The passkey is scoped to
`login.atmosphereaccount.com`; neither the relying app nor the PDS receives the
WebAuthn assertion or credential key.

The app still receives only the normal short-lived `selection_token`. It must
verify the token's signature, issuer, audience, state, exact return URI,
timestamps, and one-time `jti`, then start its own AT Protocol OAuth flow with
the selected DID or handle as `login_hint`. A passkey-assisted selection must
never be treated as evidence that the PDS authorized the app or granted its
requested scopes.

Apps therefore need no WebAuthn endpoint or passkey library to adopt this picker
enhancement. They should preserve the normal redirect or native
authentication-browser flow and handle passkey cancellation like any other
picker cancellation. Product copy should describe the gesture as choosing or
continuing with an Atmosphere account, not as granting PDS access to the app.
See [Passkeys in Atmosphere Login](./PASSKEYS.md) for the full boundary and
security design.

The picker also keeps account creation host-owned. “Add another account” stays
inside the existing picker, while the Create Account tab searches grouped,
trusted account hosts that are active or reachable, publish a safe HTTPS signup
URL, and advertise `account.atmosphere.host.defs#capabilityOAuthAccountCreation`
when their OAuth metadata supports `prompt=create`. Those hosts keep signup
inside their authorization flow and return the new account to the original app
automatically. Hosts without that capability are not shown in the Create Account
picker. Atmosphere never receives credentials or invite codes. Apps that also
operate a host can configure a preferred host in their authenticated app
registration only after the same owner account has claimed that host; it is a
recommendation, never a forced choice or request parameter.
