import { useSignal } from "@preact/signals";
import { BSKY_CLIENTS, getBskyClient } from "../lib/bsky-clients.ts";

interface Props {
  selectedClientId: string | null;
  visible: boolean;
  label: string;
  displayLabel: string;
  settingsLabel: string;
  saveLabel: string;
  cancelLabel: string;
  doneLabel: string;
}

export default function UserBskyClientPicker(
  {
    selectedClientId,
    visible,
    label,
    displayLabel,
    settingsLabel,
    saveLabel,
    cancelLabel,
    doneLabel,
  }: Props,
) {
  const selected = useSignal(getBskyClient(selectedClientId).id);
  const draftSelected = useSignal(selected.value);
  const buttonVisible = useSignal(visible);
  const modalOpen = useSignal(false);

  const active = getBskyClient(selected.value);

  return (
    <form
      method="POST"
      action="/api/account/profile"
      class="user-profile-client-form"
    >
      <input type="hidden" name="bskyClientId" value={selected.value} />
      <input type="hidden" name="bskyButtonVisible" value="0" />
      <label class="user-bsky-picker-label" id="user-bsky-picker-label">
        {label}
      </label>
      <div
        class={`atmosphere-row user-bsky-settings-row ${
          buttonVisible.value ? "is-on" : ""
        }`}
      >
        <label class="atmosphere-row-toggle">
          <input
            type="checkbox"
            name="bskyButtonVisible"
            value="1"
            checked={buttonVisible.value}
            onChange={(event) =>
              buttonVisible.value =
                (event.currentTarget as HTMLInputElement).checked}
            aria-label={displayLabel}
          />
          <span class="atmosphere-toggle-track" aria-hidden="true">
            <span class="atmosphere-toggle-thumb" />
          </span>
        </label>
        <div class="atmosphere-row-body">
          <span class="atmosphere-row-icon">
            <img
              src={active.iconUrl}
              alt=""
              class="atmosphere-icon"
              loading="lazy"
              decoding="async"
            />
          </span>
          <span class="atmosphere-row-meta">
            <span class="atmosphere-row-name">{displayLabel}</span>
            <span class="atmosphere-row-desc">
              {active.name} · {active.domain}
            </span>
          </span>
        </div>
        <button
          type="button"
          class="atmosphere-row-gear"
          aria-label={settingsLabel}
          title={settingsLabel}
          onClick={() => {
            draftSelected.value = selected.value;
            modalOpen.value = true;
          }}
        >
          ⚙
        </button>
      </div>

      {modalOpen.value && (
        <div
          class="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-bsky-picker-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) modalOpen.value = false;
          }}
        >
          <div class="modal-card">
            <header class="modal-header">
              <h2 id="user-bsky-picker-title" class="modal-title">
                {settingsLabel}
              </h2>
            </header>
            <ul
              class="bsky-client-list"
              role="listbox"
              aria-labelledby="user-bsky-picker-title"
            >
              {BSKY_CLIENTS.map((client) => {
                const isSelected = client.id === draftSelected.value;
                return (
                  <li key={client.id}>
                    <label
                      class={`bsky-client-row ${
                        isSelected ? "is-selected" : ""
                      }`}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <input
                        type="radio"
                        name="draftBskyClient"
                        value={client.id}
                        checked={isSelected}
                        onChange={() => draftSelected.value = client.id}
                      />
                      <img
                        src={client.iconUrl}
                        alt=""
                        class="bsky-client-icon"
                        loading="lazy"
                        decoding="async"
                      />
                      <span class="bsky-client-meta">
                        <span class="bsky-client-name">{client.name}</span>
                        <span class="bsky-client-domain">{client.domain}</span>
                      </span>
                      <span class="bsky-client-radio" aria-hidden="true" />
                    </label>
                  </li>
                );
              })}
            </ul>
            <footer class="modal-footer">
              <button
                type="button"
                class="profile-form-button-secondary"
                onClick={() => modalOpen.value = false}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                class="profile-form-button-primary"
                onClick={() => {
                  selected.value = draftSelected.value;
                  buttonVisible.value = true;
                  modalOpen.value = false;
                }}
              >
                {doneLabel}
              </button>
            </footer>
          </div>
        </div>
      )}
      <button type="submit" class="profile-form-button-primary">
        {saveLabel}
      </button>
    </form>
  );
}
