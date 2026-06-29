import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
  getProfileMicroblogViewer,
  PROFILE_MICROBLOG_VIEWERS,
} from "../lib/bsky-clients.ts";

interface Props {
  selectedClientId: string | null;
  visible: boolean;
}

export default function UserMicroblogViewerButton(
  { selectedClientId, visible: initialVisible }: Props,
) {
  const selected = useSignal(getProfileMicroblogViewer(selectedClientId).id);
  const visible = useSignal(initialVisible);
  const open = useSignal(false);
  const saving = useSignal(false);
  const message = useSignal<string | null>(null);
  const active = getProfileMicroblogViewer(selected.value);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current) return;
      const node = event.target;
      if (node instanceof Node && !wrapRef.current.contains(node)) {
        open.value = false;
      }
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && open.value) {
        open.value = false;
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const savePreference = async (
    nextClientId: string,
    nextVisible = visible.value,
  ) => {
    saving.value = true;
    message.value = null;
    try {
      const response = await fetch("/api/account/microblog-viewer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bskyClientId: nextClientId,
          visible: nextVisible,
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || "Could not save viewer");
      }
      selected.value = nextClientId;
      visible.value = nextVisible;
      message.value = "Saved";
      open.value = false;
    } catch (err) {
      message.value = err instanceof Error ? err.message : "Network error";
    } finally {
      saving.value = false;
    }
  };

  return (
    <div class="account-microblog-viewer" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        class="account-microblog-viewer-button"
        title={`Atmosphere microblog viewer: ${active.name}`}
        aria-label={`Atmosphere microblog viewer: ${active.name}`}
        aria-expanded={open.value}
        onClick={() => {
          open.value = !open.value;
          message.value = null;
        }}
      >
        <span class="account-microblog-viewer-atmosphere" aria-hidden="true">
          <img
            src="/union.svg"
            alt=""
            loading="lazy"
            decoding="async"
            width={18}
            height={18}
          />
        </span>
        <span class="account-microblog-viewer-separator" aria-hidden="true">
          :
        </span>
        <span class="account-microblog-viewer-client" aria-hidden="true">
          <img
            src={active.iconUrl}
            alt=""
            loading="lazy"
            decoding="async"
            width={20}
            height={20}
          />
        </span>
      </button>

      {open.value && (
        <div class="account-microblog-viewer-popover" role="dialog">
          <header class="account-microblog-viewer-popover-head">
            <div>
              <h3>Atmosphere microblog viewer</h3>
              <p>
                Choose where Atmosphere microblog profiles open for you.
              </p>
            </div>
            <button
              type="button"
              class="account-profile-edit-close account-microblog-viewer-close"
              aria-label="Close microblog viewer settings"
              onClick={() =>
                open.value = false}
            >
              ×
            </button>
          </header>

          <div class="account-microblog-viewer-options">
            {PROFILE_MICROBLOG_VIEWERS.map((client) => {
              const isSelected = selected.value === client.id;
              return (
                <button
                  key={client.id}
                  type="button"
                  class={`account-microblog-viewer-option ${
                    isSelected ? "is-selected" : ""
                  }`}
                  disabled={saving.value}
                  onClick={() => savePreference(client.id)}
                >
                  <span class="account-microblog-viewer-option-icon">
                    <img
                      src={client.iconUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={26}
                      height={26}
                    />
                  </span>
                  <span class="account-microblog-viewer-option-copy">
                    <strong>{client.name}</strong>
                    <small>{client.description ?? client.domain}</small>
                  </span>
                  <span
                    class="account-microblog-viewer-option-dot"
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>

          {message.value && (
            <p class="account-microblog-viewer-status" role="status">
              {message.value}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
