import { useSignal } from "@preact/signals";
import { useEffect, useId } from "preact/hooks";
import { createPortal } from "preact/compat";
import { useDialog } from "../lib/use-dialog.ts";
import UserProfileEditForm, {
  userProfilePendingKey,
  userProfileResumeMarker,
} from "./UserProfileEditForm.tsx";
import { oauthCancellationLocation } from "../lib/oauth-cancellation.ts";
import { clearPendingBrowserAction } from "../lib/pending-browser-action.ts";
import { userProfileResumeLocation } from "../lib/user-profile-resume.ts";

interface Props {
  did: string;
  currentHandle: string;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  microblogVisible: boolean;
  websiteUrl: string | null;
  websiteVisible: boolean;
  triggerLabel: string;
  title: string;
  description: string;
  nameLabel: string;
  namePlaceholder: string;
  bioLabel: string;
  bioPlaceholder: string;
  saveLabel: string;
  savingLabel: string;
  savedLabel: string;
  errorLabel: string;
}

export default function UserProfileEditButton(props: Props) {
  const open = useSignal(false);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const titleId = `account-profile-edit-title-${id}`;
  const descriptionId = `account-profile-edit-description-${id}`;

  useEffect(() => {
    const cancellation = oauthCancellationLocation(
      globalThis.location.href,
      "user-profile",
    );
    if (cancellation.wasCancelled) {
      globalThis.history.replaceState(null, "", cancellation.cleanLocation);
      try {
        sessionStorage.removeItem(userProfileResumeMarker(props.did));
      } catch {
        // Storage restrictions must not break the account page.
      }
      void clearPendingBrowserAction(userProfilePendingKey(props.did)).catch(
        () => {},
      );
      return;
    }
    const resume = userProfileResumeLocation(
      globalThis.location.href,
      props.did,
    );
    if (resume.hadMarker) {
      globalThis.history.replaceState(null, "", resume.cleanLocation);
    }
    let armed = false;
    try {
      armed = sessionStorage.getItem(userProfileResumeMarker(props.did)) ===
        props.did;
    } catch {
      // Resume is optional in browsers that block session storage.
    }
    if (resume.shouldResume && armed) {
      open.value = true;
    } else if (resume.hadMarker || armed) {
      try {
        sessionStorage.removeItem(userProfileResumeMarker(props.did));
      } catch {
        // Keep clearing the durable draft below.
      }
      void clearPendingBrowserAction(userProfilePendingKey(props.did)).catch(
        () => {},
      );
    }
  }, []);

  const close = () => {
    open.value = false;
  };
  const dialogRef = useDialog<HTMLDivElement>(open.value, close);

  const modal = (
    <div
      class="modal-backdrop account-profile-edit-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        class="modal-card account-profile-edit-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header class="modal-header account-profile-edit-header">
          <div>
            <p class="text-eyebrow">Profile</p>
            <h2 id={titleId} class="modal-title">
              {props.title}
            </h2>
            <p id={descriptionId} class="modal-body-text">
              {props.description}
            </p>
          </div>
          <button
            type="button"
            class="account-profile-edit-close"
            aria-label="Close profile editor"
            onClick={close}
          >
            ×
          </button>
        </header>
        <div class="account-profile-edit-body">
          <UserProfileEditForm
            did={props.did}
            currentHandle={props.currentHandle}
            rememberedAccounts={props.rememberedAccounts}
            displayName={props.displayName}
            bio={props.bio}
            avatarUrl={props.avatarUrl}
            microblogVisible={props.microblogVisible}
            websiteUrl={props.websiteUrl}
            websiteVisible={props.websiteVisible}
            nameLabel={props.nameLabel}
            namePlaceholder={props.namePlaceholder}
            bioLabel={props.bioLabel}
            bioPlaceholder={props.bioPlaceholder}
            saveLabel={props.saveLabel}
            savingLabel={props.savingLabel}
            savedLabel={props.savedLabel}
            errorLabel={props.errorLabel}
            onSaved={() => {
              globalThis.setTimeout(
                () => globalThis.location.reload(),
                450,
              );
            }}
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        class="account-dashboard-button account-dashboard-button--primary"
        aria-haspopup="dialog"
        aria-expanded={open.value ? "true" : "false"}
        onClick={() => open.value = true}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20h8" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
        </svg>
        <span>{props.triggerLabel}</span>
      </button>

      {open.value && typeof document !== "undefined"
        ? createPortal(modal, document.body)
        : null}
    </>
  );
}
