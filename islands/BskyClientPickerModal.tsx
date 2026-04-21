import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { BSKY_CLIENTS } from "../lib/bsky-clients.ts";
import { useT } from "../i18n/mod.ts";

interface Props {
  /** Currently-selected client ids (controlled by the parent form). */
  selected: string[];
  open: boolean;
  /** Called with the new selection when the user clicks Done. */
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}

/**
 * Centered modal popup for picking which Bluesky-compatible client(s)
 * appear on the public profile. Multi-select; the first id in the
 * returned list is treated as the "primary" by the parent (drives the
 * toggle row icon). Local state is committed on Done so cancelling
 * leaves the parent unchanged.
 */
export default function BskyClientPickerModal(
  { selected, open, onConfirm, onClose }: Props,
) {
  const t = useT().forms.profile.bskyPicker;
  const draft = useSignal<string[]>(selected);

  // Re-seed the draft whenever the modal is (re)opened so the user
  // always starts from the parent's source of truth.
  useEffect(() => {
    if (open) draft.value = selected;
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  const toggle = (id: string) => {
    const cur = draft.value;
    draft.value = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  };

  const empty = draft.value.length === 0;

  return (
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bsky-picker-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="modal-card">
        <header class="modal-header">
          <h2 id="bsky-picker-title" class="modal-title">{t.title}</h2>
          <p class="modal-body-text">{t.body}</p>
        </header>
        <ul class="bsky-client-list" role="listbox" aria-multiselectable="true">
          {BSKY_CLIENTS.map((c) => {
            const isSel = draft.value.includes(c.id);
            return (
              <li key={c.id}>
                <label
                  class={`bsky-client-row ${isSel ? "is-selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    name="bskyClient"
                    value={c.id}
                    checked={isSel}
                    onChange={() => toggle(c.id)}
                  />
                  <img
                    src={c.iconUrl}
                    alt=""
                    class="bsky-client-icon"
                    loading="lazy"
                    decoding="async"
                  />
                  <span class="bsky-client-meta">
                    <span class="bsky-client-name">{c.name}</span>
                    <span class="bsky-client-domain">{c.domain}</span>
                  </span>
                  <span class="bsky-client-check" aria-hidden="true" />
                </label>
              </li>
            );
          })}
        </ul>
        {empty && <p class="modal-footnote">{t.empty}</p>}
        <footer class="modal-footer">
          <button
            type="button"
            class="profile-form-button-secondary"
            onClick={onClose}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            class="profile-form-button-primary"
            onClick={() => onConfirm(draft.value)}
          >
            {t.done}
          </button>
        </footer>
      </div>
    </div>
  );
}
