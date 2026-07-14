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

The picker also keeps account creation host-owned. “Add another account” stays
inside the existing picker, while the Create Account tab searches grouped,
trusted account hosts that are active or reachable, have open or invite-based
signup, and publish a safe HTTPS signup URL. Raw relay-observed personal PDSes
are excluded. A selected signup page opens separately, so Atmosphere never
receives invite codes. Apps that also operate a host can configure a preferred
host in their authenticated app registration only after the same owner account
has claimed that host; it is a recommendation, never a forced choice or request
parameter.
