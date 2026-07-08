import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { buildAtmosphereLoginUrl } from "../lib/atmosphere-login-sdk.ts";
import {
  type AtmosphereLoginButtonMode,
  atmosphereLoginScriptSnippet,
  loginButtonSnippet,
} from "../lib/atmosphere-login-snippets.ts";

interface RegisteredLoginApp {
  clientId: string;
  appName: string;
  appUri: string;
  logoUri: string | null;
  allowedReturnUris: string[];
  status: string;
  reviewStatus: string;
}

interface TokenVerification {
  ok: boolean;
  message: string;
  payload?: Record<string, unknown> | null;
}

interface VerificationCheck {
  label: string;
  ok: boolean;
  detail: string;
}

const BUTTON_MODES: AtmosphereLoginButtonMode[] = ["redirect", "popup"];

function randomState(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

export default function AtmosphereLoginConsole(
  { defaultOrigin }: { defaultOrigin: string },
) {
  const initialOrigin = defaultAtmosphereOrigin(defaultOrigin);
  const atmosphereOrigin = useSignal(initialOrigin);
  const clientId = useSignal(
    new URL("/examples/atmosphere-login/client-metadata.json", initialOrigin)
      .toString(),
  );
  const returnUri = useSignal(
    new URL("/examples/atmosphere-login/callback", initialOrigin).toString(),
  );
  const scope = useSignal("atproto");
  const mode = useSignal<AtmosphereLoginButtonMode>("redirect");
  const state = useSignal(randomState());
  const copied = useSignal<string | null>(null);
  const registeredApps = useSignal<RegisteredLoginApp[]>([]);
  const selectedClientId = useSignal("");
  const appsLoaded = useSignal(false);
  const appsLoadError = useSignal(false);
  const verificationToken = useSignal("");
  const verification = useSignal<TokenVerification | null>(null);
  const verifying = useSignal(false);

  useEffect(() => {
    let active = true;
    fetch("/api/account/developer/apps", {
      headers: { accept: "application/json" },
    })
      .then((response) => response.ok ? response.json() : { apps: [] })
      .then((body) => {
        if (!active) return;
        const apps = Array.isArray(body.apps) ? body.apps : [];
        registeredApps.value = apps;
        appsLoaded.value = true;
        appsLoadError.value = false;
        if (apps.length > 0 && !selectedClientId.value) {
          applyRegisteredApp(apps[0]);
        }
      })
      .catch(() => {
        if (!active) return;
        appsLoaded.value = true;
        appsLoadError.value = true;
      });
    return () => {
      active = false;
    };
  }, []);

  function applyRegisteredApp(app: RegisteredLoginApp) {
    selectedClientId.value = app.clientId;
    clientId.value = app.clientId;
    if (app.allowedReturnUris[0]) {
      returnUri.value = app.allowedReturnUris[0];
    }
  }

  function selectRegisteredApp(value: string) {
    selectedClientId.value = value;
    const app = registeredApps.value.find((entry) => entry.clientId === value);
    if (app) applyRegisteredApp(app);
  }

  function selectButtonMode(nextMode: AtmosphereLoginButtonMode) {
    mode.value = nextMode;
    if (!selectedClientId.value && isReferenceCallbackUri(returnUri.value)) {
      const nextReturnUri = referenceCallbackUri(
        nextMode,
        atmosphereOrigin.value,
      );
      if (nextReturnUri) returnUri.value = nextReturnUri;
    }
  }

  function pickerUrl(): string {
    if (!atmosphereOrigin.value || !clientId.value || !returnUri.value) {
      return "";
    }
    try {
      return buildAtmosphereLoginUrl({
        atmosphereOrigin: atmosphereOrigin.value,
        clientId: clientId.value,
        returnUri: returnUri.value,
        state: state.value || randomState(),
        scope: scope.value || null,
      });
    } catch {
      return "";
    }
  }

  function regenerateState() {
    state.value = randomState();
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied.value = key;
      setTimeout(() => {
        if (copied.value === key) copied.value = null;
      }, 1500);
    } catch {
      // Clipboard writes are best-effort in local/insecure contexts.
    }
  }

  async function verifySelectionToken() {
    const token = verificationToken.value.trim();
    if (!token) {
      verification.value = {
        ok: false,
        message: "Paste a selection_token first.",
        payload: null,
      };
      return;
    }
    verifying.value = true;
    try {
      const response = await fetch("/api/login/selection", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          token,
          client_id: clientId.value,
          return_uri: returnUri.value,
          state: state.value,
          iss: atmosphereOrigin.value,
        }),
      });
      const body = await response.json().catch(() => null);
      verification.value = {
        ok: response.ok && Boolean(body?.active) && Boolean(body?.bound),
        message: response.ok && body?.active && body?.bound
          ? "Signature, expiry, and callback bindings passed."
          : body?.error || "The token is not active.",
        payload: isRecord(body?.payload) ? body.payload : null,
      };
    } catch (error) {
      verification.value = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        payload: null,
      };
    } finally {
      verifying.value = false;
    }
  }

  const url = pickerUrl();
  const selectedApp =
    registeredApps.value.find((app) =>
      app.clientId === selectedClientId.value
    ) ?? null;
  const callbackShape = JSON.stringify(
    {
      query: {
        selection_token:
          "eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0bW9zcGhlcmUtbG9naW4rand0...",
        client_id: clientId.value,
        state: state.value,
        did: "did:plc:example",
        handle: "alice.example",
        iss: atmosphereOrigin.value,
      },
      selection_token_claims: {
        iss: atmosphereOrigin.value,
        aud: clientId.value,
        sub: "did:plc:example",
        handle: "alice.example",
        return_uri: returnUri.value,
        state: state.value,
        scope: scope.value || "atproto",
        pds_url: "https://bsky.social",
        app_name: selectedApp?.appName || "Example App",
        iat: 1767225600,
        exp: 1767225900,
        jti: "short-lived-replay-key",
      },
    },
    null,
    2,
  );
  const htmlSnippet = `${
    loginButtonSnippet({
      clientId: clientId.value,
      appName: selectedApp?.appName || "Example App",
      appUri: selectedApp?.appUri || null,
      logoUri: selectedApp?.logoUri || null,
    }, {
      returnUri: returnUri.value,
      scope: scope.value,
      mode: mode.value,
    })
  }
${atmosphereLoginScriptSnippet(atmosphereOrigin.value)}`;
  const verifierSnippet =
    `import { verifyAtmosphereLoginCallback } from "@atmosphere/login/server";

const result = await verifyAtmosphereLoginCallback({
  url: request.url,
  publicJwk,
  expectedIssuer: "${atmosphereOrigin.value}",
  expectedClientId: "${clientId.value}",
  expectedState: stateFromSession,
  expectedReturnUri: "${returnUri.value}",
  replayStore,
});

if (!result.ok) throw new Error(result.error);
const { sub: did, handle, pds_url } = result.claims;`;
  const verificationChecks = buildVerificationChecks(
    verification.value,
    clientId.value,
    returnUri.value,
    state.value,
  );

  return (
    <div class="login-console glass">
      <div class="login-console-head">
        <div>
          <p class="text-eyebrow">Test console</p>
          <h3>Generate a picker request</h3>
          <p>
            This uses the local reference callback so you can try the complete
            account-selection handoff in dev.
          </p>
        </div>
        <a
          class="profile-form-button-secondary profile-form-button-secondary--lg"
          href="/examples/atmosphere-login/client-metadata.json"
          target="_blank"
          rel="noopener noreferrer"
        >
          Metadata
        </a>
      </div>

      <div class="login-console-grid">
        <label class="profile-form-field login-console-wide">
          <span class="profile-form-label">Registered app</span>
          <select
            class="profile-form-input"
            value={selectedClientId.value}
            onChange={(event) =>
              selectRegisteredApp(
                (event.currentTarget as HTMLSelectElement).value,
              )}
          >
            {registeredApps.value.length === 0 && (
              <option value="">
                {appsLoaded.value
                  ? "Use the reference example app"
                  : "Loading registered apps…"}
              </option>
            )}
            {registeredApps.value.map((app) => (
              <option value={app.clientId} key={app.clientId}>
                {app.appName} - {loginAppStatusLabel(app.status)}
              </option>
            ))}
          </select>
          <span class="profile-form-hint">
            {selectedApp
              ? `Using ${selectedApp.allowedReturnUris.length} saved return URI${
                selectedApp.allowedReturnUris.length === 1 ? "" : "s"
              } for ${selectedApp.appName}.`
              : appsLoadError.value
              ? "Registered apps could not be loaded; the reference app still works."
              : "Sign in and register an app to generate URLs from saved metadata."}
          </span>
        </label>
        <label class="profile-form-field">
          <span class="profile-form-label">Atmosphere origin</span>
          <input
            class="profile-form-input"
            type="url"
            value={atmosphereOrigin.value}
            onInput={(
              event,
            ) => (atmosphereOrigin.value =
              (event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="profile-form-field">
          <span class="profile-form-label">Client ID</span>
          <input
            class="profile-form-input"
            type="url"
            value={clientId.value}
            onInput={(
              event,
            ) => (clientId.value =
              (event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="profile-form-field">
          <span class="profile-form-label">Return URI</span>
          {selectedApp && selectedApp.allowedReturnUris.length > 0
            ? (
              <select
                class="profile-form-input"
                value={returnUri.value}
                onChange={(event) =>
                  returnUri.value =
                    (event.currentTarget as HTMLSelectElement).value}
              >
                {selectedApp.allowedReturnUris.map((uri) => (
                  <option value={uri} key={uri}>{uri}</option>
                ))}
              </select>
            )
            : (
              <input
                class="profile-form-input"
                type="url"
                value={returnUri.value}
                onInput={(
                  event,
                ) => (returnUri.value =
                  (event.currentTarget as HTMLInputElement).value)}
              />
            )}
        </label>
        <label class="profile-form-field">
          <span class="profile-form-label">Scope hint</span>
          <input
            class="profile-form-input"
            type="text"
            value={scope.value}
            onInput={(
              event,
            ) => (scope.value =
              (event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <div class="profile-form-field">
          <span class="profile-form-label">Button mode</span>
          <div
            class="login-console-mode-control"
            role="group"
            aria-label="Button mode"
          >
            {BUTTON_MODES.map((option) => (
              <button
                key={option}
                type="button"
                class={`login-console-mode-option ${
                  mode.value === option ? "is-active" : ""
                }`}
                aria-pressed={mode.value === option}
                onClick={() => selectButtonMode(option)}
              >
                {option === "redirect" ? "Redirect" : "Popup"}
              </button>
            ))}
          </div>
          <span class="profile-form-hint">
            Redirect is the safest default. Popup mode uses the SDK completion
            event to return to the app page.
          </span>
        </div>
      </div>

      <label class="profile-form-field">
        <span class="profile-form-label">State</span>
        <span class="login-console-state-row">
          <input
            class="profile-form-input"
            type="text"
            value={state.value}
            onInput={(
              event,
            ) => (state.value =
              (event.currentTarget as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="profile-form-button-secondary"
            onClick={regenerateState}
          >
            New state
          </button>
        </span>
      </label>

      <div class="login-console-actions">
        <a
          class={`explore-cta-primary ${url ? "" : "is-disabled"}`}
          href={url || "#"}
        >
          Open picker
        </a>
        <button
          type="button"
          class="profile-form-button-secondary profile-form-button-secondary--lg"
          disabled={!url}
          onClick={() => copy(url, "url")}
        >
          {copied.value === "url" ? "Copied" : "Copy URL"}
        </button>
      </div>

      {url && (
        <code class="login-console-url" title={url}>
          {url}
        </code>
      )}

      <div class="login-console-snippets">
        <Snippet
          label="Callback payload shape"
          text={callbackShape}
          copied={copied.value === "payload"}
          onCopy={() => copy(callbackShape, "payload")}
        />
        <Snippet
          label="Button HTML"
          text={htmlSnippet}
          copied={copied.value === "html"}
          onCopy={() => copy(htmlSnippet, "html")}
        />
        <Snippet
          label="Server verifier"
          text={verifierSnippet}
          copied={copied.value === "verifier"}
          onCopy={() => copy(verifierSnippet, "verifier")}
        />
      </div>

      <div class="login-console-verifier">
        <div>
          <p class="text-eyebrow">Verify a token</p>
          <h3>
            Paste <code>selection_token</code>
          </h3>
          <p>
            The console checks the token signature and the same audience, state,
            and return URI bindings your callback should enforce.
          </p>
        </div>
        <label class="profile-form-field">
          <span class="profile-form-label">Selection token</span>
          <textarea
            class="profile-form-input login-console-token-input"
            rows={4}
            value={verificationToken.value}
            onInput={(event) =>
              verificationToken.value =
                (event.currentTarget as HTMLTextAreaElement).value}
            placeholder="eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0bW9zcGhlcmUtbG9naW4rand0..."
          />
        </label>
        <div class="login-console-actions">
          <button
            type="button"
            class="profile-form-button-primary"
            disabled={verifying.value}
            onClick={verifySelectionToken}
          >
            {verifying.value ? "Verifying…" : "Verify token"}
          </button>
          {verification.value && (
            <span
              class={`login-console-verifier-status ${
                verification.value.ok
                  ? "login-console-verifier-status--ok"
                  : "login-console-verifier-status--error"
              }`}
            >
              {verification.value.message}
            </span>
          )}
        </div>
        {verificationChecks.length > 0 && (
          <div class="login-example-checks login-console-checks">
            {verificationChecks.map((check) => (
              <article
                class={`login-example-check ${
                  check.ok
                    ? "login-example-check--ok"
                    : "login-example-check--error"
                }`}
                key={check.label}
              >
                <span>{check.ok ? "Pass" : "Fail"}</span>
                <strong>{check.label}</strong>
                <p>{check.detail}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function defaultAtmosphereOrigin(origin: string): string {
  try {
    const url = new URL(origin || "https://login.atmosphereaccount.com");
    if (
      url.protocol === "https:" &&
      (url.hostname === "atmosphereaccount.com" ||
        url.hostname === "www.atmosphereaccount.com")
    ) {
      return "https://login.atmosphereaccount.com";
    }
    return url.origin;
  } catch {
    return "https://login.atmosphereaccount.com";
  }
}

function referenceCallbackUri(
  mode: AtmosphereLoginButtonMode,
  origin: string,
): string | null {
  try {
    const url = new URL("/examples/atmosphere-login/callback", origin);
    if (mode === "popup") url.searchParams.set("mode", "popup");
    return url.toString();
  } catch {
    return null;
  }
}

function isReferenceCallbackUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.pathname === "/examples/atmosphere-login/callback" &&
      (url.search === "" || url.search === "?mode=popup");
  } catch {
    return false;
  }
}

function Snippet(
  { label, text, copied, onCopy }: {
    label: string;
    text: string;
    copied: boolean;
    onCopy: () => void;
  },
) {
  return (
    <div class="api-playground-snippet">
      <div class="api-playground-snippet-header">
        <span class="api-playground-label">{label}</span>
        <button type="button" class="api-playground-copy" onClick={onCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre class="api-playground-pre"><code>{text}</code></pre>
    </div>
  );
}

function loginAppStatusLabel(status: string): string {
  switch (status) {
    case "trusted":
      return "Trusted";
    case "blocked":
      return "Blocked";
    case "development":
      return "Development";
    default:
      return "Unverified";
  }
}

function buildVerificationChecks(
  verification: TokenVerification | null,
  expectedClientId: string,
  expectedReturnUri: string,
  expectedState: string,
): VerificationCheck[] {
  if (!verification) return [];
  const payload = verification.payload;
  return [
    {
      label: "Signature and expiry",
      ok: verification.ok,
      detail: verification.message,
    },
    {
      label: "Audience",
      ok: payload?.aud === expectedClientId,
      detail: `Expected ${expectedClientId}; token has ${
        typeof payload?.aud === "string" ? payload.aud : "missing aud"
      }.`,
    },
    {
      label: "Return URI",
      ok: payload?.return_uri === expectedReturnUri,
      detail: `Expected ${expectedReturnUri}; token has ${
        typeof payload?.return_uri === "string"
          ? payload.return_uri
          : "missing return_uri"
      }.`,
    },
    {
      label: "State",
      ok: payload?.state === expectedState,
      detail: `Expected ${expectedState}; token has ${
        typeof payload?.state === "string" ? payload.state : "missing state"
      }.`,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
