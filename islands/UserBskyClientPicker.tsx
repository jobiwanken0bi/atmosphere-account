import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { BSKY_CLIENTS, getBskyClient } from "../lib/bsky-clients.ts";

interface Props {
  selectedClientId: string | null;
  label: string;
  saveLabel: string;
}

export default function UserBskyClientPicker(
  { selectedClientId, label, saveLabel }: Props,
) {
  const selected = useSignal(getBskyClient(selectedClientId).id);
  const open = useSignal(false);

  useEffect(() => {
    if (!open.value) return;

    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".user-bsky-picker")) {
        open.value = false;
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") open.value = false;
    };

    globalThis.addEventListener("click", close);
    globalThis.addEventListener("keydown", onKey);
    return () => {
      globalThis.removeEventListener("click", close);
      globalThis.removeEventListener("keydown", onKey);
    };
  }, [open.value]);

  const active = getBskyClient(selected.value);

  return (
    <form
      method="POST"
      action="/api/account/profile"
      class="user-profile-client-form"
    >
      <input type="hidden" name="bskyClientId" value={selected.value} />
      <label class="user-bsky-picker-label" id="user-bsky-picker-label">
        {label}
      </label>
      <div class="user-bsky-picker">
        <button
          type="button"
          class="user-bsky-picker-trigger"
          aria-haspopup="listbox"
          aria-expanded={open.value}
          aria-labelledby="user-bsky-picker-label"
          onClick={(event) => {
            event.stopPropagation();
            open.value = !open.value;
          }}
        >
          <img
            src={active.iconUrl}
            alt=""
            class="bsky-client-icon"
            loading="lazy"
            decoding="async"
          />
          <span class="bsky-client-meta">
            <span class="bsky-client-name">{active.name}</span>
            <span class="bsky-client-domain">{active.domain}</span>
          </span>
          <span class="user-bsky-picker-chevron" aria-hidden="true">▾</span>
        </button>

        {open.value && (
          <ul
            class="bsky-client-list user-bsky-picker-popover"
            role="listbox"
            aria-labelledby="user-bsky-picker-label"
          >
            {BSKY_CLIENTS.map((client) => {
              const isSelected = client.id === selected.value;
              return (
                <li key={client.id}>
                  <button
                    type="button"
                    class={`bsky-client-row ${isSelected ? "is-selected" : ""}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      selected.value = client.id;
                      open.value = false;
                    }}
                  >
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
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <button type="submit" class="profile-form-button-primary">
        {saveLabel}
      </button>
    </form>
  );
}
