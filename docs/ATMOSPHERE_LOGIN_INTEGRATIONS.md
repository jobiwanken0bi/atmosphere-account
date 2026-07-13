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

All examples preserve the same security boundary: Atmosphere returns a
short-lived account selection, while the relying app owns AT Protocol OAuth,
tokens, and its authenticated session.
