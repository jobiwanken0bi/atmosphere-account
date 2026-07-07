import { useSignal } from "@preact/signals";
import { buildAtmosphereLoginUrl } from "../lib/atmosphere-login-sdk.ts";

interface DeveloperAppTestApp {
  clientId: string;
  appName: string;
  appUri: string | null;
  logoUri: string | null;
  allowedReturnUris: string[];
  status: string;
}

interface VerificationCheck {
  label: string;
  ok: boolean;
  detail: string;
}

interface VerificationResult {
  ok: boolean;
  message: string;
  checks: VerificationCheck[];
  payload: Record<string, unknown> | null;
}

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

export default function DeveloperAppTestConsole(
  { app, defaultOrigin }: { app: DeveloperAppTestApp; defaultOrigin: string },
) {
  const returnUri = useSignal(app.allowedReturnUris[0] ?? "");
  const state = useSignal(randomState());
  const copied = useSignal<string | null>(null);
  const verificationInput = useSignal("");
  const verification = useSignal<VerificationResult | null>(null);
  const verifying = useSignal(false);

  function pickerUrl(): string {
    if (!returnUri.value) return "";
    return buildAtmosphereLoginUrl({
      atmosphereOrigin: defaultOrigin,
      clientId: app.clientId,
      returnUri: returnUri.value,
      state: state.value,
      scope: "atproto",
    });
  }

  function expectedPayload(): string {
    return JSON.stringify(
      {
        callback_query: {
          iss: defaultOrigin,
          client_id: app.clientId,
          did: "did:plc:example",
          handle: "alice.example",
          state: state.value,
          selection_token:
            "eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0bW9zcGhlcmUtbG9naW4rand0...",
        },
        selection_token_claims: {
          iss: defaultOrigin,
          aud: app.clientId,
          sub: "did:plc:example",
          handle: "alice.example",
          return_uri: returnUri.value,
          state: state.value,
          scope: "atproto",
          pds_url: "https://bsky.social",
          app_name: app.appName,
          iat: 1767225600,
          exp: 1767225720,
          jti: "short-lived-replay-key",
        },
      },
      null,
      2,
    );
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied.value = key;
      setTimeout(() => {
        if (copied.value === key) copied.value = null;
      }, 1500);
    } catch {
      // Clipboard is best-effort in local/insecure browser contexts.
    }
  }

  async function verify() {
    const input = verificationInput.value.trim();
    if (!input) {
      verification.value = {
        ok: false,
        message: "Paste a callback URL or selection_token first.",
        checks: [],
        payload: null,
      };
      return;
    }
    verifying.value = true;
    try {
      const extracted = extractSelection(input);
      if (!extracted.token) {
        verification.value = {
          ok: false,
          message: "No selection_token found.",
          checks: [],
          payload: null,
        };
        return;
      }
      const response = await fetch("/api/login/selection", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          token: extracted.token,
          client_id: app.clientId,
          return_uri: returnUri.value,
          state: state.value,
        }),
      });
      const body = await response.json().catch(() => null);
      const payload = isRecord(body?.payload) ? body.payload : null;
      const checks = buildChecks({
        active: response.ok && Boolean(body?.active),
        error: typeof body?.error === "string" ? body.error : null,
        payload,
        expectedClientId: app.clientId,
        expectedReturnUri: returnUri.value,
        expectedState: state.value,
        callbackClientId: extracted.clientId,
        callbackState: extracted.state,
      });
      verification.value = {
        ok: checks.length > 0 && checks.every((check) => check.ok),
        message: response.ok && body?.active && body?.bound
          ? "Token signature and bindings pass."
          : response.ok && body?.active
          ? "Token signature is active. Check the bindings below."
          : body?.error || "Token is not active.",
        checks,
        payload,
      };
    } catch (error) {
      verification.value = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        checks: [],
        payload: null,
      };
    } finally {
      verifying.value = false;
    }
  }

  const url = pickerUrl();
  const payload = expectedPayload();

  return (
    <section class="glass account-developer-test-console">
      <div class="account-dashboard-section-head">
        <div>
          <p class="text-eyebrow">Test picker</p>
          <h2>Generate and verify a real handoff</h2>
          <p>
            Use one of this app's saved return URIs, open the picker, then paste
            the callback URL or `selection_token` here to verify the binding.
          </p>
        </div>
      </div>

      <div class="account-developer-test-grid">
        <label class="profile-form-field">
          <span class="profile-form-label">Return URI</span>
          <select
            class="profile-form-input"
            value={returnUri.value}
            onChange={(event) =>
              returnUri.value =
                (event.currentTarget as HTMLSelectElement).value}
          >
            {app.allowedReturnUris.map((uri) => (
              <option value={uri} key={uri}>{uri}</option>
            ))}
          </select>
        </label>

        <label class="profile-form-field">
          <span class="profile-form-label">State</span>
          <span class="login-console-state-row">
            <input
              class="profile-form-input"
              type="text"
              value={state.value}
              onInput={(event) =>
                state.value = (event.currentTarget as HTMLInputElement).value}
            />
            <button
              type="button"
              class="profile-form-button-secondary"
              onClick={() => (state.value = randomState())}
            >
              New state
            </button>
          </span>
        </label>
      </div>

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
          {copied.value === "url" ? "Copied" : "Copy picker URL"}
        </button>
      </div>

      {url && (
        <code class="login-console-url" title={url}>
          {url}
        </code>
      )}

      <div class="login-console-snippets">
        <Snippet
          label="Expected callback payload"
          text={payload}
          copied={copied.value === "payload"}
          onCopy={() => copy(payload, "payload")}
        />
        <Snippet
          label="Button metadata"
          text={buttonSnippet(app, returnUri.value)}
          copied={copied.value === "button"}
          onCopy={() => copy(buttonSnippet(app, returnUri.value), "button")}
        />
      </div>

      <div class="account-developer-verifier">
        <label class="profile-form-field">
          <span class="profile-form-label">
            Callback URL or selection_token
          </span>
          <textarea
            class="profile-form-input login-console-token-input"
            rows={5}
            value={verificationInput.value}
            onInput={(event) =>
              verificationInput.value =
                (event.currentTarget as HTMLTextAreaElement).value}
            placeholder={`${returnUri.value}?selection_token=...&client_id=${
              encodeURIComponent(app.clientId)
            }&state=${state.value}`}
          />
        </label>
        <div class="login-console-actions">
          <button
            type="button"
            class="profile-form-button-primary"
            disabled={verifying.value}
            onClick={verify}
          >
            {verifying.value ? "Verifying…" : "Verify handoff"}
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

        {verification.value?.checks.length
          ? (
            <div class="login-example-checks login-console-checks">
              {verification.value.checks.map((check) => (
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
          )
          : null}
      </div>
    </section>
  );
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

function buttonSnippet(app: DeveloperAppTestApp, returnUri: string): string {
  return `<button
  data-atmosphere-login
  data-client-id="${app.clientId}"
  data-return-uri="${returnUri}"
  data-scope="atproto"
  data-app-name="${app.appName}"
  data-app-logo="${app.logoUri ?? ""}"
  data-app-homepage="${app.appUri ?? ""}"
></button>`;
}

function extractSelection(value: string): {
  token: string | null;
  clientId: string | null;
  state: string | null;
} {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const url = new URL(value);
    return {
      token: url.searchParams.get("selection_token"),
      clientId: url.searchParams.get("client_id"),
      state: url.searchParams.get("state"),
    };
  }
  return { token: value, clientId: null, state: null };
}

function buildChecks(input: {
  active: boolean;
  error: string | null;
  payload: Record<string, unknown> | null;
  expectedClientId: string;
  expectedReturnUri: string;
  expectedState: string;
  callbackClientId: string | null;
  callbackState: string | null;
}): VerificationCheck[] {
  const payload = input.payload;
  const checks: VerificationCheck[] = [
    {
      label: "Signature and expiry",
      ok: input.active,
      detail: input.active
        ? "The token is signed by this Atmosphere deployment and is still active."
        : input.error ?? "The token could not be verified.",
    },
    {
      label: "Audience",
      ok: payload?.aud === input.expectedClientId,
      detail: `Expected ${input.expectedClientId}; token has ${
        stringClaim(payload, "aud") ?? "missing aud"
      }.`,
    },
    {
      label: "Return URI",
      ok: normalizeUrlClaim(payload?.return_uri) ===
        normalizeUrlClaim(input.expectedReturnUri),
      detail: `Expected ${input.expectedReturnUri}; token has ${
        stringClaim(payload, "return_uri") ?? "missing return_uri"
      }.`,
    },
    {
      label: "State",
      ok: payload?.state === input.expectedState,
      detail: `Expected ${input.expectedState}; token has ${
        stringClaim(payload, "state") ?? "missing state"
      }.`,
    },
  ];
  if (input.callbackClientId || input.callbackState) {
    checks.push({
      label: "Callback query",
      ok: input.callbackClientId === input.expectedClientId &&
        input.callbackState === input.expectedState,
      detail: `Callback query client_id=${
        input.callbackClientId ?? "missing"
      }, state=${input.callbackState ?? "missing"}.`,
    });
  }
  return checks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringClaim(
  value: Record<string, unknown> | null,
  key: string,
): string | null {
  const claim = value?.[key];
  return typeof claim === "string" ? claim : null;
}

function normalizeUrlClaim(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
