import { startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState } from "preact/hooks";

type RegistrationOptionsJSON = Parameters<
  typeof startRegistration
>[0]["optionsJSON"];

interface PasskeyManagerProps {
  account: {
    did: string;
    handle: string;
  };
  returnTo: string;
}

interface PasskeyRecord {
  credentialId: string;
  name?: string | null;
  label?: string | null;
  createdAt?: string | number | null;
  lastUsedAt?: string | number | null;
  backupEligible?: boolean | null;
  backupState?: boolean | null;
  transports?: string[] | null;
}

interface JsonObject {
  [key: string]: unknown;
}

export default function PasskeyManager(
  { account, returnTo }: PasskeyManagerProps,
) {
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [needsReconfirmation, setNeedsReconfirmation] = useState(false);
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/passkeys", {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        const payload = await readJsonObject(response);
        if (!response.ok) throw managementApiError(response, payload);
        const records = Array.isArray(payload.passkeys)
          ? payload.passkeys.map(toPasskeyRecord).filter(isPasskeyRecord)
          : [];
        if (active) setPasskeys(records);
      } catch (error) {
        if (active) applyError(error);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const applyError = (error: unknown) => {
    const friendly = friendlyManagementError(error);
    setMessage(friendly.message);
    setNeedsReconfirmation(friendly.needsReconfirmation);
    setRecoveryUrl(friendly.recoveryUrl);
  };

  const clearFeedback = () => {
    setMessage(null);
    setSuccess(null);
    setNeedsReconfirmation(false);
    setRecoveryUrl(null);
  };

  const createPasskey = async () => {
    if (working) return;
    clearFeedback();
    if (typeof globalThis.PublicKeyCredential === "undefined") {
      setMessage("This browser does not support passkeys.");
      return;
    }
    setWorking(true);
    try {
      const optionsResponse = await fetch(
        "/api/passkeys/register/options",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      const optionsPayload = await readJsonObject(optionsResponse);
      if (!optionsResponse.ok) {
        throw managementApiError(optionsResponse, optionsPayload);
      }
      if (
        typeof optionsPayload.ceremony !== "string" ||
        !isJsonObject(optionsPayload.options)
      ) {
        throw new Error("Passkey enrollment returned an invalid response.");
      }

      const credential = await startRegistration({
        optionsJSON: optionsPayload
          .options as unknown as RegistrationOptionsJSON,
      });
      const verifyResponse = await fetch(
        "/api/passkeys/register/verify",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ceremony: optionsPayload.ceremony,
            response: credential,
            name: passkeyName.trim() || null,
          }),
        },
      );
      const verifyPayload = await readJsonObject(verifyResponse);
      if (!verifyResponse.ok) {
        throw managementApiError(verifyResponse, verifyPayload);
      }
      const passkey = toPasskeyRecord(verifyPayload.passkey);
      if (!passkey) {
        throw new Error("The new passkey could not be saved.");
      }
      setPasskeys((current) => [
        passkey,
        ...current.filter((item) => item.credentialId !== passkey.credentialId),
      ]);
      setPasskeyName("");
      setSuccess("Passkey added. You can now use it in universal sign in.");
    } catch (error) {
      applyError(error);
    } finally {
      setWorking(false);
    }
  };

  const deletePasskey = async (credentialId: string) => {
    if (deletingId) return;
    clearFeedback();
    setDeletingId(credentialId);
    try {
      const response = await fetch("/api/passkeys", {
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ credentialId }),
      });
      const payload = await readJsonObject(response);
      if (!response.ok) throw managementApiError(response, payload);
      setPasskeys((current) =>
        current.filter((item) => item.credentialId !== credentialId)
      );
      setConfirmDeleteId(null);
      setSuccess("Passkey removed.");
    } catch (error) {
      applyError(error);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div class="passkey-manager">
      <div class="passkey-manager-intro">
        <div>
          <p class="text-eyebrow">Universal sign in</p>
          <strong>Passkey settings</strong>
        </div>
      </div>

      <div class="passkey-create-row">
        <label for="passkey-name">
          <span>
            Passkey name <small>optional</small>
          </span>
          <input
            id="passkey-name"
            type="text"
            value={passkeyName}
            maxLength={80}
            autoComplete="off"
            placeholder="e.g. My iPhone"
            disabled={working || loading || needsReconfirmation}
            onInput={(event) => setPasskeyName(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          class="passkey-primary-button"
          disabled={working || loading || needsReconfirmation}
          onClick={createPasskey}
        >
          <KeyIcon />
          <span>{working ? "Waiting for your device…" : "Create passkey"}</span>
        </button>
      </div>

      <p class="passkey-manager-explainer">
        A passkey lets Face ID, Touch ID, your device passcode, or a security
        key confirm this account during universal sign in. A new app or new
        access request can still open your account host's authorization screen.
      </p>

      {(message || success) && (
        <div
          class={`passkey-feedback ${
            message ? "passkey-feedback--error" : "passkey-feedback--success"
          }`}
          role={message ? "alert" : "status"}
          aria-live="polite"
        >
          <span>{message ?? success}</span>
        </div>
      )}

      {needsReconfirmation && (
        <div class="passkey-reconfirm">
          <div>
            <strong>Verify with your account host</strong>
            <p>
              Passkey changes require a recent ATProto OAuth sign-in for this
              account.
            </p>
          </div>
          {recoveryUrl
            ? (
              <a class="passkey-secondary-button" href={recoveryUrl}>
                Reconfirm account
              </a>
            )
            : (
              <form method="post" action="/oauth/login">
                <input type="hidden" name="handle" value={account.handle} />
                <input type="hidden" name="next" value={returnTo} />
                <button type="submit" class="passkey-secondary-button">
                  Reconfirm account
                </button>
              </form>
            )}
        </div>
      )}

      <div class="passkey-list-heading">
        <h2>Your passkeys</h2>
        {!loading && (
          <span>
            {passkeys.length === 1
              ? "1 passkey"
              : `${passkeys.length} passkeys`}
          </span>
        )}
      </div>

      {loading
        ? <div class="passkey-empty" role="status">Loading passkeys…</div>
        : passkeys.length === 0
        ? (
          <div class="passkey-empty">
            <span class="passkey-empty-icon" aria-hidden="true">
              <KeyIcon />
            </span>
            <div>
              <strong>No passkeys yet</strong>
              <p>
                Create one when you are ready. Nothing will open until you
                choose the button above.
              </p>
            </div>
          </div>
        )
        : (
          <div class="passkey-list">
            {passkeys.map((passkey) => {
              const confirming = confirmDeleteId === passkey.credentialId;
              const deleting = deletingId === passkey.credentialId;
              return (
                <article class="passkey-row" key={passkey.credentialId}>
                  <span class="passkey-row-icon" aria-hidden="true">
                    <KeyIcon />
                  </span>
                  <div class="passkey-row-copy">
                    <strong>{passkeyLabel(passkey)}</strong>
                    <span>{passkeyMetadata(passkey)}</span>
                    {passkey.lastUsedAt && (
                      <small>Last used {formatDate(passkey.lastUsedAt)}</small>
                    )}
                  </div>
                  <div class="passkey-row-actions">
                    {confirming
                      ? (
                        <>
                          <span>Remove this passkey?</span>
                          <button
                            type="button"
                            class="passkey-delete-button is-confirm"
                            disabled={deleting || needsReconfirmation}
                            onClick={() => deletePasskey(passkey.credentialId)}
                          >
                            {deleting ? "Removing…" : "Remove"}
                          </button>
                          <button
                            type="button"
                            class="passkey-delete-button"
                            disabled={deleting}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Keep
                          </button>
                        </>
                      )
                      : (
                        <button
                          type="button"
                          class="passkey-delete-button"
                          disabled={needsReconfirmation}
                          onClick={() =>
                            setConfirmDeleteId(passkey.credentialId)}
                        >
                          Remove
                        </button>
                      )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
    </div>
  );
}

class PasskeyManagementApiError extends Error {
  status: number;
  recoveryUrl: string | null;

  constructor(message: string, status: number, recoveryUrl: string | null) {
    super(message);
    this.name = "PasskeyManagementApiError";
    this.status = status;
    this.recoveryUrl = recoveryUrl;
  }
}

function managementApiError(
  response: Response,
  payload: JsonObject,
): PasskeyManagementApiError {
  const message = typeof payload.error === "string"
    ? payload.error
    : typeof payload.message === "string"
    ? payload.message
    : "The passkey request could not be completed.";
  return new PasskeyManagementApiError(
    message,
    response.status,
    typeof payload.redirectUrl === "string" ? payload.redirectUrl : null,
  );
}

function friendlyManagementError(
  error: unknown,
): {
  message: string;
  needsReconfirmation: boolean;
  recoveryUrl: string | null;
} {
  if (error instanceof PasskeyManagementApiError) {
    const needsReconfirmation = error.status === 401 || error.status === 403;
    return {
      message: needsReconfirmation
        ? "Reconfirm this account before viewing or changing its passkeys."
        : error.message,
      needsReconfirmation,
      recoveryUrl: error.recoveryUrl,
    };
  }
  if (error instanceof Error) {
    if (error.name === "NotAllowedError" || error.name === "AbortError") {
      return {
        message:
          "Passkey creation was cancelled, timed out, or unavailable on this device.",
        needsReconfirmation: false,
        recoveryUrl: null,
      };
    }
    if (
      error.name === "InvalidStateError" ||
      passkeyErrorCode(error) === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
    ) {
      return {
        message: "This authenticator already has a passkey for the account.",
        needsReconfirmation: false,
        recoveryUrl: null,
      };
    }
    if (error.name === "SecurityError") {
      return {
        message: "Passkeys are not available on this account address.",
        needsReconfirmation: false,
        recoveryUrl: null,
      };
    }
    if (
      passkeyErrorCode(error) ===
        "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT" ||
      passkeyErrorCode(error) ===
        "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT" ||
      passkeyErrorCode(error) ===
        "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG"
    ) {
      return {
        message:
          "This device or security key does not support the requirements for this passkey.",
        needsReconfirmation: false,
        recoveryUrl: null,
      };
    }
  }
  return {
    message: error instanceof Error
      ? error.message
      : "The passkey request could not be completed.",
    needsReconfirmation: false,
    recoveryUrl: null,
  };
}

function passkeyErrorCode(error: Error): string | null {
  if (!("code" in error)) return null;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function toPasskeyRecord(value: unknown): PasskeyRecord | null {
  if (!isJsonObject(value) || typeof value.credentialId !== "string") {
    return null;
  }
  return {
    credentialId: value.credentialId,
    name: typeof value.name === "string" ? value.name : null,
    label: typeof value.label === "string" ? value.label : null,
    createdAt: readDateValue(value.createdAt),
    lastUsedAt: readDateValue(value.lastUsedAt),
    backupEligible: typeof value.backupEligible === "boolean"
      ? value.backupEligible
      : null,
    backupState: typeof value.backupState === "boolean"
      ? value.backupState
      : null,
    transports: Array.isArray(value.transports)
      ? value.transports.filter((item): item is string =>
        typeof item === "string"
      )
      : null,
  };
}

function isPasskeyRecord(value: PasskeyRecord | null): value is PasskeyRecord {
  return value !== null;
}

function readDateValue(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function passkeyLabel(passkey: PasskeyRecord): string {
  return passkey.name?.trim() || passkey.label?.trim() || "Passkey";
}

function passkeyMetadata(passkey: PasskeyRecord): string {
  const kind = passkey.backupState
    ? "Synced passkey"
    : passkey.backupEligible
    ? "Sync-capable passkey"
    : passkey.backupEligible === false
    ? "Device-bound passkey"
    : "Passkey";
  return passkey.createdAt
    ? `${kind} · Added ${formatDate(passkey.createdAt)}`
    : kind;
}

function formatDate(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

async function readJsonObject(response: Response): Promise<JsonObject> {
  if (response.status === 204) return {};
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
