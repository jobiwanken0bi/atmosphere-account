import { startAuthentication } from "@simplewebauthn/browser";
import { useState } from "preact/hooks";
import { safeBrowserNavigationUrl } from "../lib/browser-navigation.ts";

type AuthenticationOptionsJSON = Parameters<
  typeof startAuthentication
>[0]["optionsJSON"];

interface PasskeyLoginProps {
  clientId: string;
  returnUri: string;
  state: string;
  scope?: string | null;
  appName?: string;
  fallbackHref?: string;
}

interface JsonObject {
  [key: string]: unknown;
}

export default function PasskeyLogin(
  {
    clientId,
    returnUri,
    state,
    scope = null,
    appName,
    fallbackHref,
  }: PasskeyLoginProps,
) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null);

  const usePasskey = async () => {
    if (working) return;
    if (typeof globalThis.PublicKeyCredential === "undefined") {
      setMessage("This browser does not support passkeys.");
      setRecoveryUrl(null);
      return;
    }
    setWorking(true);
    setMessage(null);
    setRecoveryUrl(null);

    try {
      const optionsResponse = await fetch("/api/login/passkeys/options", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          return_uri: returnUri,
          state,
          scope,
        }),
      });
      const optionsPayload = await readJsonObject(optionsResponse);
      if (!optionsResponse.ok) {
        throw apiError(optionsResponse, optionsPayload, fallbackHref);
      }
      if (
        typeof optionsPayload.ceremony !== "string" ||
        !isJsonObject(optionsPayload.options)
      ) {
        throw new Error("Passkey sign in returned an invalid response.");
      }

      const credential = await startAuthentication({
        optionsJSON: optionsPayload
          .options as unknown as AuthenticationOptionsJSON,
      });
      const verifyResponse = await fetch("/api/login/passkeys/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ceremony: optionsPayload.ceremony,
          response: credential,
        }),
      });
      const verifyPayload = await readJsonObject(verifyResponse);
      if (!verifyResponse.ok) {
        throw apiError(verifyResponse, verifyPayload, fallbackHref);
      }
      const destination = safeBrowserNavigationUrl(
        verifyPayload.redirectUrl,
        globalThis.location.href,
      );
      if (!destination) {
        throw new Error("Passkey sign in did not return a destination.");
      }

      globalThis.location.assign(destination);
    } catch (error) {
      const friendly = friendlyPasskeyError(error);
      setMessage(friendly.message);
      setRecoveryUrl(friendly.recoveryUrl);
      setWorking(false);
    }
  };

  return (
    <section class="passkey-login" aria-labelledby="passkey-login-title">
      <div class="passkey-login-heading">
        <span class="passkey-login-icon" aria-hidden="true">
          <KeyIcon />
        </span>
        <span>
          <strong id="passkey-login-title">Use a passkey</strong>
          <small>
            Confirm with your device instead of reconnecting your account.
          </small>
        </span>
      </div>
      <button
        type="button"
        class="passkey-login-button"
        disabled={working}
        aria-describedby="passkey-login-note"
        onClick={usePasskey}
      >
        <KeyIcon />
        <span>{working ? "Waiting for your passkey…" : "Use a passkey"}</span>
      </button>
      <p id="passkey-login-note" class="passkey-login-note">
        {appName
          ? `Your account host may still ask you to approve access for ${appName}.`
          : "Your account host may still ask you to approve this app's access."}
      </p>
      {message && (
        <div class="passkey-feedback passkey-feedback--error" role="alert">
          <span>{message}</span>
          {recoveryUrl && <a href={recoveryUrl}>Reconnect your account</a>}
        </div>
      )}
    </section>
  );
}

class PasskeyApiError extends Error {
  status: number;
  recoveryUrl: string | null;

  constructor(message: string, status: number, recoveryUrl: string | null) {
    super(message);
    this.name = "PasskeyApiError";
    this.status = status;
    this.recoveryUrl = recoveryUrl;
  }
}

function apiError(
  response: Response,
  payload: JsonObject,
  fallbackHref?: string,
): PasskeyApiError {
  const message = typeof payload.error === "string"
    ? payload.error
    : typeof payload.message === "string"
    ? payload.message
    : "Passkey sign in could not be completed.";
  const responseRecoveryUrl = safeBrowserNavigationUrl(
    payload.redirectUrl,
    globalThis.location.href,
  );
  const safeFallbackHref = safeBrowserNavigationUrl(
    fallbackHref,
    globalThis.location.href,
  );
  const recoveryUrl = response.status === 401 || response.status === 403
    ? responseRecoveryUrl ?? safeFallbackHref
    : responseRecoveryUrl;
  return new PasskeyApiError(message, response.status, recoveryUrl);
}

function friendlyPasskeyError(
  error: unknown,
): { message: string; recoveryUrl: string | null } {
  if (error instanceof PasskeyApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        message:
          "This account needs to reconnect to its account host before the app can finish signing in.",
        recoveryUrl: error.recoveryUrl,
      };
    }
    return { message: error.message, recoveryUrl: error.recoveryUrl };
  }
  if (error instanceof Error) {
    if (error.name === "NotAllowedError" || error.name === "AbortError") {
      return {
        message:
          "Passkey verification was cancelled, timed out, or no matching passkey was available.",
        recoveryUrl: null,
      };
    }
    if (error.name === "SecurityError") {
      return {
        message: "Passkeys are not available on this sign-in address.",
        recoveryUrl: null,
      };
    }
  }
  return {
    message: error instanceof Error
      ? error.message
      : "Passkey sign in could not be completed.",
    recoveryUrl: null,
  };
}

async function readJsonObject(response: Response): Promise<JsonObject> {
  const value = await response.json().catch(() => null);
  return isJsonObject(value) ? value : {};
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function KeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="8.5" cy="12" r="3.5" />
      <path d="M12 12h8" />
      <path d="M17 12v3" />
      <path d="M20 12v2" />
    </svg>
  );
}
