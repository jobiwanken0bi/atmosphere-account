import { useSignal } from "@preact/signals";
import { useEffect, useId, useRef } from "preact/hooks";
import {
  getProfileMicroblogViewer,
  isProfileMicroblogViewerId,
  PROFILE_MICROBLOG_VIEWERS,
} from "../lib/bsky-clients.ts";
import {
  MICROBLOG_VIEWER_CHANGED_EVENT,
  type MicroblogViewerChangedDetail,
} from "../lib/microblog-viewer-events.ts";
import {
  type ContextualReauthorization,
  contextualReauthorization,
  contextualReauthorizationFromApiPayload,
} from "../lib/reauth-required.ts";
import ContextualReauthorizationDialog from "./ContextualReauthorizationDialog.tsx";
import { oauthCancellationLocation } from "../lib/oauth-cancellation.ts";

interface Props {
  selectedClientId: string | null;
  visible: boolean;
  currentDid: string;
  currentHandle: string;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
}

export function microblogViewerReauthorization(
  status: number,
  payload: unknown,
  currentHandle: string,
): ContextualReauthorization | null {
  return contextualReauthorizationFromApiPayload(payload) ??
    (status === 401 ||
        (payload && typeof payload === "object" && !Array.isArray(payload) &&
          ["not_authenticated", "oauth_session_expired"].includes(
            String((payload as Record<string, unknown>).error ?? ""),
          ))
      ? contextualReauthorization({
        returnTo: "/account?resume_viewer=1",
        action: "account",
        capabilities: ["identity"],
        targetName: currentHandle,
      })
      : null);
}

const VIEWER_PENDING_TTL_MS = 30 * 60 * 1_000;

export function microblogViewerPendingKey(ownerDid: string): string {
  return `atmosphere:microblog-viewer:${encodeURIComponent(ownerDid)}`;
}

export function microblogViewerPendingValue(
  ownerDid: string,
  clientId: string,
  visible: boolean,
  savedAt = Date.now(),
): string {
  return JSON.stringify({ ownerDid, clientId, visible, savedAt });
}

export function parseMicroblogViewerPending(
  value: string | null,
  ownerDid: string,
  now = Date.now(),
): { clientId: string; visible: boolean } | null {
  if (!value) return null;
  try {
    const pending = JSON.parse(value) as Record<string, unknown>;
    const clientId = typeof pending.clientId === "string"
      ? pending.clientId
      : null;
    if (
      pending.ownerDid !== ownerDid ||
      !isProfileMicroblogViewerId(clientId) ||
      typeof pending.visible !== "boolean" ||
      typeof pending.savedAt !== "number" ||
      !Number.isFinite(pending.savedAt) ||
      pending.savedAt > now || now - pending.savedAt > VIEWER_PENDING_TTL_MS
    ) return null;
    return { clientId, visible: pending.visible };
  } catch {
    return null;
  }
}

export default function UserMicroblogViewerButton(
  {
    selectedClientId,
    visible: initialVisible,
    currentDid,
    currentHandle,
    rememberedAccounts = [],
  }: Props,
) {
  const selected = useSignal(getProfileMicroblogViewer(selectedClientId).id);
  const visible = useSignal(initialVisible);
  const open = useSignal(false);
  const saving = useSignal(false);
  const message = useSignal<string | null>(null);
  const reauthorization = useSignal<ContextualReauthorization | null>(null);
  const pendingPreference = useSignal<
    { clientId: string; visible: boolean } | null
  >(null);
  const pendingKey = microblogViewerPendingKey(currentDid);
  const active = getProfileMicroblogViewer(selected.value);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const popoverId = `microblog-viewer-dialog-${id}`;
  const popoverTitleId = `microblog-viewer-title-${id}`;

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
    if (saving.value) return;
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
        const payload = response.headers.get("content-type")?.includes(
            "application/json",
          )
          ? await response.clone().json().catch(() => null)
          : null;
        const contextual = microblogViewerReauthorization(
          response.status,
          payload,
          currentHandle,
        );
        if (contextual) {
          pendingPreference.value = {
            clientId: nextClientId,
            visible: nextVisible,
          };
          reauthorization.value = contextual;
          return;
        }
        throw new Error("Could not save viewer");
      }
      const successPayload = await response.json().catch(() => null) as
        | { ok?: unknown }
        | null;
      if (successPayload?.ok !== true) {
        throw new Error("Could not save viewer");
      }
      selected.value = nextClientId;
      visible.value = nextVisible;
      globalThis.dispatchEvent(
        new CustomEvent<MicroblogViewerChangedDetail>(
          MICROBLOG_VIEWER_CHANGED_EVENT,
          { detail: { clientId: nextClientId } },
        ),
      );
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {
        // The preference was saved remotely; unavailable browser storage does
        // not turn that successful mutation into a visible failure.
      }
      message.value = "Saved";
      open.value = false;
    } catch {
      message.value = "Could not save viewer. Try again.";
    } finally {
      saving.value = false;
    }
  };

  useEffect(() => {
    const cancellation = oauthCancellationLocation(
      globalThis.location.href,
      "microblog-viewer",
    );
    if (cancellation.wasCancelled) {
      globalThis.history.replaceState(null, "", cancellation.cleanLocation);
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {
        // Storage can be disabled without breaking the account page.
      }
      return;
    }
    const url = new URL(globalThis.location.href);
    if (url.searchParams.get("resume_viewer") !== "1") return;
    url.searchParams.delete("resume_viewer");
    globalThis.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    let pending: { clientId: string; visible: boolean } | null = null;
    try {
      pending = parseMicroblogViewerPending(
        sessionStorage.getItem(pendingKey),
        currentDid,
      );
      sessionStorage.removeItem(pendingKey);
    } catch {
      // A privacy-restricted browser simply cannot resume this optional
      // preference; it must still be able to render and use the page.
    }
    if (pending) void savePreference(pending.clientId, pending.visible);
  }, []);

  return (
    <div class="account-microblog-viewer" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        class="account-microblog-viewer-button"
        title={`Atmosphere microblog viewer: ${active.name}`}
        aria-label={`Atmosphere microblog viewer: ${active.name}`}
        aria-haspopup="dialog"
        aria-controls={popoverId}
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
        <div
          id={popoverId}
          class="account-microblog-viewer-popover"
          role="dialog"
          aria-labelledby={popoverTitleId}
        >
          <header class="account-microblog-viewer-popover-head">
            <div>
              <h3 id={popoverTitleId}>Atmosphere microblog viewer</h3>
              <p>
                Choose where Atmosphere microblog profiles open for you.
              </p>
            </div>
            <button
              type="button"
              class="account-profile-edit-close account-microblog-viewer-close"
              aria-label="Close microblog viewer settings"
              onClick={() => open.value = false}
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
                  aria-pressed={isSelected}
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
      {reauthorization.value && (
        <ContextualReauthorizationDialog
          authorization={reauthorization.value}
          currentDid={currentDid}
          currentHandle={currentHandle}
          rememberedAccounts={rememberedAccounts}
          restrictToCurrentAccount
          onAuthorizationStart={() => {
            const pending = pendingPreference.value;
            if (!pending) return;
            try {
              sessionStorage.setItem(
                pendingKey,
                microblogViewerPendingValue(
                  currentDid,
                  pending.clientId,
                  pending.visible,
                ),
              );
            } catch {
              // Reauthorization may continue, but the mutation cannot replay
              // without an owner-bound same-tab marker.
            }
          }}
          onClose={() => {
            try {
              sessionStorage.removeItem(pendingKey);
            } catch {
              // Storage can be disabled without breaking dismissal.
            }
            pendingPreference.value = null;
            reauthorization.value = null;
          }}
        />
      )}
    </div>
  );
}
