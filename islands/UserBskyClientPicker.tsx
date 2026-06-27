import { useSignal } from "@preact/signals";
import { BSKY_CLIENTS, getBskyClient } from "../lib/bsky-clients.ts";

interface Props {
  displayName: string;
  bio: string;
  selectedClientId: string | null;
  visible: boolean;
  nameLabel: string;
  namePlaceholder: string;
  bioLabel: string;
  bioPlaceholder: string;
  label: string;
  displayLabel: string;
  settingsLabel: string;
  saveLabel: string;
  savingLabel: string;
  savedLabel: string;
  errorLabel: string;
  cancelLabel: string;
  doneLabel: string;
  onSaved?: () => void;
}

export default function UserBskyClientPicker(
  {
    displayName: initialDisplayName,
    bio: initialBio,
    selectedClientId,
    visible,
    nameLabel,
    namePlaceholder,
    bioLabel,
    bioPlaceholder,
    label,
    displayLabel,
    settingsLabel,
    saveLabel,
    savingLabel,
    savedLabel,
    errorLabel,
    onSaved,
  }: Props,
) {
  const displayName = useSignal(initialDisplayName);
  const bio = useSignal(initialBio);
  const selected = useSignal(getBskyClient(selectedClientId).id);
  const buttonVisible = useSignal(visible);
  const viewerOpen = useSignal(false);
  const submitting = useSignal(false);
  const message = useSignal<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const active = getBskyClient(selected.value);
  const onSubmit = async (event: Event) => {
    event.preventDefault();
    submitting.value = true;
    message.value = null;
    const form = event.currentTarget as HTMLFormElement;
    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || errorLabel);
      }
      message.value = { kind: "ok", text: savedLabel };
      onSaved?.();
    } catch (err) {
      message.value = {
        kind: "error",
        text: err instanceof Error ? err.message : errorLabel,
      };
    } finally {
      submitting.value = false;
    }
  };

  return (
    <form
      method="POST"
      action="/api/account/profile"
      class={`user-profile-client-form ${
        viewerOpen.value ? "is-viewer-open" : ""
      }`}
      onSubmit={onSubmit}
    >
      <label class="profile-form-field">
        <span class="user-bsky-picker-label">{nameLabel}</span>
        <input
          type="text"
          name="displayName"
          value={displayName.value}
          maxLength={60}
          required
          placeholder={namePlaceholder}
          class="profile-form-input"
          onInput={(event) =>
            displayName.value = (event.currentTarget as HTMLInputElement).value}
        />
      </label>
      <label class="profile-form-field">
        <span class="user-bsky-picker-label">{bioLabel}</span>
        <textarea
          name="bio"
          value={bio.value}
          maxLength={500}
          placeholder={bioPlaceholder}
          class="profile-form-input user-profile-bio-input"
          onInput={(event) =>
            bio.value = (event.currentTarget as HTMLTextAreaElement).value}
        />
      </label>
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
              Opens with {active.name} · {active.domain}
            </span>
          </span>
        </div>
        <button
          type="button"
          class="atmosphere-row-gear user-bsky-viewer-trigger"
          aria-label={settingsLabel}
          title={settingsLabel}
          aria-expanded={viewerOpen.value}
          aria-controls="user-bsky-viewer-panel"
          onClick={() => viewerOpen.value = !viewerOpen.value}
        >
          Viewer
        </button>
        {viewerOpen.value && (
          <div
            id="user-bsky-viewer-panel"
            class="user-bsky-viewer-panel"
            role="radiogroup"
            aria-labelledby="user-bsky-viewer-title"
          >
            <h3 id="user-bsky-viewer-title">{settingsLabel}</h3>
            <ul class="bsky-client-list">
              {BSKY_CLIENTS.map((client) => {
                const isSelected = client.id === selected.value;
                return (
                  <li key={client.id}>
                    <label
                      class={`bsky-client-row ${
                        isSelected ? "is-selected" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="draftBskyClient"
                        value={client.id}
                        checked={isSelected}
                        onChange={() => {
                          selected.value = client.id;
                          buttonVisible.value = true;
                          viewerOpen.value = false;
                        }}
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
          </div>
        )}
      </div>
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
            role="status"
          >
            {message.value.text}
          </span>
        )}
      </div>
    </form>
  );
}
