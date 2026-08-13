import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
  hasHostProfileResumeMarker,
  hostProfilePendingKey,
  hostProfileResumeLocation,
  hostProfileResumePath,
  hostProfileResumeProofKey,
  type PendingHostProfileAction,
  pendingHostProfileAction,
  pendingHostProfileEntriesForContext,
  withoutHostProfileResumeMarker,
} from "../lib/host-profile-resume.ts";
import {
  clearPendingBrowserAction,
  formDataEntries,
  formDataFromEntries,
  loadPendingBrowserAction,
  type PendingFormEntry,
  savePendingBrowserAction,
} from "../lib/pending-browser-action.ts";
import {
  type ContextualReauthorization,
  contextualReauthorization,
  contextualReauthorizationFromApiPayload,
} from "../lib/reauth-required.ts";
import { oauthCancellationLocation } from "../lib/oauth-cancellation.ts";
import {
  browserResumeMarkerValue,
  isFreshBrowserResumeMarker,
} from "../lib/browser-resume-marker.ts";
import ContextualReauthorizationDialog from "./ContextualReauthorizationDialog.tsx";

interface Props {
  did: string;
  host: string;
  targetName: string;
  currentHandle: string;
  initialSaved?: boolean;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
}

interface HostProfileResponseBody {
  ok?: unknown;
  detail?: string;
  error?: string;
  reauthUrl?: string;
  redirectUrl?: string;
}

/**
 * Enhances only the public host-profile submit button. The surrounding form
 * remains a normal multipart POST without JavaScript, while hydration adds the
 * IndexedDB handoff needed to carry an avatar File through management
 * reauthorization when an older session lacks the complete host grant.
 */
export default function HostProfileSaveButton(
  {
    did,
    host,
    targetName,
    currentHandle,
    initialSaved = false,
    rememberedAccounts = [],
  }: Props,
) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const submitting = useSignal(false);
  const message = useSignal("");
  const saved = useSignal(initialSaved);
  const reauthorization = useSignal<ContextualReauthorization | null>(null);
  const pendingKey = hostProfilePendingKey(did, host);
  const resumeProofKey = hostProfileResumeProofKey(pendingKey);

  const followReauthorization = async (
    response: Response,
    responseBody: HostProfileResponseBody | null,
    formData: FormData,
  ): Promise<boolean> => {
    const contextual = contextualReauthorizationFromApiPayload(responseBody) ??
      (hostProfileResponseNeedsAuthorization(response)
        ? contextualReauthorization({
          returnTo: hostProfileResumePath(
            new URL(currentRequestPath(), globalThis.location.origin),
          ),
          action: "host_manage",
          capabilities: ["host", "media"],
          targetName,
        })
        : null);
    if (!contextual) return false;
    try {
      await savePendingBrowserAction(
        pendingKey,
        pendingHostProfileAction(did, host, formDataEntries(formData)),
        { ownerDid: did },
      );
    } catch {
      message.value =
        "Could not preserve this host profile and avatar for authorization. Try again without leaving this page.";
      return true;
    }
    reauthorization.value = contextual;
    return true;
  };

  const save = async (formData: FormData) => {
    if (submitting.value) return;
    submitting.value = true;
    message.value = "";
    saved.value = false;
    try {
      const response = await fetch(currentRequestPath(), {
        method: "POST",
        headers: { accept: "application/json" },
        body: formData,
        // The enhanced endpoint normally responds with JSON. Keeping redirects
        // manual prevents an expired site session from silently fetching the
        // full sign-in page and being mistaken for a successful save.
        redirect: "manual",
      });
      const responseBody = await jsonBody(response);
      if (!response.ok) {
        if (await followReauthorization(response, responseBody, formData)) {
          return;
        }
        message.value = responseError(response, responseBody);
        return;
      }
      if (responseBody?.ok !== true) {
        message.value =
          "The host profile returned an invalid response. Try again.";
        return;
      }

      await clearPendingBrowserAction(pendingKey).catch(() => {});
      saved.value = true;
    } catch (error) {
      message.value = error instanceof Error
        ? error.message
        : "The host profile could not be saved. Try again.";
    } finally {
      submitting.value = false;
    }
  };

  useEffect(() => {
    const form = buttonRef.current?.form;
    if (!form) return;

    const clearSaved = () => {
      saved.value = false;
    };
    form.addEventListener("input", clearSaved);

    if (initialSaved) {
      const savedUrl = new URL(globalThis.location.href);
      if (savedUrl.searchParams.has("saved")) {
        savedUrl.searchParams.delete("saved");
        globalThis.history.replaceState(
          null,
          "",
          `${savedUrl.pathname}${savedUrl.search}${savedUrl.hash}`,
        );
      }
    }

    const onSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const formData = new FormData(form);
      formData.set("action", "save_profile");
      void save(formData);
    };
    form.addEventListener("submit", onSubmit);

    const cancellation = oauthCancellationLocation(
      globalThis.location.href,
      "host-profile",
    );
    if (cancellation.wasCancelled) {
      globalThis.history.replaceState(null, "", cancellation.cleanLocation);
      try {
        sessionStorage.removeItem(resumeProofKey);
      } catch {
        // Storage restrictions already prevent automatic replay.
      }
      void clearPendingBrowserAction(pendingKey).catch(() => {});
      return () => {
        form.removeEventListener("submit", onSubmit);
        form.removeEventListener("input", clearSaved);
      };
    }

    const url = new URL(globalThis.location.href);
    const resume = hostProfileResumeLocation(url);
    if (resume.hadMarker) {
      globalThis.history.replaceState(null, "", resume.cleanLocation);
    }
    let proof: string | null = null;
    try {
      proof = sessionStorage.getItem(resumeProofKey);
      sessionStorage.removeItem(resumeProofKey);
    } catch {
      // Fail closed: a return marker without same-tab proof never writes.
    }
    if (
      !resume.shouldResume ||
      !isFreshBrowserResumeMarker(proof)
    ) {
      // Clear an abandoned draft on a later ordinary visit as well as forged
      // or malformed return markers.
      void clearPendingBrowserAction(pendingKey).catch(() => {});
      return () => {
        form.removeEventListener("submit", onSubmit);
        form.removeEventListener("input", clearSaved);
      };
    }
    let cancelled = false;
    (async () => {
      const pending = await loadPendingBrowserAction<PendingHostProfileAction>(
        pendingKey,
      ).catch(() => null);
      const entries = pendingHostProfileEntriesForContext(pending, did, host);
      if (!entries) {
        if (pending) {
          await clearPendingBrowserAction(pendingKey).catch(() => {});
        }
        return;
      }
      if (cancelled) return;
      restoreFormEntries(form, entries);
      const formData = formDataFromEntries(entries);
      formData.set("action", "save_profile");
      await save(formData);
    })();

    return () => {
      cancelled = true;
      form.removeEventListener("submit", onSubmit);
      form.removeEventListener("input", clearSaved);
    };
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        class="directory-register-button host-manage-save"
        type="submit"
        name="action"
        value="save_profile"
        disabled={submitting.value}
      >
        <span>
          {submitting.value ? "Saving changes…" : "Save changes"}
        </span>
      </button>
      {saved.value && (
        <span class="host-manage-saved" role="status">
          <span aria-hidden="true">✓</span>
          Saved
        </span>
      )}
      {message.value && (
        <p
          class="profile-form-status profile-form-status--error"
          role="alert"
        >
          {message.value}
        </p>
      )}
      {reauthorization.value && (
        <ContextualReauthorizationDialog
          authorization={reauthorization.value}
          currentDid={did}
          currentHandle={currentHandle}
          rememberedAccounts={rememberedAccounts}
          restrictToCurrentAccount
          onAuthorizationStart={() => {
            armHostProfileResume(resumeProofKey);
          }}
          onClose={() => {
            reauthorization.value = null;
            void cancelHostProfileReauthorization(pendingKey);
          }}
        />
      )}
    </>
  );
}

export async function cancelHostProfileReauthorization(
  pendingKey: string,
  options: {
    href?: string;
    replaceLocation?: (location: string) => void;
    clearPending?: (key: string) => Promise<void>;
    storage?: Pick<Storage, "removeItem">;
  } = {},
): Promise<void> {
  const href = options.href ?? globalThis.location.href;
  const url = new URL(href, "https://atmosphere.invalid");
  if (hasHostProfileResumeMarker(url)) {
    (options.replaceLocation ??
      ((location) => globalThis.history.replaceState(null, "", location)))(
        withoutHostProfileResumeMarker(url),
      );
  }
  try {
    (options.storage ?? globalThis.sessionStorage).removeItem(
      hostProfileResumeProofKey(pendingKey),
    );
  } catch {
    // IndexedDB cleanup below remains necessary when storage is blocked.
  }
  await (options.clearPending ?? clearPendingBrowserAction)(pendingKey).catch(
    () => {},
  );
}

export function armHostProfileResume(
  proofKey: string,
  storage: Pick<Storage, "setItem"> = globalThis.sessionStorage,
): boolean {
  try {
    storage.setItem(proofKey, browserResumeMarkerValue());
    return true;
  } catch {
    return false;
  }
}

function currentRequestPath(): string {
  return `${globalThis.location.pathname}${globalThis.location.search}`;
}

export function hostProfileResponseNeedsAuthorization(
  response: Pick<Response, "status" | "type" | "redirected" | "url">,
): boolean {
  if (response.status === 401 || response.type === "opaqueredirect") {
    return true;
  }
  if (!response.redirected || !response.url) return false;
  try {
    return new URL(response.url, "https://atmosphere.invalid").pathname ===
      "/signin";
  } catch {
    return false;
  }
}

async function jsonBody(
  response: Response,
): Promise<HostProfileResponseBody | null> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return null;
  }
  const value = await response.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as HostProfileResponseBody
    : null;
}

function responseError(
  response: Response,
  body: HostProfileResponseBody | null,
): string {
  if (typeof body?.detail === "string" && body.detail.trim()) {
    return body.detail;
  }
  if (typeof body?.error === "string" && body.error.trim()) {
    return body.error;
  }
  return response.status === 413
    ? "Host avatars must be under 1 MB."
    : "The host profile could not be saved. Try again.";
}

function restoreFormEntries(
  form: HTMLFormElement,
  entries: readonly PendingFormEntry[],
): void {
  const byName = new Map<string, Array<string | File>>();
  for (const [name, value] of entries) {
    const values = byName.get(name) ?? [];
    values.push(value);
    byName.set(name, values);
  }

  for (const control of Array.from(form.elements)) {
    if (
      !(control instanceof HTMLInputElement) &&
      !(control instanceof HTMLTextAreaElement) &&
      !(control instanceof HTMLSelectElement)
    ) continue;
    const values = byName.get(control.name);
    if (!control.name || !values) continue;
    if (control instanceof HTMLInputElement && control.type === "file") {
      const files = values.filter((value): value is File =>
        value instanceof File
      );
      if (files.length === 0 || typeof DataTransfer === "undefined") continue;
      try {
        const transfer = new DataTransfer();
        for (const file of files) transfer.items.add(file);
        control.files = transfer.files;
      } catch {
        // The reconstructed FormData still carries the File for this retry.
      }
      continue;
    }
    if (
      control instanceof HTMLInputElement &&
      (control.type === "checkbox" || control.type === "radio")
    ) {
      control.checked = values.some((value) => value === control.value);
      continue;
    }
    const stringValue = values.find((value): value is string =>
      typeof value === "string"
    );
    if (stringValue !== undefined) control.value = stringValue;
  }
}
