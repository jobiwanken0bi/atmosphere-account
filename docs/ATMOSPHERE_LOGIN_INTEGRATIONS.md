# Login with Atmosphere integration examples

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

All examples preserve the same security boundary: Login with Atmosphere returns
a short-lived account selection, while the relying app owns AT Protocol OAuth,
tokens, and its authenticated session.

The picker also keeps account creation host-owned. “Add another account” stays
inside the existing picker, while the Create Account tab searches grouped,
trusted account hosts that are active or reachable, publish a safe HTTPS signup
URL, and advertise `account.atmosphere.host.defs#capabilityOAuthAccountCreation`
when their OAuth metadata supports `prompt=create`. Those hosts keep signup
inside their authorization flow and return the new account to the original app
automatically. Hosts without that capability are not shown in the Create Account
picker. Login with Atmosphere never receives credentials or invite codes. An app
can configure a preferred host when its DID manages that joinable host or the
app and host have a current verified relationship. It is a recommendation, never
a forced choice or request parameter.
