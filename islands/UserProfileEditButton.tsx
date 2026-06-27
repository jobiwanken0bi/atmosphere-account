import { useSignal } from "@preact/signals";
import { createPortal } from "preact/compat";
import UserProfileEditForm from "./UserProfileEditForm.tsx";

interface Props {
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

  const close = () => {
    open.value = false;
  };

  const modal = (
    <div
      class="modal-backdrop account-profile-edit-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-profile-edit-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div class="modal-card account-profile-edit-modal">
        <header class="modal-header account-profile-edit-header">
          <div>
            <p class="text-eyebrow">Profile</p>
            <h2 id="account-profile-edit-title" class="modal-title">
              {props.title}
            </h2>
            <p class="modal-body-text">{props.description}</p>
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
