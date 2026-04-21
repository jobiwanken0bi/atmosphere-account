import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";

interface Props {
  open: boolean;
  /** Display name of the service (e.g. "Tangled"). */
  serviceName: string;
  /**
   * The URL the service would use by default if no override is set.
   * Shown as the placeholder + helper text so users understand what
   * they're overriding.
   */
  defaultUrl: string;
  /** Current override value (empty string = "use the default"). */
  value: string;
  /** Called with the new override value when the user clicks Save. */
  onConfirm: (next: string) => void;
  onClose: () => void;
  labels: {
    title: (serviceName: string) => string;
    body: (serviceName: string, defaultUrl: string) => string;
    inputLabel: string;
    placeholder: string;
    save: string;
    cancel: string;
    reset: string;
  };
}

/**
 * Centered modal for editing a per-service URL override (Tangled,
 * Supper). Local state is committed on Save; cancelling leaves the
 * parent untouched. The Reset button clears the override so the
 * service falls back to its handle-derived default URL.
 */
export default function LinkUrlOverrideModal(
  { open, serviceName, defaultUrl, value, onConfirm, onClose, labels }: Props,
) {
  const draft = useSignal<string>(value);

  useEffect(() => {
    if (open) draft.value = value;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  return (
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-override-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="modal-card">
        <header class="modal-header">
          <h2 id="link-override-title" class="modal-title">
            {labels.title(serviceName)}
          </h2>
          <p class="modal-body-text">
            {labels.body(serviceName, defaultUrl)}
          </p>
        </header>
        <label class="profile-form-field">
          <span class="profile-form-label profile-form-label--small">
            {labels.inputLabel}
          </span>
          <input
            type="url"
            class="profile-form-input"
            placeholder={labels.placeholder || defaultUrl}
            value={draft.value}
            onInput={(e) =>
              (draft.value = (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <footer class="modal-footer">
          <button
            type="button"
            class="profile-form-button-link"
            onClick={() => {
              draft.value = "";
              onConfirm("");
            }}
          >
            {labels.reset}
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            class="profile-form-button-secondary"
            onClick={onClose}
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            class="profile-form-button-primary"
            onClick={() => onConfirm(draft.value.trim())}
          >
            {labels.save}
          </button>
        </footer>
      </div>
    </div>
  );
}
