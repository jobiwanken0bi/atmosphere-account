import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
  hasHostProfileResumeMarker,
  hostProfilePendingKey,
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
import { reauthUrlFromApiPayload } from "../lib/reauth-required.ts";

interface Props {
  did: string;
  host: string;
}

interface HostProfileResponseBody {
  detail?: string;
  error?: string;
  reauthUrl?: string;
  redirectUrl?: string;
}

/**
 * Enhances only the public host-profile submit button. The surrounding form
 * remains a normal multipart POST without JavaScript, while hydration adds the
 * IndexedDB handoff needed to carry an avatar File through any forced OAuth
 * reauthorization (for example, an older session that predates the complete
 * host-and-image grant).
 */
export default function HostProfileSaveButton({ did, host }: Props) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const submitting = useSignal(false);
  const message = useSignal("");
  const pendingKey = hostProfilePendingKey(did, host);

  const followReauthorization = async (
    responseBody: HostProfileResponseBody | null,
    formData: FormData,
  ): Promise<boolean> => {
    const reauthUrl = reauthUrlFromApiPayload(responseBody);
    if (!reauthUrl) return false;
    try {
      await savePendingBrowserAction(
        pendingKey,
        pendingHostProfileAction(did, host, formDataEntries(formData)),
      );
    } catch {
      message.value =
        "Could not preserve this host profile and avatar for authorization. Try again without leaving this page.";
      return true;
    }
    globalThis.location.assign(reauthUrl);
    return true;
  };

  const save = async (formData: FormData) => {
    if (submitting.value) return;
    submitting.value = true;
    message.value = "";
    try {
      const response = await fetch(currentRequestPath(), {
        method: "POST",
        headers: { accept: "application/json" },
        body: formData,
      });
      const responseBody = await jsonBody(response);
      if (!response.ok) {
        if (await followReauthorization(responseBody, formData)) return;
        message.value = responseError(response, responseBody);
        return;
      }

      await clearPendingBrowserAction(pendingKey).catch(() => {});
      const redirectUrl = sameOriginPath(responseBody?.redirectUrl) ??
        (response.redirected ? sameOriginPath(response.url) : null);
      if (redirectUrl) {
        globalThis.location.assign(redirectUrl);
      } else {
        globalThis.location.reload();
      }
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

    const onSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const formData = new FormData(form);
      formData.set("action", "save_profile");
      void save(formData);
    };
    form.addEventListener("submit", onSubmit);

    const url = new URL(globalThis.location.href);
    if (!hasHostProfileResumeMarker(url)) {
      return () => form.removeEventListener("submit", onSubmit);
    }

    // Consume the one-shot OAuth return marker before touching IndexedDB. A
    // refresh or later account switch cannot replay the action accidentally.
    globalThis.history.replaceState(
      null,
      "",
      withoutHostProfileResumeMarker(url),
    );
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
          {submitting.value ? "Saving host profile…" : "Save host profile"}
        </span>
      </button>
      {message.value && (
        <p
          class="profile-form-status profile-form-status--error"
          role="alert"
        >
          {message.value}
        </p>
      )}
    </>
  );
}

function currentRequestPath(): string {
  return `${globalThis.location.pathname}${globalThis.location.search}`;
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

function sameOriginPath(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value, globalThis.location.origin);
    if (url.origin !== globalThis.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
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
