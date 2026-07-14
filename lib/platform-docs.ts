export type DocsBlock =
  | { type: "paragraph"; body: string }
  | { type: "callout"; title: string; body: string; tone?: "blue" | "amber" }
  | { type: "code"; language: string; code: string; caption?: string }
  | { type: "list"; items: string[] }
  | { type: "checklist"; items: string[] }
  | { type: "cards"; items: DocsLinkCard[] }
  | {
    type: "diagram";
    title?: string;
    variant?: "login" | "host" | "neutral";
    items: Array<{ title: string; body: string }>;
  }
  | { type: "steps"; items: Array<{ title: string; body: string }> }
  | {
    type: "table";
    columns: string[];
    rows: string[][];
  }
  | {
    type: "endpoint";
    method: "GET" | "POST";
    path: string;
    body: string;
  }
  | { type: "iconDownloads" }
  | { type: "atmosphereLoginConsole" };

export interface DocsLinkCard {
  title: string;
  body: string;
  href: string;
  label?: string;
}

export interface DocsSection {
  id: string;
  eyebrow?: string;
  title: string;
  intro?: string;
  blocks: DocsBlock[];
}

export interface DocsPage {
  slug: string;
  group: "Start" | "Guides" | "Hosts" | "Reference";
  status?: "Stable" | "Draft" | "Experimental";
  navTitle: string;
  title: string;
  description: string;
  summary: string[];
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  nextSteps?: DocsLinkCard[];
  sections: DocsSection[];
}

export const docsPages: DocsPage[] = [
  {
    slug: "overview",
    group: "Start",
    status: "Stable",
    navTitle: "Overview",
    title: "Atmosphere Account docs",
    description:
      "Build with a shared Atmosphere sign-in picker, host registry, and thin routing to PDS-owned account pages.",
    summary: [
      "Use Atmosphere Login when an app wants a consistent account picker before starting its own AT Protocol OAuth flow.",
      "Use host service records when a PDS host wants Atmosphere to route users to its account page without giving custody or account-control authority to Atmosphere.",
      "Passwords, devices, OAuth grants, keys, backups, recovery, deletion, and migration are managed by the user's PDS host, not by Atmosphere.",
      "Use conformance tools before claiming compatibility in the host directory.",
    ],
    primaryCta: {
      label: "Add Atmosphere Login",
      href: "/docs/atmosphere-login",
    },
    secondaryCta: { label: "Validate a host", href: "/docs/conformance" },
    nextSteps: [
      {
        title: "Build the first integration",
        body:
          "Start with a minimal button, callback verifier, and AT Protocol OAuth handoff.",
        href: "/docs/get-started",
        label: "Get started",
      },
      {
        title: "Register an app",
        body:
          "Set app identity, exact return URIs, review status, picker warnings, and shared app records.",
        href: "/docs/register-app",
        label: "Open guide",
      },
      {
        title: "Route to host account pages",
        body:
          "Publish a host service record with a PDS endpoint and working account page URL so Atmosphere can send users to host-owned controls.",
        href: "/docs/host-dashboard",
        label: "Host guide",
      },
    ],
    sections: [
      {
        id: "architecture",
        eyebrow: "Architecture",
        title: "Thin coordination, host-owned account controls",
        intro:
          "Atmosphere Account coordinates UX, discovery, and contracts. The user’s account host remains the authority for account security, account controls, and data custody.",
        blocks: [
          {
            type: "diagram",
            variant: "login",
            title: "Universal sign-in flow",
            items: [
              {
                title: "App button",
                body: "The app sends the user to the hosted picker.",
              },
              {
                title: "Account picker",
                body: "Atmosphere lets the user choose a remembered account.",
              },
              {
                title: "Selection token",
                body: "The app receives a short-lived signed account choice.",
              },
              {
                title: "App OAuth",
                body:
                  "The app starts normal AT Protocol OAuth with the selected account.",
              },
            ],
          },
          {
            type: "steps",
            items: [
              {
                title: "Universal sign-in",
                body:
                  "Apps send users to the hosted picker. Atmosphere returns a signed selection token, then the app starts normal AT Protocol OAuth with the chosen account.",
              },
              {
                title: "Shared app records",
                body:
                  "Apps use interoperable listing records for discovery, reviews, favorites, and community app identity. The old Atmosphere profile record is legacy compatibility.",
              },
              {
                title: "Host account routing",
                body:
                  "PDS hosts publish a service record. Atmosphere shows where the account lives and links users to the account page the host explicitly publishes.",
              },
              {
                title: "Developer ecosystem",
                body:
                  "Docs, examples, validator APIs, CLI checks, and future conformance badges help apps and hosts interoperate without a central token broker.",
              },
            ],
          },
          {
            type: "callout",
            title: "Security boundary",
            body:
              "Atmosphere does not broker app OAuth tokens, revoke PDS grants, manage devices, change passwords, rotate keys, perform account recovery, store backups, delete accounts, or move accounts. Those actions belong to the user’s account host.",
          },
          {
            type: "table",
            columns: ["Surface", "Atmosphere does", "PDS host does"],
            rows: [
              [
                "Sign in",
                "Lets the user choose an account and returns a signed selection token.",
                "Issues the app's OAuth grant after the app starts normal AT Protocol OAuth.",
              ],
              [
                "Account home",
                "Shows the current account, remembered browser accounts, Atmosphere Login connections, developer apps, reviews, and a link to the host.",
                "Manages passwords, devices, OAuth grants, account deletion, recovery, backups, exports, and migration.",
              ],
              [
                "Host directory",
                "Shows reachable, intentionally public provider profiles with signup information, location/style, and optional compatibility signals. Raw observed personal PDSes remain private.",
                "Publishes authoritative host service/profile records and owns the account page destination.",
              ],
              [
                "App directory",
                "Indexes shared app records, merges duplicates, and shows reviews/favorites from interoperable records.",
                "Publishes app-owned records from the app account and remains the source of truth for app-specific OAuth grants.",
              ],
            ],
          },
          {
            type: "cards",
            items: [
              {
                title: "App developers",
                body:
                  "Use Atmosphere Login for the shared account picker, then own your app OAuth session.",
                href: "/docs/atmosphere-login",
                label: "Read the guide",
              },
              {
                title: "PDS hosts",
                body:
                  "Publish host service records and a working account page URL so Atmosphere can route users without duplicating account controls.",
                href: "/docs/host-dashboard",
                label: "Read the host guide",
              },
              {
                title: "Production teams",
                body:
                  "Run checks, publish a domain manifest, and request trusted review.",
                href: "/docs/production-checklist",
                label: "Prepare launch",
              },
              {
                title: "App record owners",
                body:
                  "Publish shared app records instead of depending on the legacy Atmosphere profile record.",
                href: "/docs/app-records",
                label: "Read the model",
              },
            ],
          },
        ],
      },
      {
        id: "when-to-use",
        title: "Choose the right integration",
        blocks: [
          {
            type: "table",
            columns: ["You are building", "Use", "Result"],
            rows: [
              [
                "An Atmosphere app",
                "Atmosphere Login and shared app records",
                "One consistent account picker, followed by your own AT Protocol OAuth session and interoperable app discovery.",
              ],
              [
                "A PDS host",
                "Host service record",
                "Atmosphere can route people to the explicitly published account page without duplicating account controls.",
              ],
              [
                "A directory or compatibility badge",
                "Conformance validator",
                "Claims are backed by testable manifest behavior instead of manual copy.",
              ],
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "get-started",
    group: "Start",
    status: "Stable",
    navTitle: "Get started",
    title: "Build your first Atmosphere Login flow",
    description:
      "Add a shared account picker, verify the signed account selection, then start your own AT Protocol OAuth flow.",
    summary: [
      "Use the hosted picker for account selection, not token brokerage.",
      "Verify the selection token before trusting the chosen DID or handle.",
      "Complete AT Protocol OAuth in your app after selection.",
    ],
    primaryCta: {
      label: "Open example app",
      href: "/examples/atmosphere-login/app",
    },
    secondaryCta: {
      label: "Register your app",
      href: "/account/developer/apps",
    },
    nextSteps: [
      {
        title: "Add the button",
        body: "Install the browser SDK and launch the hosted picker.",
        href: "/docs/add-button",
        label: "Next",
      },
      {
        title: "Verify the token",
        body:
          "Validate signature, issuer, audience, state, return URI, expiry, and replay.",
        href: "/docs/verify-token",
        label: "Verifier guide",
      },
      {
        title: "Start ATProto OAuth",
        body: "Use the chosen handle or DID as the OAuth login hint.",
        href: "/docs/oauth-handoff",
        label: "OAuth guide",
      },
    ],
    sections: [
      {
        id: "flow",
        eyebrow: "Flow",
        title: "Atmosphere selects, your app authorizes",
        intro:
          "The picker only answers one question: which Atmosphere account does the user want to use? Your app still owns scopes, grants, sessions, refresh behavior, and logout.",
        blocks: [
          {
            type: "diagram",
            variant: "login",
            items: [
              {
                title: "Render button",
                body: "Use the browser SDK or build `/login/select` yourself.",
              },
              {
                title: "Receive callback",
                body:
                  "Atmosphere returns `selection_token`, `client_id`, `state`, and account hints.",
              },
              {
                title: "Verify selection",
                body:
                  "Check the signed token and reject stale, replayed, or mismatched callbacks.",
              },
              {
                title: "Start OAuth",
                body:
                  "Begin AT Protocol OAuth with the selected handle or DID as `login_hint`.",
              },
            ],
          },
          {
            type: "callout",
            title: "Local development wording",
            body:
              "Developers usually run a local app while integrating. ATProto’s development shortcut uses `http://localhost/` as a special client ID, while local callbacks should use loopback IP return URIs such as `http://127.0.0.1:5173/callback`. Production uses exact HTTPS return URIs.",
          },
        ],
      },
      {
        id: "minimal",
        title: "Minimal implementation",
        blocks: [
          {
            type: "steps",
            items: [
              {
                title: "Register app identity",
                body:
                  "Create a development or production app registration with a name, client ID, homepage, logo, and allowed return URI.",
              },
              {
                title: "Add the SDK button",
                body:
                  "Pass the registered client ID, return URI, and app metadata to the browser SDK.",
              },
              {
                title: "Verify the callback",
                body:
                  "Use the server helper or your own JWT verifier to validate the selection token.",
              },
              {
                title: "Continue OAuth",
                body:
                  "Start AT Protocol OAuth and verify the returned `sub` DID according to the AT Protocol OAuth profile.",
              },
            ],
          },
          {
            type: "code",
            language: "html",
            caption: "Button",
            code:
              `<script src="https://login.atmosphereaccount.com/atmosphere-login.js" defer></script>

<button
  data-atmosphere-login
  data-client-id="https://app.example.com/oauth/client-metadata.json"
  data-return-uri="https://app.example.com/auth/atmosphere/selected"
  data-app-name="Example App"
></button>`,
          },
          {
            type: "code",
            language: "ts",
            caption: "Selection callback",
            code: `const verified = await verifyAtmosphereLoginCallback({
  url: request.url,
  publicJwk,
  expectedIssuer: "https://login.atmosphereaccount.com",
  expectedClientId,
  expectedReturnUri,
  expectedState,
  replayStore,
});

if (!verified.ok) throw new Error(verified.error);

return startAtprotoOAuth({
  loginHint: verified.claims.handle || verified.claims.sub,
});`,
          },
        ],
      },
      {
        id: "production",
        title: "Move from local dev to production",
        intro:
          "Local URLs are for integration only. Before requesting trust, move every public identity and return URI to HTTPS.",
        blocks: [
          {
            type: "checklist",
            items: [
              "Use a production HTTPS client ID URL.",
              "Use exact HTTPS allowed return URIs for every callback.",
              "Serve a recognizable HTTPS logo.",
              "Publish `/.well-known/atmosphere-login.json` on the app homepage origin.",
              "Run production checks from the app detail page.",
              "Request trusted review only after the picker test passes.",
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "atmosphere-login",
    group: "Guides",
    status: "Stable",
    navTitle: "Atmosphere Login",
    title: "Add Continue with Atmosphere",
    description:
      "Use the hosted picker to let people choose an Atmosphere account, then complete your own AT Protocol OAuth flow with that account.",
    summary: [
      "The picker remembers browser-level Atmosphere accounts.",
      "The app receives a signed `selection_token` with DID, handle, state, audience, and optional PDS URL.",
      "OAuth tokens stay between the app and the user’s account host.",
    ],
    primaryCta: { label: "Register your app", href: "/account/developer/apps" },
    secondaryCta: {
      label: "Open example app",
      href: "/examples/atmosphere-login/app",
    },
    nextSteps: [
      {
        title: "Register your app",
        body: "Set app identity, owner, status, and allowed return URIs.",
        href: "/docs/register-app",
        label: "Start here",
      },
      {
        title: "Add the button",
        body: "Install the browser SDK and open the hosted picker.",
        href: "/docs/add-button",
        label: "Build",
      },
      {
        title: "Verify and hand off",
        body:
          "Validate the signed selection token and start app-owned ATProto OAuth.",
        href: "/docs/verify-token",
        label: "Secure",
      },
    ],
    sections: [
      {
        id: "quickstart",
        eyebrow: "Install",
        title: "Load the browser SDK",
        blocks: [
          {
            type: "code",
            language: "html",
            code:
              `<script src="https://login.atmosphereaccount.com/atmosphere-login.js" defer></script>

<button
  data-atmosphere-login
  data-client-id="https://app.example.com/oauth/client-metadata.json"
  data-return-uri="https://app.example.com/auth/atmosphere/selected"
  data-app-name="Example App"
></button>
`,
          },
          {
            type: "steps",
            items: [
              {
                title: "Open the picker",
                body:
                  "The SDK builds `/login/select` with `client_id`, `return_uri`, `state`, and optional `scope`.",
              },
              {
                title: "Verify the selection",
                body:
                  "Your callback receives `selection_token`. Verify the ES256 signature and bind `iss`, `aud`, `state`, and `return_uri`.",
              },
              {
                title: "Start AT Protocol OAuth",
                body:
                  "Use the selected handle or DID as the login hint. Your app still completes the AT Protocol OAuth profile with the user’s PDS or entryway.",
              },
            ],
          },
        ],
      },
      {
        id: "example-app",
        title: "Start with the working example",
        intro:
          "The reference app is a complete relying-app loop: redirect and popup buttons, picker handoff, callback verifier, app-owned AT Protocol OAuth start, app OAuth callback, and final signed-in app state.",
        blocks: [
          {
            type: "endpoint",
            method: "GET",
            path: "/examples/atmosphere-login/app",
            body:
              "A copy-paste example app that uses the static SDK, returns to a verifier callback, starts app-owned AT Protocol OAuth, then shows the final signed-in app state. It includes redirect mode and popup mode so you can compare the browser behavior.",
          },
          {
            type: "steps",
            items: [
              {
                title: "Click Continue with Atmosphere",
                body:
                  "The SDK stores a one-time state value, builds the picker URL, and sends the user to `/login/select`. Redirect mode navigates the page; popup mode keeps the app page open.",
              },
              {
                title: "Choose an account",
                body:
                  "The picker returns `selection_token`, `client_id`, `state`, selected DID, handle, and issuer as query parameters.",
              },
              {
                title: "Verify before doing anything else",
                body:
                  "The callback verifies signature, expiry, issuer, audience, state, return URI, and replay key before redirecting to the app OAuth start route. In popup mode, the popup completion page notifies the opener, and the opener still continues through that server-verified callback.",
              },
              {
                title: "Finish as the app",
                body:
                  "The example app completes AT Protocol OAuth on its own callback and creates its own app session. Atmosphere never receives the app OAuth token.",
              },
            ],
          },
        ],
      },
      {
        id: "complete-oauth-handoff",
        title: "Complete the ATProto OAuth handoff",
        intro:
          "Atmosphere Login only selects an account. After the selection token passes, your app should begin normal AT Protocol OAuth with the selected handle or DID as the login hint.",
        blocks: [
          {
            type: "endpoint",
            method: "GET",
            path: "/examples/atmosphere-login/oauth/start",
            body:
              "Starts app-owned AT Protocol OAuth using the selected handle or DID from the verified selection token.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/examples/atmosphere-login/oauth/callback",
            body:
              "Exchanges the authorization code on the example app callback and mints an example-app session. Production apps should store their OAuth session in their own token store.",
          },
          {
            type: "code",
            language: "ts",
            caption: "Selection callback to app-owned OAuth",
            code: `const verified = await verifyAtmosphereLoginCallback({
  url: request.url,
  publicJwk,
  expectedIssuer: "https://login.atmosphereaccount.com",
  expectedClientId,
  expectedReturnUri,
  expectedState,
  replayStore,
});

if (!verified.ok) throw new Error(verified.error);

return redirect("/oauth/start?" + new URLSearchParams({
  login_hint: verified.claims.handle || verified.claims.sub,
}));`,
          },
          {
            type: "callout",
            tone: "blue",
            title: "Reference replay storage",
            body:
              "The example app consumes replay keys in the app database so the final callback rejects a reused selection token across app instances. Production apps should use their own durable store and keep each key until the token expires.",
          },
          {
            type: "callout",
            title: "Keep the token boundary clear",
            body:
              "Do not send AT Protocol OAuth access tokens to Atmosphere. The relying app owns its OAuth session, refresh behavior, scopes, and logout semantics.",
          },
        ],
      },
      {
        id: "account-management-boundary",
        title: "Account management stays with the host",
        intro:
          "Atmosphere Login gives apps a consistent account picker. It is intentionally not a replacement for the user's PDS account page.",
        blocks: [
          {
            type: "callout",
            title: "Thin architecture",
            body:
              "Atmosphere can show picker history and apps that used the Atmosphere picker. The user's PDS host manages OAuth grants, connected apps, devices, sessions, passwords, keys, recovery, backups, deletion, and migration.",
          },
          {
            type: "table",
            columns: ["Need", "Where it belongs"],
            rows: [
              [
                "Choose which account to use",
                "Atmosphere hosted picker and signed selection token.",
              ],
              [
                "Grant an app repository access",
                "The app's normal AT Protocol OAuth flow with the user's PDS or entryway.",
              ],
              [
                "Review or revoke all connected apps",
                "The user's PDS-owned account page, usually exposed by the host.",
              ],
              [
                "Manage devices, passwords, recovery, backups, or migration",
                "The user's account host. Atmosphere only routes to that destination when known.",
              ],
            ],
          },
        ],
      },
      {
        id: "test-console",
        title: "Try it locally",
        intro:
          "Generate a picker URL from the reference app or your registered app metadata, inspect redirect and popup button snippets, and paste a token to check pass/fail verification.",
        blocks: [
          { type: "atmosphereLoginConsole" },
          {
            type: "callout",
            tone: "blue",
            title: "Seed the local redirect picker",
            body:
              "Open `/dev/login-picker` during local development to seed four fictional saved accounts with profile portraits and enter the normal same-tab redirect picker. The route and avatar mapping are unavailable in hosted production environments.",
          },
        ],
      },
      {
        id: "add-button",
        title: "Add the button",
        intro:
          "The default button uses the Atmosphere icon and can run as a full-page redirect or a popup. Full-page redirect is the most reliable default; popup mode has an origin-checked completion event for apps that need it.",
        blocks: [
          {
            type: "code",
            language: "html",
            code: `<button
  data-atmosphere-login
  data-client-id="https://app.example.com/oauth/client-metadata.json"
  data-return-uri="https://app.example.com/auth/atmosphere/selected"
  data-scope="atproto"
  data-app-name="Example App"
  data-app-homepage="https://app.example.com"
  data-mode="redirect"
></button>`,
          },
          {
            type: "table",
            columns: ["Attribute", "Purpose"],
            rows: [
              [
                "data-client-id",
                "Your stable app client ID. Production IDs should be HTTPS URLs.",
              ],
              [
                "data-return-uri",
                "The exact callback URI registered for receiving the selection token.",
              ],
              [
                "data-mode",
                "`redirect` by default, or `popup` when your app can handle the extra browser constraints. Popup callbacks can call `consumeSelection()` to notify the opener.",
              ],
              [
                "data-app-name",
                "Local button label and accessibility context; registered metadata is still the picker authority.",
              ],
            ],
          },
          {
            type: "callout",
            tone: "blue",
            title: "Popup mode completion",
            body:
              "In popup mode, the callback page should load the browser SDK and call `AtmosphereLogin.consumeSelection({ clientId })`. The SDK opens a centered window that adapts to the available screen, posts the selection back to the opener, and accepts it only when the return URI origin, client ID, and state all match. Browsers can still promote the flow to a tab or block it unless it starts from a direct user action.",
          },
          {
            type: "callout",
            title: "Native mobile apps use the system browser",
            body:
              "Open the picker URL with `ASWebAuthenticationSession` on Apple platforms or an Android Custom Tab, then return through an app/universal link. Mobile websites should use the normal same-tab redirect. Do not depend on the JavaScript popup handoff from a native webview.",
          },
        ],
      },
      {
        id: "register-app",
        title: "Register your app",
        intro:
          "Registering gives the picker a clear app identity and a return URI allow-list tied to your signed-in Atmosphere account.",
        blocks: [
          {
            type: "endpoint",
            method: "GET",
            path: "/account/developer/apps",
            body:
              "Signed-in developer page for registering an app name, client ID, logo URL, homepage, allowed return URIs, and an optional verified preferred account host.",
          },
          {
            type: "steps",
            items: [
              {
                title: "Sign in with the owner account",
                body:
                  "The current Atmosphere account becomes the owner of the app registration. That owner can update the name, logo, homepage, and return URI allow-list.",
              },
              {
                title: "Use a stable client ID",
                body:
                  "For production, the client ID should be an HTTPS URL controlled by your app, usually your OAuth client metadata URL.",
              },
              {
                title: "Add exact return URIs",
                body:
                  "Every production callback that receives `selection_token` must be listed exactly. Atmosphere strips URL fragments before matching.",
              },
              {
                title: "Recommend a host you operate (optional)",
                body:
                  "If the same owner account has claimed a joinable account host, select it as the preferred host. The picker pins it first and labels it as recommended by the app, while keeping every other eligible host available.",
              },
            ],
          },
          {
            type: "callout",
            title: "Preferred hosts are registration data, not request input",
            body:
              "Atmosphere verifies the host claim when the registration is saved and again when the picker opens. Apps cannot nominate an arbitrary host in the picker URL, and revoked, transferred, closed, or unconfigured hosts stop being recommended.",
          },
          {
            type: "table",
            columns: ["State", "Picker label", "Meaning"],
            rows: [
              [
                "development",
                "Development app",
                "Local-only development app. Use the ATProto `http://localhost/` client ID shortcut with loopback IP return URIs while building.",
              ],
              [
                "unverified",
                "Unverified app",
                "Self-registered production app. The picker warns users before continuing.",
              ],
              [
                "trusted",
                "Trusted",
                "Atmosphere-reviewed app identity with a verified domain manifest and production return URI allow-list.",
              ],
              [
                "blocked",
                "Blocked",
                "This app cannot use the hosted picker.",
              ],
            ],
          },
          {
            type: "callout",
            tone: "blue",
            title: "Trust information stays compact",
            body:
              "Trusted and local development apps show their state in the app card's status pill. Unverified apps receive an expanded warning before account selection, while blocked apps cannot open the picker.",
          },
        ],
      },
      {
        id: "domain-manifest",
        title: "Verify your app domain",
        intro:
          "Before an app can request Trusted status, its homepage origin must publish a small Atmosphere Login manifest. This proves the registered app identity is controlled by the same domain users see in the picker.",
        blocks: [
          {
            type: "code",
            language: "json",
            caption: "/.well-known/atmosphere-login.json",
            code: `{
  "version": "atmosphere.login.v0.1",
  "apps": [
    {
      "client_id": "https://app.example.com/oauth/client-metadata.json",
      "app_name": "Example App",
      "homepage": "https://app.example.com",
      "logo_uri": "https://app.example.com/icon.png",
      "allowed_return_uris": [
        "https://app.example.com/auth/atmosphere/selected"
      ]
    }
  ]
}`,
          },
          {
            type: "list",
            items: [
              "Host this file at the HTTPS origin of your registered homepage.",
              "Use an `apps` array when one domain hosts more than one relying app.",
              "`client_id`, `app_name`, `homepage`, `logo_uri`, and every registered `allowed_return_uris` entry must match the Atmosphere registration.",
              "The developer app detail page fetches this file during Run checks and blocks Trusted review until it passes.",
            ],
          },
        ],
      },
      {
        id: "return-uri-rules",
        title: "Allowed return URI rules",
        intro:
          "The return URI is where Atmosphere sends the short-lived account-selection token. Treat it like an OAuth redirect URI: exactness matters.",
        blocks: [
          {
            type: "table",
            columns: ["Case", "Rule"],
            rows: [
              [
                "Registered production apps",
                "The `return_uri` must exactly match one of the registered allowed return URIs, including scheme, host, port, path, and query.",
              ],
              [
                "URL fragments",
                "Fragments are removed before matching and are never used as the delivery location for a selection token.",
              ],
              [
                "HTTPS",
                "Production client IDs, homepages, logos, and return URIs must use HTTPS.",
              ],
              [
                "Local development",
                "In development, the special `http://localhost/` client ID can use loopback IP return URIs such as `http://127.0.0.1:5173/callback` for quick testing.",
              ],
            ],
          },
          {
            type: "callout",
            title: "Avoid broad origins in production",
            body:
              "Registered production apps use exact allowed return URIs. Atmosphere does not accept a whole origin such as `https://app.example.com` as a wildcard for every callback path.",
            tone: "amber",
          },
        ],
      },
      {
        id: "production-checks",
        title: "Production checks",
        intro:
          "Registered apps get a health check panel before they ask users to trust the picker handoff.",
        blocks: [
          {
            type: "endpoint",
            method: "GET",
            path: "/account/developer/apps/{clientId}",
            body:
              "Developer app detail page with production readiness, picker test URL generation, expected callback shape, and selection token verification.",
          },
          {
            type: "table",
            columns: ["Check", "What Atmosphere looks for"],
            rows: [
              [
                "Client ID",
                "Absolute URL, HTTPS in production, or the ATProto `http://localhost/` shortcut in local development.",
              ],
              [
                "Homepage",
                "A valid HTTPS homepage so people can identify the app.",
              ],
              [
                "Logo",
                "A recognizable app mark, preferably served over HTTPS.",
              ],
              [
                "Return URIs",
                "Exact callback URLs; no wildcard origins or fragment delivery.",
              ],
              [
                "Loopback/dev URLs",
                "Any `localhost`, `127.0.0.1`, or `[::1]` URL keeps the app in local-development readiness.",
              ],
              [
                "Domain alignment",
                "Homepage and client ID domains should clearly belong to the same app identity.",
              ],
              [
                "Domain manifest",
                "The app homepage origin serves `/.well-known/atmosphere-login.json` confirming the registered client ID, identity, and return URI allow-list.",
              ],
              [
                "Review status",
                "Whether the app is development, unverified, requested, trusted, or blocked.",
              ],
            ],
          },
          {
            type: "list",
            items: [
              "Local development only means loopback URLs are present.",
              "Needs production fixes means one or more production checks failed.",
              "Ready to request trusted review means production checks pass and the app can be submitted.",
              "Trusted means the app identity and return URI allow-list have been approved.",
              "Blocked means the picker will not continue for this app.",
            ],
          },
        ],
      },
      {
        id: "trusted-review",
        title: "Trusted review requirements",
        intro:
          "Trusted review is about reducing ambiguity in the picker. It is not a security audit of the app's own OAuth implementation.",
        blocks: [
          {
            type: "steps",
            items: [
              {
                title: "Finalize app identity",
                body:
                  "Use the production app name, homepage, logo, and client ID that users will recognize.",
              },
              {
                title: "Remove local URLs",
                body:
                  "Replace the local client ID shortcut and every local homepage, logo, or return URI with HTTPS production or staging URLs.",
              },
              {
                title: "Run the picker test",
                body:
                  "Generate a test picker URL on the app detail page, complete the handoff, and verify the returned callback URL or token.",
              },
              {
                title: "Publish the domain manifest",
                body:
                  "Host `/.well-known/atmosphere-login.json` on the app homepage origin and make sure Run checks shows Domain manifest as passing.",
              },
              {
                title: "Submit context",
                body:
                  "Explain what the app does, who maintains it, and why the registered domains should be shown as trusted.",
              },
            ],
          },
          {
            type: "callout",
            title: "Trust can reset",
            body:
              "Changing a trusted app's name, homepage, logo, or return URIs returns it to review so the picker does not imply stale trust.",
            tone: "amber",
          },
        ],
      },
      {
        id: "production",
        title: "How to move from local dev to production",
        blocks: [
          {
            type: "steps",
            items: [
              {
                title: "Start with local dev",
                body:
                  "Use the docs console or your local app with the ATProto `http://localhost/` client ID shortcut and a loopback IP return URI while developing.",
              },
              {
                title: "Publish your app identity",
                body:
                  "Move to an HTTPS client ID, homepage, and logo URL on a domain your app controls.",
              },
              {
                title: "Register production callbacks",
                body:
                  "Add every production selection callback to `/account/developer/apps`. Keep staging and production URLs separate.",
              },
              {
                title: "Publish the domain manifest",
                body:
                  "Serve `/.well-known/atmosphere-login.json` from the homepage origin so Atmosphere can verify the app identity and callback allow-list.",
              },
              {
                title: "Verify before OAuth",
                body:
                  "After the picker returns, verify the signed selection token and then start your own AT Protocol OAuth flow with the selected DID or handle as a hint.",
              },
            ],
          },
          {
            type: "code",
            language: "txt",
            code: `Local:
client_id=http://localhost/?redirect_uri=http%3A%2F%2F127.0.0.1%3A5174%2Fauth%2Fatmosphere%2Fselected
return_uri=http://127.0.0.1:5174/auth/atmosphere/selected

Production:
client_id=https://app.example.com/oauth/client-metadata.json
return_uri=https://app.example.com/auth/atmosphere/selected`,
          },
        ],
      },
      {
        id: "verification",
        title: "Verify the selection token",
        intro:
          "The token is an account-selection handoff, not an OAuth credential.",
        blocks: [
          {
            type: "code",
            language: "ts",
            code: `import {
  fetchAtmosphereLoginPublicJwkForToken,
  verifyAtmosphereLoginCallback,
} from "https://login.atmosphereaccount.com/atmosphere-login-server.js";

const callbackUrl = new URL(request.url);
const selectionToken = callbackUrl.searchParams.get("selection_token");
if (!selectionToken) throw new Error("Missing selection token");

const publicJwk = await fetchAtmosphereLoginPublicJwkForToken(
  selectionToken,
  "https://login.atmosphereaccount.com",
);

const result = await verifyAtmosphereLoginCallback({
  url: callbackUrl,
  publicJwk,
  expectedIssuer: "https://login.atmosphereaccount.com",
  expectedClientId: "https://app.example.com/oauth/client-metadata.json",
  expectedState: stateFromSession,
  expectedReturnUri: "https://app.example.com/auth/atmosphere/selected",
  replayStore,
});

if (!result.ok) throw new Error(result.error);
const { sub: did, handle, pds_url } = result.claims;`,
          },
          {
            type: "table",
            columns: ["Claim", "Meaning", "Required check"],
            rows: [
              [
                "iss",
                "Atmosphere Account origin",
                "Must match the expected deployment.",
              ],
              [
                "aud",
                "Requesting app client ID",
                "Must equal your `client_id`.",
              ],
              ["sub", "Selected account DID", "Use as the durable account id."],
              [
                "handle",
                "Selected account handle",
                "Good for display and login hint.",
              ],
              [
                "pds_url",
                "Known account host URL",
                "Optional hint; still verify via OAuth.",
              ],
              ["state", "App nonce", "Must match the state you created."],
              [
                "return_uri",
                "Selection callback",
                "Must match the route receiving the token.",
              ],
              [
                "jti",
                "Unique token id",
                "Store until expiry and reject repeat use.",
              ],
            ],
          },
        ],
      },
      {
        id: "oauth-handoff",
        title: "Start ATProto OAuth",
        intro:
          "Once the selection token passes, use the verified account as a login hint for your own AT Protocol OAuth flow.",
        blocks: [
          {
            type: "code",
            language: "ts",
            code: `if (!result.ok) throw new Error(result.error);

const loginHint = result.claims.handle || result.claims.sub;
const oauthUrl = await yourAtprotoOAuthClient.authorizeUrl({
  loginHint,
  scope: "atproto",
});

return Response.redirect(oauthUrl);`,
          },
          {
            type: "callout",
            title: "Selection is not authorization",
            body:
              "Atmosphere tells your app which account the user picked. Repository reads, writes, blobs, and app sessions still require your normal AT Protocol OAuth grant.",
            tone: "amber",
          },
        ],
      },
      {
        id: "security",
        title: "Security model",
        blocks: [
          {
            type: "callout",
            title: "Do not treat selection as authorization",
            body:
              "The selected DID/handle tells your app which account the user chose. It does not grant repository reads, writes, blobs, preferences, or account-management powers.",
            tone: "amber",
          },
          {
            type: "list",
            items: [
              "Use a fresh `state` value for every picker request.",
              "Verify the JWT signature with `/oauth/jwks.json`.",
              "Require exact `aud`, `iss`, `state`, and `return_uri` matches.",
              "Reject replayed `jti` values until the token expires.",
              "Start your own AT Protocol OAuth flow after selection.",
              "Store OAuth refresh tokens server-side or according to the AT Protocol OAuth profile for your client type.",
            ],
          },
        ],
      },
      {
        id: "production-checklist",
        title: "Production checklist",
        blocks: [
          {
            type: "list",
            items: [
              "Register the app at `/account/developer/apps` with a stable HTTPS client ID.",
              "Use exact allowed return URIs for production and staging callbacks.",
              "Show a recognizable app name, homepage, and HTTPS logo.",
              "Verify `iss`, `aud`, `state`, `return_uri`, expiry, signature, and replay key server-side.",
              "Start your own AT Protocol OAuth flow after selection; do not treat the selection token as an app session.",
              "Request trusted review when the app identity and production callbacks are ready.",
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "register-app",
    group: "Guides",
    status: "Stable",
    navTitle: "Register app",
    title: "Register your app",
    description:
      "Give the picker a clear app identity, an owner account, and an exact return URI allow-list.",
    summary: [
      "App registration is tied to the signed-in Atmosphere owner account.",
      "Production apps use HTTPS identity and exact allowed return URIs.",
      "Apps may recommend a currently claimed, joinable account host without preventing other choices.",
      "Review states control picker copy and trust warnings.",
    ],
    primaryCta: {
      label: "Open registrations",
      href: "/account/developer/apps",
    },
    secondaryCta: {
      label: "Production checklist",
      href: "/docs/production-checklist",
    },
    nextSteps: [
      {
        title: "Add the button",
        body: "Use the registered client ID and return URI in the browser SDK.",
        href: "/docs/add-button",
        label: "Next",
      },
      {
        title: "Understand app records",
        body:
          "See how community app profiles, ATStore listings, reviews, and legacy Atmosphere records fit together.",
        href: "/docs/app-records",
        label: "Record model",
      },
      {
        title: "Run checks",
        body:
          "Confirm identity, URI, logo, HTTPS, and domain-manifest readiness.",
        href: "/docs/production-checklist",
        label: "Checklist",
      },
    ],
    sections: [
      {
        id: "fields",
        eyebrow: "Metadata",
        title: "Required registration fields",
        blocks: [
          {
            type: "table",
            columns: ["Field", "Purpose", "Production rule"],
            rows: [
              [
                "App name",
                "Primary picker identity users see.",
                "Use the public product name.",
              ],
              [
                "Client ID",
                "Stable app identifier and selection-token audience.",
                "Use an HTTPS URL you control. Local dev can use the ATProto `http://localhost/` shortcut.",
              ],
              [
                "Logo URL",
                "Visual identity in the picker.",
                "Use HTTPS and a reachable image.",
              ],
              [
                "Homepage",
                "Human-readable app identity.",
                "Use HTTPS and align with the client ID domain.",
              ],
              [
                "Allowed return URIs",
                "Callbacks allowed to receive `selection_token`.",
                "Exact-match production URLs. Loopback IP callbacks are local development only.",
              ],
              [
                "Preferred account host (optional)",
                "Pins a host first in the Create Account chooser and labels it as recommended by the app.",
                "Must be a joinable grouped host currently claimed by the app owner. Atmosphere re-verifies the claim at picker time.",
              ],
            ],
          },
          {
            type: "callout",
            title: "Client ID versus return URI",
            body:
              "For local ATProto OAuth development, `http://localhost/` is a special virtual client ID. Your local callback is still a return URI, usually `http://127.0.0.1:<port>/...` or `http://[::1]:<port>/...`.",
          },
        ],
      },
      {
        id: "states",
        title: "Registration review states",
        blocks: [
          {
            type: "table",
            columns: ["State", "Picker label", "Behavior"],
            rows: [
              [
                "development",
                "Development app",
                "Local-only app. Good for loopback testing, not production trust.",
              ],
              [
                "unverified",
                "Unverified app",
                "Self-registered app. Picker shows clear warning copy.",
              ],
              [
                "trusted",
                "Trusted",
                "Reviewed app identity and return URI allow-list.",
              ],
              ["blocked", "Unavailable", "Picker cannot continue."],
            ],
          },
        ],
      },
      {
        id: "allowed-return-uris",
        title: "Allowed return URI rules",
        blocks: [
          {
            type: "checklist",
            items: [
              "Production return URIs must be exact matches.",
              "Fragments are stripped and are never used as delivery locations.",
              "A registered origin is not a wildcard for every callback path.",
              "Keep staging, preview, and production callbacks explicit.",
              "Remove loopback URLs before requesting trusted review.",
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "app-records",
    group: "Guides",
    status: "Experimental",
    navTitle: "App records",
    title: "App records and directory interop",
    description:
      "Use shared app records for Atmosphere Account, ATStore, and the community app lexicon without duplicating listings.",
    summary: [
      "Community app profiles describe app identity and product metadata.",
      "ATStore listing records power discovery, reviews, and favorites today.",
      "Legacy Atmosphere app profile records should not be the active target for new app listings.",
      "Atmosphere merges duplicate records into one public app page.",
    ],
    primaryCta: { label: "Manage app listings", href: "/apps/manage" },
    secondaryCta: { label: "Browse apps", href: "/apps" },
    nextSteps: [
      {
        title: "Register your app",
        body:
          "Create the app identity and exact picker return URIs before publishing records.",
        href: "/docs/register-app",
        label: "Register",
      },
      {
        title: "API reference",
        body: "Review exposed routes, SDK files, and compatibility endpoints.",
        href: "/docs/reference",
        label: "Reference",
      },
    ],
    sections: [
      {
        id: "sources",
        eyebrow: "Read model",
        title: "One app page can come from multiple records",
        intro:
          "Atmosphere’s app directory is an appview projection. It reads AT Protocol records, normalizes them into one internal listing shape, and deduplicates records that describe the same app.",
        blocks: [
          {
            type: "table",
            columns: ["Record", "Role", "How Atmosphere uses it"],
            rows: [
              [
                "`community.lexicon.app.profile`",
                "Canonical app identity.",
                "Name, description, icon, banner/media, links, status, platforms, lexicons, and app-owned metadata.",
              ],
              [
                "`fyi.atstore.listing.detail`",
                "Shared listing record.",
                "Primary public listing source today. It connects to ATStore reviews, favorites, categories, and discovery signals.",
              ],
              [
                "`fyi.atstore.listing.review` / `favorite`",
                "Social signals.",
                "Reviews, ratings, favorites, and trending inputs for apps with an ATStore listing URI.",
              ],
              [
                "`com.atmosphereaccount.registry.profile`",
                "Legacy compatibility.",
                "Read as a fallback while old Atmosphere-only listings migrate. New listings should publish shared app records instead.",
              ],
            ],
          },
          {
            type: "callout",
            title: "No duplicate cards",
            body:
              "When an app has records in more than one source, Atmosphere shows one app card and one detail page. Source details belong in owner/admin disclosure, not in the public card design.",
          },
        ],
      },
      {
        id: "publishing",
        title: "Publishing direction",
        intro:
          "The practical path is to publish from the app account itself, then let appviews such as Atmosphere and ATStore index the same records.",
        blocks: [
          {
            type: "steps",
            items: [
              {
                title: "Use the app account",
                body:
                  "Sign in with the account that represents the app. That account owns the app’s shared profile and listing records.",
              },
              {
                title: "Add required listing fields",
                body:
                  "Provide a name, description, icon, homepage or app link, category/collection, and media where available.",
              },
              {
                title: "Publish shared records",
                body:
                  "Atmosphere writes an ATStore listing record for discovery and a community app profile for canonical app identity when the app is ready.",
              },
              {
                title: "Migrate legacy listings",
                body:
                  "Legacy Atmosphere-only listings should move to shared records. The old record can remain indexed as a fallback until the migration is complete.",
              },
            ],
          },
          {
            type: "callout",
            title: "Regular reviewers are different",
            body:
              "A regular user leaving a review does not need an app or host profile record. Reviews use the signed-in Atmosphere account identity and, when needed, a minimal ATStore reviewer profile for display compatibility.",
          },
        ],
      },
      {
        id: "dedupe",
        title: "Merge and precedence rules",
        blocks: [
          {
            type: "table",
            columns: ["Match key", "Purpose"],
            rows: [
              [
                "Product/profile DID",
                "Strongest signal that multiple records belong to the same app account.",
              ],
              [
                "Canonical primary URL",
                "Useful when a community profile and ATStore listing describe the same app from the same website.",
              ],
              [
                "Source AT URI",
                "Fallback when no shared identity or URL exists.",
              ],
            ],
          },
          {
            type: "table",
            columns: ["Precedence", "Display behavior"],
            rows: [
              [
                "ATStore listing",
                "Wins duplicate resolution today because it carries the shared review/favorite ecosystem.",
              ],
              [
                "Community app profile",
                "Fills canonical identity and app metadata gaps.",
              ],
              [
                "Legacy Atmosphere profile",
                "Fills remaining blanks only while older listings migrate.",
              ],
            ],
          },
        ],
      },
      {
        id: "reviews",
        title: "Reviews and favorites",
        blocks: [
          {
            type: "paragraph",
            body:
              "If an app has an ATStore listing URI, Atmosphere routes reviews and favorites to ATStore-compatible records. If it does not, older Atmosphere review behavior is treated as legacy fallback until the app migrates.",
          },
          {
            type: "callout",
            title: "Do not mix rating systems",
            body:
              "ATStore-backed review aggregates and legacy Atmosphere review aggregates should not be blended into one public rating. Prefer the shared ATStore-backed signal once a listing exists.",
            tone: "amber",
          },
        ],
      },
    ],
  },
  {
    slug: "add-button",
    group: "Guides",
    status: "Stable",
    navTitle: "Add button",
    title: "Add the Continue with Atmosphere button",
    description:
      "Use the browser SDK to render a consistent button, generate state, and open the hosted picker.",
    summary: [
      "The default button includes the Atmosphere icon and accessible label.",
      "Redirect mode is the reliable default; popup mode is optional.",
      "The SDK stores state in session storage as a convenience, but your server still verifies the callback.",
    ],
    primaryCta: { label: "SDK reference", href: "/docs/sdk-reference" },
    secondaryCta: {
      label: "Example app",
      href: "/examples/atmosphere-login/app",
    },
    nextSteps: [
      {
        title: "Verify the callback",
        body:
          "Do not trust selected account data until the signed token passes.",
        href: "/docs/verify-token",
        label: "Next",
      },
      {
        title: "Troubleshooting",
        body: "Fix popup, state, return URI, and local dev issues.",
        href: "/docs/troubleshooting",
        label: "Debug",
      },
    ],
    sections: [
      {
        id: "html",
        eyebrow: "Install",
        title: "Use the static browser SDK",
        blocks: [
          {
            type: "code",
            language: "html",
            caption: "Redirect button",
            code:
              `<script src="https://login.atmosphereaccount.com/atmosphere-login.js" defer></script>

<button
  data-atmosphere-login
  data-client-id="https://app.example.com/oauth/client-metadata.json"
  data-return-uri="https://app.example.com/auth/atmosphere/selected"
  data-scope="atproto"
  data-app-name="Example App"
  data-app-homepage="https://app.example.com"
></button>`,
          },
          {
            type: "table",
            columns: ["Attribute", "Required", "Purpose"],
            rows: [
              [
                "data-atmosphere-login",
                "Yes",
                "Marks the button for SDK enhancement.",
              ],
              ["data-client-id", "Yes", "Audience for the selection token."],
              [
                "data-return-uri",
                "Yes",
                "Callback that receives the selection token.",
              ],
              [
                "data-scope",
                "No",
                "Optional picker context. Your app OAuth still owns scopes.",
              ],
              ["data-mode", "No", "`redirect` by default, or `popup`."],
              [
                "data-app-name",
                "No",
                "Local accessibility fallback; registered metadata wins in picker identity.",
              ],
            ],
          },
        ],
      },
      {
        id: "javascript",
        title: "Build the URL yourself",
        blocks: [
          {
            type: "code",
            language: "js",
            caption: "Manual launch",
            code: `const { url, state } = AtmosphereLogin.buildUrl({
  clientId: "https://app.example.com/oauth/client-metadata.json",
  returnUri: "https://app.example.com/auth/atmosphere/selected",
  scope: "atproto",
});

sessionStorage.setItem("atmosphere_state", state);
location.href = url;`,
          },
        ],
      },
      {
        id: "popup-mode",
        title: "Popup mode",
        blocks: [
          {
            type: "callout",
            tone: "amber",
            title: "Redirect is still the default",
            body:
              "Use popup mode only when it materially improves your desktop web app. The SDK centers it and adapts its size to the available screen, but browsers can block popups unless they start from a direct user action, promote them to full tabs, and prevent completion events under strict opener isolation headers.",
          },
          {
            type: "callout",
            title: "Mobile launch behavior",
            body:
              "Mobile websites should keep the default same-tab redirect. Native apps should open the picker in `ASWebAuthenticationSession` or an Android Custom Tab and return through an app/universal link rather than using the JavaScript popup API.",
          },
          {
            type: "code",
            language: "js",
            caption: "Listen for popup completion",
            code:
              `const button = document.querySelector("[data-atmosphere-login]");

button.addEventListener("atmosphere-login:complete", (event) => {
  const { selection } = event.detail;
  // Verify selection.token on your server before starting your app sign-in.
});

button.addEventListener("atmosphere-login:cancel", () => {
  // The user closed the picker before choosing an account.
});`,
          },
          {
            type: "code",
            language: "js",
            caption: "Popup callback page",
            code: `const selection = AtmosphereLogin.consumeSelection({
  clientId: "https://app.example.com/oauth/client-metadata.json",
  closePopup: true,
});

if (!selection) {
  // Show a small fallback message or return to your app.
}`,
          },
          {
            type: "callout",
            tone: "blue",
            title: "See it in the reference app",
            body:
              "The example app includes a popup-mode button. Its popup callback posts the selection back to the opener, then the opener navigates through the same server-verified callback used by redirect mode.",
          },
        ],
      },
    ],
  },
  {
    slug: "verify-token",
    group: "Guides",
    status: "Stable",
    navTitle: "Verify token",
    title: "Verify the selection token",
    description:
      "Validate the signed account selection before using the chosen DID, handle, or PDS hint.",
    summary: [
      "Fetch Atmosphere’s public JWKS.",
      "Verify signature, type, issuer, audience, state, return URI, expiry, and replay.",
      "Treat the token as account selection, not an OAuth credential.",
    ],
    primaryCta: {
      label: "Open test console",
      href: "/docs/atmosphere-login#test-console",
    },
    secondaryCta: { label: "SDK reference", href: "/docs/sdk-reference" },
    nextSteps: [
      {
        title: "Start ATProto OAuth",
        body: "Use the verified handle or DID as the app OAuth login hint.",
        href: "/docs/oauth-handoff",
        label: "Next",
      },
      {
        title: "Troubleshooting",
        body:
          "Debug state mismatch, replay, expiry, issuer, and return URI failures.",
        href: "/docs/troubleshooting",
        label: "Debug",
      },
    ],
    sections: [
      {
        id: "server-helper",
        eyebrow: "Server",
        title: "Use the verifier helper",
        blocks: [
          {
            type: "code",
            language: "ts",
            caption: "Callback verification",
            code: `import {
  fetchAtmosphereLoginPublicJwkForToken,
  verifyAtmosphereLoginCallback,
} from "https://login.atmosphereaccount.com/atmosphere-login-server.js";

const callbackUrl = new URL(request.url);
const selectionToken = callbackUrl.searchParams.get("selection_token");
if (!selectionToken) throw new Error("Missing selection token");

const publicJwk = await fetchAtmosphereLoginPublicJwkForToken(
  selectionToken,
  "https://login.atmosphereaccount.com",
);

const result = await verifyAtmosphereLoginCallback({
  url: callbackUrl,
  publicJwk,
  expectedIssuer: "https://login.atmosphereaccount.com",
  expectedClientId: "https://app.example.com/oauth/client-metadata.json",
  expectedState,
  expectedReturnUri: "https://app.example.com/auth/atmosphere/selected",
  replayStore,
});

if (!result.ok) throw new Error(result.error);
const loginHint = result.claims.handle || result.claims.sub;`,
          },
        ],
      },
      {
        id: "claims",
        title: "Claims to bind",
        blocks: [
          {
            type: "table",
            columns: ["Claim", "Required check"],
            rows: [
              ["iss", "Expected Atmosphere deployment."],
              ["aud", "Your registered `client_id`."],
              ["sub", "Selected DID; use as durable account identity."],
              ["handle", "Display/login hint only; handles can change."],
              ["return_uri", "Exact callback receiving the token."],
              ["state", "Fresh nonce from the initiating request."],
              ["exp / iat", "Short token lifetime and no future-issued token."],
              ["jti", "Reject replay until expiry."],
            ],
          },
          {
            type: "callout",
            title: "Selection is not authorization",
            body:
              "The selection token proves the user chose an account in Atmosphere. It does not give your app repository access, blob upload access, or a PDS session.",
            tone: "amber",
          },
        ],
      },
    ],
  },
  {
    slug: "oauth-handoff",
    group: "Guides",
    status: "Stable",
    navTitle: "OAuth handoff",
    title: "Complete the ATProto OAuth handoff",
    description:
      "After Atmosphere selection passes, start your app-owned AT Protocol OAuth flow with the selected account.",
    summary: [
      "Use the selected handle or DID as `login_hint`.",
      "Your app owns authorization scopes, token storage, refresh, and logout.",
      "Verify the OAuth token response `sub` DID according to the AT Protocol OAuth profile.",
    ],
    primaryCta: {
      label: "Example app",
      href: "/examples/atmosphere-login/app",
    },
    secondaryCta: {
      label: "ATProto OAuth spec",
      href: "https://atproto.com/specs/oauth",
    },
    nextSteps: [
      {
        title: "Production checklist",
        body:
          "Prepare return URIs, domain manifest, checks, and trusted review.",
        href: "/docs/production-checklist",
        label: "Prepare launch",
      },
      {
        title: "API reference",
        body: "Review endpoints, parameters, and helper exports.",
        href: "/docs/reference",
        label: "Reference",
      },
    ],
    sections: [
      {
        id: "handoff",
        eyebrow: "Boundary",
        title: "Atmosphere stops before app OAuth starts",
        blocks: [
          {
            type: "diagram",
            variant: "login",
            items: [
              {
                title: "Verified choice",
                body: "Your app accepts the signed selection token.",
              },
              {
                title: "Login hint",
                body: "Pass the handle or DID into your OAuth client.",
              },
              {
                title: "PDS/entryway",
                body: "The user authorizes your app with their account host.",
              },
              {
                title: "App session",
                body: "Your app stores its own OAuth/session state.",
              },
            ],
          },
          {
            type: "code",
            language: "ts",
            caption: "Start OAuth after selection",
            code: `if (!verified.ok) throw new Error(verified.error);

const loginHint = verified.claims.handle || verified.claims.sub;
const oauthUrl = await atprotoOAuthClient.authorizeUrl({
  loginHint,
  scope: "atproto",
});

return Response.redirect(oauthUrl);`,
          },
        ],
      },
      {
        id: "must-verify",
        title: "ATProto checks still apply",
        blocks: [
          {
            type: "checklist",
            items: [
              "Resolve and bind the selected account DID for the OAuth flow.",
              "Verify the authorization server is authoritative for the account.",
              "Check the token response `sub` matches the expected DID.",
              "Reject token responses that omit the `atproto` scope.",
              "Do not send your app OAuth access or refresh tokens to Atmosphere.",
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "production-checklist",
    group: "Guides",
    status: "Stable",
    navTitle: "Production checklist",
    title: "Prepare Atmosphere Login for production",
    description:
      "Run the checks needed before users see a trusted, production-ready picker handoff.",
    summary: [
      "Exact HTTPS return URI enforcement for production apps.",
      "Verified app identity with homepage, logo, and domain manifest.",
      "Clear readiness states: local development, needs fixes, ready for review, trusted, or blocked.",
    ],
    primaryCta: { label: "Developer apps", href: "/account/developer/apps" },
    secondaryCta: { label: "Troubleshooting", href: "/docs/troubleshooting" },
    nextSteps: [
      {
        title: "SDK reference",
        body:
          "Review browser attributes, helper methods, token claims, and errors.",
        href: "/docs/sdk-reference",
        label: "Reference",
      },
      {
        title: "Resources",
        body: "Download icons, badge assets, schemas, and examples.",
        href: "/docs/resources",
        label: "Assets",
      },
    ],
    sections: [
      {
        id: "readiness",
        eyebrow: "Checks",
        title: "Readiness states",
        blocks: [
          {
            type: "table",
            columns: ["State", "Meaning", "Next action"],
            rows: [
              [
                "Local development only",
                "Loopback or localhost URLs are present.",
                "Replace with HTTPS production URLs before review.",
              ],
              [
                "Needs production fixes",
                "One or more required checks failed.",
                "Open the app detail page and run checks.",
              ],
              [
                "Ready to request trusted review",
                "Production checks pass.",
                "Submit review notes.",
              ],
              [
                "Trusted",
                "Atmosphere reviewed the app identity.",
                "Keep metadata and return URIs stable.",
              ],
              [
                "Blocked",
                "Picker is unavailable for the app.",
                "Contact support.",
              ],
            ],
          },
        ],
      },
      {
        id: "checklist",
        title: "Production launch checklist",
        blocks: [
          {
            type: "checklist",
            items: [
              "Registered app name matches the public product.",
              "Client ID is HTTPS and controlled by the app.",
              "Homepage is HTTPS and reachable.",
              "Logo is HTTPS, reachable, and recognizable.",
              "Every production return URI is listed exactly.",
              "No local development URLs remain in production registration.",
              "Domain manifest matches the registered app metadata and return URIs.",
              "Picker test URL completes successfully.",
              "Selection token verification happens server-side.",
              "AT Protocol OAuth starts after selection and is owned by the app.",
            ],
          },
        ],
      },
      {
        id: "manifest",
        title: "Domain manifest",
        blocks: [
          {
            type: "code",
            language: "json",
            caption: "/.well-known/atmosphere-login.json",
            code: `{
  "version": "atmosphere.login.v0.1",
  "apps": [
    {
      "client_id": "https://app.example.com/oauth/client-metadata.json",
      "app_name": "Example App",
      "homepage": "https://app.example.com",
      "logo_uri": "https://app.example.com/icon.png",
      "allowed_return_uris": [
        "https://app.example.com/auth/atmosphere/selected"
      ]
    }
  ]
}`,
          },
        ],
      },
    ],
  },
  {
    slug: "troubleshooting",
    group: "Guides",
    status: "Stable",
    navTitle: "Troubleshooting",
    title: "Troubleshoot Atmosphere Login",
    description:
      "Common picker, callback, local development, and AT Protocol OAuth handoff issues.",
    summary: [
      "Most failures are return URI, state, token verification, or local-dev URL mismatches.",
      "Production apps should never rely on local callback exceptions.",
      "The picker selects an account; app OAuth failures are debugged in the app-owned OAuth flow.",
    ],
    primaryCta: {
      label: "Run test console",
      href: "/docs/atmosphere-login#test-console",
    },
    secondaryCta: {
      label: "Production checks",
      href: "/docs/production-checklist",
    },
    sections: [
      {
        id: "common-errors",
        eyebrow: "Debug",
        title: "Common errors",
        blocks: [
          {
            type: "table",
            columns: ["Symptom", "Likely cause", "Fix"],
            rows: [
              [
                "Invalid return URI",
                "The callback does not exactly match the registered URI.",
                "Copy the generated picker URL from the app detail page and add the exact callback.",
              ],
              [
                "State mismatch",
                "The callback does not match the initiating request.",
                "Use a fresh random state per attempt and bind it to the browser/session.",
              ],
              [
                "Selection token failed verification",
                "Issuer, audience, signature, expiry, return URI, or state mismatch.",
                "Log the verifier error and compare against registered app metadata.",
              ],
              [
                "Replayed token",
                "The same `jti` was already used.",
                "Store `jti` until expiry and restart the picker flow.",
              ],
              [
                "Popup blocked",
                "The browser blocked a non-user-initiated popup or third-party flow.",
                "Use redirect mode unless you have a strong popup reason. If you use popup mode, open it directly from a user click, keep the callback origin identical to the registered return URI origin, and avoid strict `Cross-Origin-Opener-Policy: same-origin` on pages that need the popup handoff.",
              ],
              [
                "No saved accounts shown",
                "The user has not used Atmosphere Login in this browser.",
                "Show add-account/sign-in in the picker and let the user continue normally.",
              ],
              [
                "OAuth login hint ignored",
                "The PDS/entryway may require its own account selection or identity resolution.",
                "Still verify the final OAuth `sub` DID matches the selected account.",
              ],
            ],
          },
        ],
      },
      {
        id: "localhost",
        title: "Localhost and 127.0.0.1",
        intro:
          "These names show up in different parts of the ATProto OAuth development story.",
        blocks: [
          {
            type: "table",
            columns: ["Value", "Where it belongs", "Why"],
            rows: [
              [
                "http://localhost/",
                "Development `client_id` shortcut",
                "ATProto OAuth defines this virtual client metadata exception so developers do not need to publish metadata while building.",
              ],
              [
                "http://127.0.0.1:<port>/callback",
                "Local return URI / OAuth redirect URI",
                "Loopback IP callbacks avoid ambiguous hostnames and match common OAuth local-app behavior.",
              ],
              [
                "https://app.example.com/callback",
                "Production return URI",
                "Production apps should use exact HTTPS callback URLs.",
              ],
            ],
          },
          {
            type: "callout",
            title: "Developers still need local docs",
            body:
              "Even if an app ultimately runs in production, developers usually test the picker and OAuth callback on a local server first. The docs separate local integration rules from production registration rules.",
          },
        ],
      },
    ],
  },
  {
    slug: "host-dashboard",
    group: "Hosts",
    status: "Stable",
    navTitle: "Host Account Routing",
    title: "Route users to host-owned account pages",
    description:
      "Publish a host service record so Atmosphere can send users to the account page where their PDS host manages account controls.",
    summary: [
      "Hosts declare their PDS service endpoint in `account.atmosphere.host.service`.",
      "Atmosphere derives `/account` from the PDS service endpoint; hosts can declare `accountManagementUrl` as a custom-route override.",
      "The PDS account page owns devices, OAuth grants, passwords, recovery, backups, and migration.",
      "Atmosphere does not implement those account-management tools; it links to the host that does.",
      "Optional manifests are compatibility metadata, not the primary account surface and not a delegation of account authority.",
    ],
    primaryCta: {
      label: "Register a host",
      href: "/hosts/register",
    },
    secondaryCta: {
      label: "Host directory",
      href: "/hosts",
    },
    nextSteps: [
      {
        title: "Review host lexicons",
        body:
          "Use the profile and service records as the source of truth for host pages.",
        href: "/docs/resources#schemas",
        label: "Resources",
      },
      {
        title: "Validate optional metadata",
        body:
          "Run the manifest validator only when claiming optional compatibility metadata.",
        href: "/docs/conformance",
        label: "Validate",
      },
    ],
    sections: [
      {
        id: "boundary",
        eyebrow: "Boundary",
        title: "Hosts remain the account authority",
        intro:
          "Atmosphere standardizes discovery and routing. The PDS account page owns grants, devices, passwords, keys, backups, restore, migration, account deletion, and account security.",
        blocks: [
          {
            type: "diagram",
            variant: "host",
            items: [
              {
                title: "Atmosphere account router",
                body:
                  "Shows where the account is hosted, explains the host in plain language, and links to the PDS account page.",
              },
              {
                title: "Host service record",
                body:
                  "The host declares its PDS endpoint and an optional custom account-page override.",
              },
              {
                title: "PDS account page",
                body:
                  "The user manages grants, devices, passwords, keys, backups, recovery, deletion, and migration at the host.",
              },
              {
                title: "Optional metadata",
                body:
                  "A manifest can describe support later, but it is not required for routing.",
              },
            ],
          },
          {
            type: "cards",
            items: [
              {
                title: "Build the PDS account page",
                body:
                  "Follow the official AT Protocol account-management guide for the host-owned controls and endpoints behind `/account`.",
                href: "https://atproto.com/guides/account-management",
                label: "Open ATProto guide",
              },
              {
                title: "Check the public route",
                body:
                  "Review how Atmosphere presents hosts and sends people to their host-owned account page.",
                href: "/hosts",
                label: "Open host directory",
              },
            ],
          },
        ],
      },
      {
        id: "service-record",
        eyebrow: "Service record",
        title: "Publish the host service",
        blocks: [
          {
            type: "paragraph",
            body:
              "Hosts publish `account.atmosphere.host.service` from the Atmosphere account that represents the host. The `serviceEndpoint` is the canonical PDS origin, and Atmosphere derives its `/account` page. Set `accountManagementUrl` only as an override for a custom account-management route. Never point it at a marketing homepage.",
          },
          {
            type: "code",
            language: "json",
            code: `{
  "host": "host.example",
  "displayName": "Example Host",
  "serviceEndpoint": "https://pds.host.example",
  "accountManagementUrl": "https://pds.host.example/account",
  "signup": {
    "status": "account.atmosphere.host.defs#signupOpen",
    "url": "https://host.example/signup"
  },
  "createdAt": "2026-06-26T00:00:00.000Z"
}`,
          },
          {
            type: "callout",
            title: "Optional manifest",
            body:
              "Hosts may still publish `/.well-known/atmosphere-host-dashboard.json` to describe detailed compatibility. The name is legacy; Atmosphere treats it as optional metadata and does not duplicate or operate account controls from it.",
          },
        ],
      },
      {
        id: "profile-record",
        eyebrow: "Profile record",
        title: "Publish the host profile",
        blocks: [
          {
            type: "paragraph",
            body:
              "The host profile is the friendly public card: name, description, avatar or logo, banner, links, contact, and the services it represents. Keep public copy understandable for people choosing where to host their account.",
          },
          {
            type: "code",
            language: "json",
            code: `{
  "name": "Example Host",
  "description": "A friendly account host for builders and small communities.",
  "avatar": {
    "ref": { "$link": "bafk..." },
    "mimeType": "image/png"
  },
  "links": [
    { "uri": "https://host.example", "label": "Website" },
    { "uri": "https://host.example/support", "label": "Support" }
  ],
  "createdAt": "2026-06-26T00:00:00.000Z"
}`,
          },
        ],
      },
      {
        id: "directory",
        title: "Connect a claimed host listing",
        blocks: [
          {
            type: "paragraph",
            body:
              "After a host is claimed in the Atmosphere host directory, the claiming Atmosphere account can open the host’s manage page, save the PDS service endpoint, and optionally validate compatibility metadata.",
          },
          {
            type: "callout",
            title: "Directory policy",
            body:
              "Claiming proves the host account can manage the listing. Atmosphere links to `/account` on the declared PDS endpoint unless the host publishes a custom override; richer compatibility badges still require validated metadata.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/hosts/{host}/manage",
            body:
              "Owner-only page for saving the PDS service endpoint, account page URL override, signup/support links, and optional compatibility manifest after the host has been claimed through OAuth.",
          },
        ],
      },
      {
        id: "capabilities",
        title: "Optional capability metadata",
        blocks: [
          {
            type: "callout",
            title: "Do not mirror PDS controls",
            body:
              "These keys are compatibility metadata for hosts and directories. Atmosphere should not render a parallel device, grant, password, backup, recovery, deletion, or migration control panel from them.",
          },
          {
            type: "table",
            columns: ["State", "Meaning"],
            rows: [
              [
                "supported",
                "The host supports a standardized route or module.",
              ],
              [
                "host_owned",
                "The host owns the workflow, but it is not standardized yet.",
              ],
              [
                "planned",
                "Expected later; Atmosphere should not show it as available.",
              ],
              ["unknown", "Status is unknown or intentionally undisclosed."],
            ],
          },
          {
            type: "table",
            columns: ["Capability", "Purpose"],
            rows: [
              ["accountOverview", "Profile, handle, DID, and host summary."],
              [
                "connectedApps",
                "OAuth grants and app permissions managed by the host.",
              ],
              ["devices", "Active sessions, devices, and saved sign-in keys."],
              ["password", "Password changes, reset, and auth methods."],
              ["accountDeletion", "Account deactivation and deletion."],
              ["rotationKeys", "Recovery and rotation-key status."],
              ["repoExport", "Signed repository export."],
              ["blobExport", "Media/blob export and coverage checks."],
              ["backupStatus", "Backup health and restore readiness."],
              ["restore", "Host-owned restore workflows."],
              ["migration", "Move readiness and destination-host handoff."],
              ["support", "Help, terms, privacy, and contact routes."],
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "conformance",
    group: "Hosts",
    status: "Stable",
    navTitle: "Conformance",
    title: "Validate host compatibility",
    description:
      "Use the validator before a host claims optional compatibility metadata or asks Atmosphere to show support badges.",
    summary: [
      "Validate a published manifest by host or URL.",
      "Validate a local JSON file during development.",
      "Treat warnings as compatibility cleanup and errors as badge blockers.",
      "Passing conformance can unlock directory signals; it does not delegate account-management authority to Atmosphere.",
    ],
    primaryCta: {
      label: "Validator API",
      href: "/api/hosts/dashboard/validate?host=host.example",
    },
    secondaryCta: { label: "Host directory", href: "/hosts" },
    sections: [
      {
        id: "cli",
        eyebrow: "CLI",
        title: "Run the local validator",
        blocks: [
          {
            type: "code",
            language: "sh",
            code: `deno task host:conformance host.example
deno task host:conformance host.example --json
deno task host:conformance host.example --write`,
          },
          {
            type: "callout",
            title: "Badge policy",
            body:
              "Atmosphere only shows a compatibility badge after the manifest, account route, and PDS health checks pass. Stored results expire after seven days. Public listing is separate: a host must be reachable and intentionally public, with a short grace period for temporarily inactive claimed hosts.",
          },
        ],
      },
      {
        id: "api",
        title: "Use the public validator API",
        blocks: [
          {
            type: "endpoint",
            method: "GET",
            path: "/api/hosts/dashboard/validate?host=host.example",
            body:
              "Fetches the host’s well-known manifest and validates it against the v0.1 contract.",
          },
          {
            type: "endpoint",
            method: "POST",
            path: "/api/hosts/dashboard/validate?host=host.example",
            body:
              "Validates the JSON request body directly. Useful for local previews, CI, and docs examples.",
          },
          {
            type: "code",
            language: "sh",
            code: `curl -X POST \\
  "https://atmosphereaccount.com/api/hosts/dashboard/validate?host=host.example" \\
  -H "content-type: application/json" \\
  --data-binary @manifest.json`,
          },
        ],
      },
      {
        id: "issues",
        title: "Validation result shape",
        blocks: [
          {
            type: "code",
            language: "json",
            code: `{
  "ok": false,
  "manifest": null,
  "issues": [
    {
      "severity": "error",
      "path": "$.capabilities.connectedApps.state",
      "message": "Capability state must be supported, host_owned, planned, or unknown."
    }
  ]
}`,
          },
        ],
      },
    ],
  },
  {
    slug: "resources",
    group: "Reference",
    status: "Stable",
    navTitle: "Resources",
    title: "Developer resources",
    description:
      "Download the shared assets, examples, schemas, and project icons used by Atmosphere apps and docs.",
    summary: [
      "Use the sign-in badge and logo to make Atmosphere Login recognizable.",
      "Download the Lottie animation and icon assets for product and docs surfaces.",
      "Use community app profiles, ATStore records, host lexicons, optional compatibility schemas, and SVG icon exports when building interoperable experiences.",
    ],
    primaryCta: {
      label: "Sign-in badge",
      href: "/sign-in-box.svg",
    },
    secondaryCta: {
      label: "Host manifest schema",
      href: "/atmosphere-host-dashboard.schema.json",
    },
    sections: [
      {
        id: "brand-assets",
        eyebrow: "Assets",
        title: "Sign-in and brand assets",
        blocks: [
          {
            type: "paragraph",
            body:
              "These are the lightweight assets from the old developer resources page, now folded into the docs.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/sign-in-box.svg",
            body: "SVG badge for sign-in pages and docs examples.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/union.svg",
            body: "Atmosphere Account logo mark.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/atmosphere-login.js",
            body: "Browser SDK for the Continue with Atmosphere button.",
          },
        ],
      },
      {
        id: "motion-assets",
        title: "Motion and icon bundles",
        blocks: [
          {
            type: "endpoint",
            method: "GET",
            path: "/atmosphere.json",
            body:
              "Original Atmosphere Lottie animation used for shared visual language.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/lottie-icons.zip",
            body: "Image assets embedded inside the Atmosphere animation.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/api/registry/icons.zip",
            body: "ZIP archive of current verified project SVG icons.",
          },
        ],
      },
      {
        id: "integration-examples",
        title: "Login integration examples",
        blocks: [
          {
            type: "endpoint",
            method: "GET",
            path: "/examples/atmosphere-login/app",
            body:
              "Executable Fresh/Deno reference app covering signed selection verification, app-owned AT Protocol OAuth, and the final app session.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/examples/atmosphere-login-plain.html",
            body:
              "Dependency-free browser button example; the callback still uses the server verifier before OAuth starts.",
          },
          {
            type: "endpoint",
            method: "GET",
            path:
              "https://github.com/jobiwanken0bi/atmosphere-account/tree/main/examples/nextjs-atmosphere-login",
            body: "Next.js App Router button and server Route Handler example.",
          },
        ],
      },
      {
        id: "schemas",
        title: "Schemas and examples",
        blocks: [
          {
            type: "endpoint",
            method: "GET",
            path: "/atmosphere-host-dashboard.schema.json",
            body:
              "JSON Schema for the optional host compatibility manifest. The file name is legacy; the manifest does not make Atmosphere the account-control surface.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/examples/atmosphere-host-dashboard.example.json",
            body:
              "Example manifest for PDS hosts declaring optional compatibility metadata and host-owned account-page links.",
          },
          {
            type: "endpoint",
            method: "GET",
            path:
              "https://lexicon.garden/lexicon/did:plc:2uwoih2htodskvgocarwv5eq/community.lexicon.app.profile/docs",
            body:
              "Community app profile lexicon docs for canonical app identity records.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "https://github.com/ATProtocol-Community/ATStore",
            body:
              "ATStore project source, including listing, review, and favorite record behavior.",
          },
          {
            type: "endpoint",
            method: "GET",
            path:
              "https://tangled.org/joebasser.com/atmosphere-account/blob/main/lexicons/account/atmosphere/host/profile.json",
            body: "Atmosphere host profile lexicon source.",
          },
          {
            type: "endpoint",
            method: "GET",
            path:
              "https://tangled.org/joebasser.com/atmosphere-account/blob/main/lexicons/account/atmosphere/host/service.json",
            body: "Atmosphere host service lexicon source.",
          },
          {
            type: "endpoint",
            method: "GET",
            path:
              "https://tangled.org/joebasser.com/atmosphere-account/blob/main/lexicons/com/atmosphereaccount/registry/profile.json",
            body:
              "Legacy Atmosphere app profile lexicon source. New listings should migrate to shared app records.",
          },
        ],
      },
      {
        id: "project-icons",
        title: "Project SVG icons",
        intro:
          "Current verified project icons for people building sign-in flows, app showcases, and directory experiences.",
        blocks: [{ type: "iconDownloads" }],
      },
    ],
  },
  {
    slug: "sdk-reference",
    group: "Reference",
    status: "Stable",
    navTitle: "SDK reference",
    title: "Atmosphere Login SDK reference",
    description:
      "Browser attributes, helper methods, server verifier exports, callback parameters, token claims, and common verifier errors.",
    summary: [
      "Use `/atmosphere-login.js` to render the button or build picker URLs.",
      "Use `/atmosphere-login-server.js` to fetch JWKS and verify selection tokens.",
      "Selection token claims are short-lived, audience-bound, and replay-resistant.",
    ],
    primaryCta: { label: "Add button", href: "/docs/add-button" },
    secondaryCta: { label: "Verify token", href: "/docs/verify-token" },
    nextSteps: [
      {
        title: "API reference",
        body: "Review hosted routes, JWKS, validator API, and local tasks.",
        href: "/docs/reference",
        label: "Open",
      },
      {
        title: "Troubleshooting",
        body: "Map verifier errors to concrete fixes.",
        href: "/docs/troubleshooting",
        label: "Debug",
      },
    ],
    sections: [
      {
        id: "browser",
        eyebrow: "Browser",
        title: "Static browser SDK",
        blocks: [
          {
            type: "endpoint",
            method: "GET",
            path: "/atmosphere-login.js",
            body:
              "Enhances `[data-atmosphere-login]` buttons and exposes `window.AtmosphereLogin` helpers.",
          },
          {
            type: "table",
            columns: ["Attribute", "Type", "Purpose"],
            rows: [
              [
                "data-atmosphere-login",
                "boolean",
                "Enhance this element as a Continue with Atmosphere button.",
              ],
              [
                "data-client-id",
                "URL",
                "Registered app client ID and selection-token audience.",
              ],
              [
                "data-return-uri",
                "URL",
                "Exact callback receiving the selection token.",
              ],
              [
                "data-scope",
                "string",
                "Optional picker context. App OAuth scopes are still separate.",
              ],
              [
                "data-state",
                "string",
                "Optional caller-provided nonce. If omitted, SDK generates one.",
              ],
              [
                "data-mode",
                "`redirect` | `popup`",
                "Redirect is the default and most reliable flow. Popup mode dispatches `atmosphere-login:complete` after origin, client, and state checks pass.",
              ],
              [
                "data-app-name",
                "string",
                "Fallback label/accessibility context.",
              ],
              [
                "data-app-homepage",
                "URL",
                "Fallback local metadata; registered metadata wins in picker identity.",
              ],
              [
                "data-atmosphere-origin",
                "URL",
                "Use a non-production Atmosphere deployment during local development.",
              ],
            ],
          },
          {
            type: "code",
            language: "js",
            caption: "Browser helpers",
            code: `const built = AtmosphereLogin.buildUrl({
  clientId: "https://app.example.com/oauth/client-metadata.json",
  returnUri: "https://app.example.com/auth/atmosphere/selected",
  scope: "atproto",
});

AtmosphereLogin.continueWithAtmosphere({
  clientId: "https://app.example.com/oauth/client-metadata.json",
  returnUri: "https://app.example.com/auth/atmosphere/selected",
});

const selection = AtmosphereLogin.consumeSelection({
  clientId: "https://app.example.com/oauth/client-metadata.json",
  expectedState: stateFromSession,
});

// By default, consumeSelection removes Atmosphere Login callback parameters
// from the address bar after reading them. Pass { clearUrl: false } only if
// your router needs to control URL cleanup itself.
//
// In popup mode, the callback page also posts the selection to window.opener.
// The opener SDK dispatches "atmosphere-login:complete" after validating the
// message origin, client ID, and state.`,
          },
        ],
      },
      {
        id: "server",
        title: "Server verifier",
        blocks: [
          {
            type: "endpoint",
            method: "GET",
            path: "/atmosphere-login-server.js",
            body:
              "ES module helper for server-side callback verification in Deno, Node-compatible runtimes, and examples.",
          },
          {
            type: "table",
            columns: ["Export", "Purpose"],
            rows: [
              [
                "fetchAtmosphereLoginPublicJwkForToken(token, origin)",
                "Fetches the public key whose `kid` matches the returned selection token. JWKS is cached briefly and refreshed on key miss.",
              ],
              [
                "fetchAtmosphereLoginPublicJwk(origin)",
                "Fetches a public key from `/oauth/jwks.json`; pass `{ kid }` when selecting explicitly. Supports `{ cache: false }` and `{ cacheTtlMs }`.",
              ],
              [
                "verifyAtmosphereLoginCallback(options)",
                "Reads callback params and verifies the embedded selection token.",
              ],
              [
                "verifyAtmosphereSelectionToken(options)",
                "Verifies a raw selection token against a JWK and expected claims.",
              ],
            ],
          },
        ],
      },
      {
        id: "request",
        title: "Picker request parameters",
        blocks: [
          {
            type: "table",
            columns: ["Parameter", "Required", "Meaning"],
            rows: [
              ["client_id", "Yes", "Registered app client ID."],
              [
                "return_uri",
                "Yes",
                "Exact callback URL for the selection token.",
              ],
              [
                "state",
                "Yes",
                "App nonce returned in params and token claims.",
              ],
              ["scope", "No", "Picker context; not an app OAuth grant."],
            ],
          },
        ],
      },
      {
        id: "callback",
        title: "Callback payload",
        blocks: [
          {
            type: "code",
            language: "txt",
            caption: "Query parameters",
            code: `selection_token=eyJ...
client_id=https://app.example.com/oauth/client-metadata.json
state=generated-state
did=did:plc:...
handle=alice.example
iss=https://login.atmosphereaccount.com`,
          },
          {
            type: "table",
            columns: ["Token claim", "Meaning"],
            rows: [
              ["iss", "Atmosphere deployment that signed the token."],
              ["aud", "Registered app client ID."],
              ["sub", "Selected ATProto account DID."],
              ["handle", "Selected account handle at selection time."],
              ["pds_url", "Optional known host/PDS hint."],
              ["return_uri", "Callback URL the token was delivered to."],
              ["state", "App nonce."],
              ["app_name", "Picker app identity shown to the user."],
              ["iat / exp", "Short token lifetime."],
              ["jti", "Replay key."],
            ],
          },
        ],
      },
      {
        id: "errors",
        title: "Verifier errors",
        blocks: [
          {
            type: "table",
            columns: ["Error", "Usually means"],
            rows: [
              [
                "missing selection_token",
                "The callback URL is wrong or the picker did not complete.",
              ],
              [
                "client_id parameter mismatch",
                "The callback does not match the expected app.",
              ],
              [
                "state parameter mismatch",
                "The app lost or changed the initiating nonce.",
              ],
              [
                "invalid signature",
                "The token is malformed or signed by the wrong key.",
              ],
              [
                "issuer mismatch",
                "The expected Atmosphere deployment is wrong.",
              ],
              [
                "audience mismatch",
                "The token was not minted for this app client ID.",
              ],
              [
                "return URI mismatch",
                "The callback does not match the token claim.",
              ],
              ["replayed token", "The `jti` has already been used."],
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "reference",
    group: "Reference",
    status: "Stable",
    navTitle: "API reference",
    title: "Reference",
    description:
      "Routes, scripts, files, and helper contracts exposed by Atmosphere Account.",
    summary: [
      "Use `/atmosphere-login.js` for the browser picker SDK.",
      "Use `/oauth/jwks.json` to verify selection tokens.",
      "Use `/api/hosts/dashboard/validate` only for optional host compatibility manifests. The endpoint name is legacy; validated metadata is not account-control delegation.",
    ],
    sections: [
      {
        id: "login",
        eyebrow: "Atmosphere Login",
        title: "Login endpoints",
        blocks: [
          {
            type: "endpoint",
            method: "GET",
            path: "/login/select",
            body:
              "Hosted account picker. Requires `client_id`, `return_uri`, and `state` query parameters.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/oauth/jwks.json",
            body:
              "Public JWKS used by relying apps to verify Atmosphere selection tokens.",
          },
          {
            type: "endpoint",
            method: "POST",
            path: "/api/login/selection",
            body:
              "Debug/verification endpoint for development consoles. Send `token` plus expected `client_id`, `return_uri`, `state`, and `iss`; browser-readable responses are limited to registered app return origins, and production apps should verify locally with the JWKS.",
          },
        ],
      },
      {
        id: "host-dashboard",
        eyebrow: "Host Compatibility",
        title: "Optional host manifest files and endpoints",
        blocks: [
          {
            type: "callout",
            title: "Legacy naming",
            body:
              "These files and endpoints still include `dashboard` in their paths for compatibility. They validate optional host metadata only. PDS-owned account management remains on the host account page.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/atmosphere-host-dashboard.schema.json",
            body: "JSON Schema for the optional host compatibility manifest.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/examples/atmosphere-host-dashboard.example.json",
            body: "Example manifest hosts can copy and adapt.",
          },
          {
            type: "endpoint",
            method: "GET",
            path: "/api/hosts/dashboard/validate?host=host.example",
            body: "Fetches and validates a published host manifest.",
          },
        ],
      },
      {
        id: "tasks",
        title: "Local tasks",
        blocks: [
          {
            type: "code",
            language: "sh",
            code: `deno task host:dashboard:check host.example
deno task check`,
          },
        ],
      },
    ],
  },
];

export const defaultDocsSlug = "overview";

export function getDocsPage(slug: string): DocsPage | null {
  return docsPages.find((page) => page.slug === slug) ?? null;
}

export function groupedDocsPages(): Array<
  { group: string; pages: DocsPage[] }
> {
  const groups = new Map<string, DocsPage[]>();
  for (const page of docsPages) {
    const pages = groups.get(page.group) ?? [];
    pages.push(page);
    groups.set(page.group, pages);
  }
  return [...groups.entries()].map(([group, pages]) => ({ group, pages }));
}
