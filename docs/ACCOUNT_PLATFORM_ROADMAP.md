# Atmosphere Account Platform Roadmap

Atmosphere Account is becoming a developer platform with three layers:

- universal sign-in picker for apps,
- host account routing and optional compatibility metadata for PDS hosts,
- docs, examples, and conformance tooling for the developer community.

## Build Cycles

### Cycle 1: Contract Foundation

- Harden `/signin`, `/login/select`, `/account`, `/hosts`, and OAuth dev flow.
- Publish Atmosphere Login v0.1 docs.
- Add reusable selection-token verification helpers.
- Add host service records and honest account-routing fallbacks.
- Test token verification, invalid requests, and PDS account-route states.

### Cycle 2: Host Routing And Conformance

- Make `/account` a thin router to the host's PDS-owned `/account` page.
- Keep Atmosphere-specific sections limited to picker connections, remembered
  browser accounts, developer apps, app listings, and reviews.
- Publish a mock host implementation.
- Expand host service and optional manifest validation into a conformance
  runner.
- Add host-directory compatibility badges only after conformance tests.

### Cycle 3: Developer Adoption

- Expand `/developer-resources` into a full "Continue with Atmosphere" console.
- Add app registration metadata for trusted picker display.
- Add examples for Fresh/Deno, Next.js, and plain HTML.
- Add an end-to-end sample app that completes AT Protocol OAuth after account
  selection.

### Cycle 4: Host-Owned Account Management Signals

- Add host-owned repo/blob export and migration signals to compatibility
  metadata.
- Link users to the PDS-owned account page or host-owned deep links when the
  host explicitly declares them.
- Keep any Atmosphere-managed backup optional and client-side encrypted.
- Never store plaintext recovery material, repo archives, blobs, or private
  keys.

### Cycle 5: Governance And FedCM Readiness

- Version the login and host-routing specs.
- Publish conformance tests as the compatibility authority.
- Track browser identity APIs, including FedCM, without making them a launch
  dependency.

## Security Invariants

- Atmosphere never brokers app OAuth tokens.
- Atmosphere never holds plaintext private keys or backup material.
- Selection tokens are short-lived, signed, audience-bound, state-bound, and
  replay-detectable by relying apps through `jti`.
- Return URLs must be exact-match or trusted-origin validated.
- Host-owned controls stay visibly separate from Atmosphere-owned picker
  history.
- Atmosphere never renders first-party controls for PDS grants, devices,
  passwords, keys, recovery, account deletion, or migration unless a future host
  explicitly delegates a narrow action.
