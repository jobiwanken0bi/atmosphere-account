import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import {
  type ContextualReauthorization,
  contextualReauthorization,
  contextualReauthorizationFromApiPayload,
} from "../lib/reauth-required.ts";
import {
  clearPendingBrowserAction,
  formDataEntries,
  formDataFromEntries,
  loadPendingBrowserAction,
  type PendingFormEntry,
  savePendingBrowserAction,
} from "../lib/pending-browser-action.ts";
import { oauthCancellationLocation } from "../lib/oauth-cancellation.ts";
import { userProfileWriteCapabilities } from "../lib/profile-write-capabilities.ts";
import ContextualReauthorizationDialog from "./ContextualReauthorizationDialog.tsx";
import { userProfileResumePath } from "../lib/user-profile-resume.ts";

interface PendingUserProfileAction {
  did: string;
  entries: PendingFormEntry[];
}

export interface PendingUserProfileDraft {
  displayName: string;
  bio: string;
  microblogVisible: boolean;
  websiteUrl: string;
  websiteVisible: boolean;
  avatarFile: File | null;
}

export function userProfileResumeMarker(did: string): string {
  return `atmosphere:resume-user-profile:${did}`;
}

export function userProfilePendingKey(did: string): string {
  return `user-profile:save:${did}`;
}

export function pendingUserProfileEntriesForDid(
  value: unknown,
  did: string,
): PendingFormEntry[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pending = value as Partial<PendingUserProfileAction>;
  if (pending.did !== did || !Array.isArray(pending.entries)) return null;
  return pending.entries.every((entry) =>
      Array.isArray(entry) && entry.length === 2 &&
      typeof entry[0] === "string" &&
      (typeof entry[1] === "string" || entry[1] instanceof File)
    )
    ? pending.entries as PendingFormEntry[]
    : null;
}

export function pendingUserProfileDraft(
  entries: readonly PendingFormEntry[],
): PendingUserProfileDraft {
  const strings = (name: string) =>
    entries.flatMap(([entryName, value]) =>
      entryName === name && typeof value === "string" ? [value] : []
    );
  const lastString = (name: string) => strings(name).at(-1) ?? "";
  const checked = (name: string) => strings(name).includes("1");
  const avatarFile = entries.find(([name, value]) =>
    name === "avatarUpload" && value instanceof File && value.size > 0
  )?.[1];
  return {
    displayName: lastString("displayName"),
    bio: lastString("bio"),
    microblogVisible: checked("bskyButtonVisible"),
    websiteUrl: lastString("websiteUrl"),
    websiteVisible: checked("websiteVisible"),
    avatarFile: avatarFile instanceof File ? avatarFile : null,
  };
}

export async function cancelUserProfileReauthorization(
  resumeMarker: string,
  pendingKey: string,
  options: {
    storage?: Pick<Storage, "removeItem">;
    clearPending?: (key: string) => Promise<void>;
  } = {},
): Promise<void> {
  try {
    (options.storage ?? globalThis.sessionStorage).removeItem(resumeMarker);
  } catch {
    // Keep clearing the IndexedDB draft even when storage is unavailable.
  }
  await (options.clearPending ?? clearPendingBrowserAction)(pendingKey).catch(
    () => {},
  );
}

interface Props {
  did: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  microblogVisible: boolean;
  websiteUrl: string | null;
  websiteVisible: boolean;
  nameLabel: string;
  namePlaceholder: string;
  bioLabel: string;
  bioPlaceholder: string;
  saveLabel: string;
  savingLabel: string;
  savedLabel: string;
  errorLabel: string;
  currentHandle: string;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  onSaved?: () => void;
}

export default function UserProfileEditForm(
  {
    did,
    displayName: initialDisplayName,
    bio: initialBio,
    avatarUrl,
    microblogVisible: initialMicroblogVisible,
    websiteUrl: initialWebsiteUrl,
    websiteVisible: initialWebsiteVisible,
    nameLabel,
    namePlaceholder,
    bioLabel,
    bioPlaceholder,
    saveLabel,
    savingLabel,
    savedLabel,
    errorLabel,
    currentHandle,
    rememberedAccounts = [],
    onSaved,
  }: Props,
) {
  const displayName = useSignal(initialDisplayName);
  const bio = useSignal(initialBio);
  const avatarPreview = useSignal<string | null>(avatarUrl);
  const microblogVisible = useSignal(initialMicroblogVisible);
  const websiteUrl = useSignal(initialWebsiteUrl ?? "");
  const websiteVisible = useSignal(initialWebsiteVisible);
  const pendingAvatarFile = useSignal<File | null>(null);
  const submitting = useSignal(false);
  const message = useSignal<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );
  const reauthorization = useSignal<ContextualReauthorization | null>(null);
  const pendingKey = userProfilePendingKey(did);
  const resumeMarker = userProfileResumeMarker(did);

  const saveFormData = async (formData: FormData): Promise<Response> => {
    return await fetch("/api/account/profile", {
      method: "POST",
      body: formData,
    });
  };

  const followReauth = async (
    response: Response,
    formData: FormData,
  ): Promise<boolean> => {
    const payload = response.headers.get("content-type")?.includes(
        "application/json",
      )
      ? await response.clone().json().catch(() => null)
      : null;
    const avatar = formData.get("avatarUpload");
    const supplied = contextualReauthorizationFromApiPayload(payload);
    const contextual = supplied
      ? contextualReauthorization({
        returnTo: userProfileResumePath(did),
        action: supplied.action,
        capabilities: supplied.capabilities,
        targetName: supplied.targetName,
        intent: supplied.intent,
      })
      : (response.status === 401
        ? contextualReauthorization({
          returnTo: userProfileResumePath(did),
          action: "profile",
          capabilities: userProfileWriteCapabilities(
            avatar instanceof File && avatar.size > 0,
          ),
          targetName: currentHandle,
        })
        : null);
    if (!contextual) return false;
    try {
      await savePendingBrowserAction(
        pendingKey,
        {
          did,
          entries: formDataEntries(formData),
        } satisfies PendingUserProfileAction,
        { ownerDid: did },
      );
    } catch {
      await clearPendingBrowserAction(pendingKey).catch(() => {});
      throw new Error(errorLabel);
    }
    reauthorization.value = contextual;
    submitting.value = false;
    return true;
  };

  useEffect(() => {
    const cancellation = oauthCancellationLocation(
      globalThis.location.href,
      "user-profile",
    );
    if (cancellation.wasCancelled) {
      globalThis.history.replaceState(null, "", cancellation.cleanLocation);
      try {
        sessionStorage.removeItem(resumeMarker);
      } catch {
        // Storage restrictions must not break the editor.
      }
      void clearPendingBrowserAction(pendingKey).catch(() => {});
      return;
    }
    try {
      if (sessionStorage.getItem(resumeMarker) !== did) return;
      sessionStorage.removeItem(resumeMarker);
    } catch {
      return;
    }
    let cancelled = false;
    (async () => {
      const pending = await loadPendingBrowserAction<PendingUserProfileAction>(
        pendingKey,
      ).catch(() => null);
      const entries = pendingUserProfileEntriesForDid(pending, did);
      if (!entries) {
        await clearPendingBrowserAction(pendingKey).catch(() => {});
        return;
      }
      if (cancelled) return;
      const draft = pendingUserProfileDraft(entries);
      displayName.value = draft.displayName;
      bio.value = draft.bio;
      microblogVisible.value = draft.microblogVisible;
      websiteUrl.value = draft.websiteUrl;
      websiteVisible.value = draft.websiteVisible;
      pendingAvatarFile.value = draft.avatarFile;
      if (draft.avatarFile) {
        avatarPreview.value = URL.createObjectURL(draft.avatarFile);
      }
      submitting.value = true;
      const formData = formDataFromEntries(entries);
      try {
        const response = await saveFormData(formData);
        if (cancelled) return;
        if (!response.ok) {
          if (await followReauth(response, formData)) return;
          message.value = { kind: "error", text: errorLabel };
          submitting.value = false;
          return;
        }
        if (!userProfileResponseWasSaved(response)) {
          message.value = { kind: "error", text: errorLabel };
          submitting.value = false;
          return;
        }
        await clearPendingBrowserAction(pendingKey).catch(() => {});
        message.value = { kind: "ok", text: savedLabel };
        submitting.value = false;
        onSaved?.();
      } catch {
        if (cancelled) return;
        message.value = { kind: "error", text: errorLabel };
        submitting.value = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    if (submitting.value) return;
    submitting.value = true;
    message.value = null;
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const submittedAvatar = formData.get("avatarUpload");
    if (
      (!(submittedAvatar instanceof File) || submittedAvatar.size === 0) &&
      pendingAvatarFile.value
    ) {
      formData.set("avatarUpload", pendingAvatarFile.value);
    }
    try {
      const response = await saveFormData(formData);
      if (!response.ok) {
        if (await followReauth(response, formData)) return;
        throw new Error(errorLabel);
      }
      if (!userProfileResponseWasSaved(response)) {
        throw new Error(errorLabel);
      }
      await clearPendingBrowserAction(pendingKey).catch(() => {});
      try {
        sessionStorage.removeItem(resumeMarker);
      } catch {
        // The profile was saved; storage cleanup cannot reverse it.
      }
      pendingAvatarFile.value = null;
      message.value = { kind: "ok", text: savedLabel };
      onSaved?.();
    } catch {
      message.value = {
        kind: "error",
        text: errorLabel,
      };
    } finally {
      submitting.value = false;
    }
  };

  return (
    <>
      <form
        method="POST"
        action="/api/account/profile"
        class="user-profile-client-form"
        onSubmit={onSubmit}
      >
        <div class="account-profile-edit-avatar-row">
          <div class="account-profile-edit-avatar-preview" aria-hidden="true">
            {avatarPreview.value
              ? (
                <img
                  src={avatarPreview.value}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              )
              : <span>{displayName.value.trim().charAt(0).toUpperCase()}</span>}
          </div>
          <div class="account-profile-edit-avatar-copy">
            <span class="user-bsky-picker-label">Avatar</span>
            <label class="account-profile-edit-avatar-button">
              <input
                type="file"
                name="avatarUpload"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = (event.currentTarget as HTMLInputElement)
                    .files?.[0] ?? null;
                  if (file) {
                    pendingAvatarFile.value = file;
                    avatarPreview.value = URL.createObjectURL(file);
                  }
                }}
              />
              <span>
                {avatarPreview.value ? "Replace avatar" : "Upload avatar"}
              </span>
            </label>
            <p class="profile-form-hint">
              PNG, JPEG, or WebP. Saved with your account.
            </p>
          </div>
        </div>

        <label class="profile-form-field">
          <span class="user-bsky-picker-label">{nameLabel}</span>
          <input
            type="text"
            name="displayName"
            value={displayName.value}
            maxLength={60}
            required
            placeholder={namePlaceholder}
            class="profile-form-input account-profile-edit-input"
            data-dialog-initial-focus="true"
            onInput={(event) =>
              displayName.value =
                (event.currentTarget as HTMLInputElement).value}
          />
        </label>
        <label class="profile-form-field">
          <span class="user-bsky-picker-label">{bioLabel}</span>
          <textarea
            name="bio"
            value={bio.value}
            maxLength={500}
            placeholder={bioPlaceholder}
            class="profile-form-input account-profile-edit-input user-profile-bio-input"
            onInput={(event) =>
              bio.value = (event.currentTarget as HTMLTextAreaElement).value}
          />
        </label>
        <section class="account-profile-edit-link-settings">
          <div>
            <span class="user-bsky-picker-label">Public links</span>
            <p class="profile-form-hint">
              Choose which links appear on your public Atmosphere profile.
            </p>
          </div>
          <label class="account-profile-edit-toggle-row">
            <span class="account-profile-edit-toggle-copy">
              <strong>Show microblog profile</strong>
              <small>
                Choose its viewer from the button beside Account home.
              </small>
            </span>
            <span class="account-profile-edit-switch">
              <input type="hidden" name="bskyButtonVisible" value="0" />
              <input
                type="checkbox"
                name="bskyButtonVisible"
                value="1"
                checked={microblogVisible.value}
                onChange={(event) =>
                  microblogVisible.value =
                    (event.currentTarget as HTMLInputElement).checked}
              />
              <span aria-hidden="true" />
            </span>
          </label>
          <label class="account-profile-edit-toggle-row">
            <span class="account-profile-edit-toggle-copy">
              <strong>Show website link</strong>
              <small>Add a personal site, portfolio, or homepage.</small>
            </span>
            <span class="account-profile-edit-switch">
              <input type="hidden" name="websiteVisible" value="0" />
              <input
                type="checkbox"
                name="websiteVisible"
                value="1"
                checked={websiteVisible.value}
                onChange={(event) =>
                  websiteVisible.value =
                    (event.currentTarget as HTMLInputElement).checked}
              />
              <span aria-hidden="true" />
            </span>
          </label>
          <label class="profile-form-field account-profile-edit-website-field">
            <span class="user-bsky-picker-label">Website</span>
            <input
              type="text"
              name="websiteUrl"
              value={websiteUrl.value}
              maxLength={512}
              inputMode="url"
              placeholder="you.com"
              class="profile-form-input account-profile-edit-input"
              onInput={(event) =>
                websiteUrl.value =
                  (event.currentTarget as HTMLInputElement).value}
            />
            <span class="profile-form-hint">
              You can paste a full URL or just a domain.
            </span>
          </label>
        </section>
        <div class="user-profile-save-row">
          <button
            type="submit"
            class="profile-form-button-primary"
            disabled={submitting.value}
          >
            {submitting.value ? savingLabel : saveLabel}
          </button>
          {message.value && (
            <span
              class={`profile-form-status profile-form-status--${message.value.kind}`}
              role={message.value.kind === "error" ? "alert" : "status"}
            >
              {message.value.text}
            </span>
          )}
        </div>
      </form>
      {reauthorization.value && (
        <ContextualReauthorizationDialog
          authorization={reauthorization.value}
          currentDid={did}
          currentHandle={currentHandle}
          rememberedAccounts={rememberedAccounts}
          restrictToCurrentAccount
          onAuthorizationStart={() => {
            try {
              sessionStorage.setItem(resumeMarker, did);
            } catch {
              // Without same-tab storage the return marker cannot replay the
              // saved draft; the account page remains usable.
            }
          }}
          onClose={() => {
            void cancelUserProfileReauthorization(resumeMarker, pendingKey);
            reauthorization.value = null;
          }}
        />
      )}
    </>
  );
}

export function userProfileResponseWasSaved(
  response: Pick<Response, "ok" | "redirected" | "url">,
): boolean {
  if (!response.ok || !response.redirected || !response.url) return false;
  try {
    return new URL(response.url, "https://atmosphere.invalid").pathname ===
      "/account";
  } catch {
    return false;
  }
}
