import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";

export interface ShareButtonCopy {
  /** Default action label (e.g. "Share"). */
  button: string;
  /** Fallback action label when only copy-to-clipboard is available. */
  copyLink: string;
  /** Toast shown after a successful copy. */
  copied: string;
  /** Toast shown when clipboard write fails. */
  copyFailed: string;
}

interface Props {
  /**
   * URL to share. Made absolute by the caller — passing the full
   * `https://...` form means the Web Share API and the clipboard
   * fallback both produce the same string.
   */
  url: string;
  /** Card title (used by the native share sheet). */
  title: string;
  /** Card body (used by the native share sheet). */
  text?: string;
  copy: ShareButtonCopy;
}

/**
 * Share entry point for project pages. On platforms that expose
 * `navigator.share` (mobile Safari, Android Chrome, etc.) we open the
 * native sheet; everywhere else we fall back to copying the URL to
 * the clipboard with a small confirmation toast.
 *
 * Renders a lightweight skeleton on the server so layout doesn't
 * shift; capability detection (`canShare`) only runs after hydration.
 */
export default function ShareButton({ url, title, text, copy }: Props) {
  const canShare = useSignal(false);
  const toast = useSignal<{ kind: "ok" | "error"; text: string } | null>(null);
  const busy = useSignal(false);

  useEffect(() => {
    canShare.value = typeof navigator !== "undefined" &&
      typeof (navigator as Navigator & { share?: unknown }).share ===
        "function";
  }, []);

  useEffect(() => {
    if (!toast.value) return;
    const id = setTimeout(() => {
      toast.value = null;
    }, 2400);
    return () => clearTimeout(id);
  }, [toast.value]);

  const onClick = async () => {
    if (busy.value) return;
    busy.value = true;
    try {
      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
      };
      if (canShare.value && typeof nav.share === "function") {
        try {
          await nav.share({ title, text, url });
        } catch (_) {
          /** AbortError on dismiss is normal; nothing to do. */
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        toast.value = { kind: "ok", text: copy.copied };
      } catch (_) {
        toast.value = { kind: "error", text: copy.copyFailed };
      }
    } finally {
      busy.value = false;
    }
  };

  return (
    <span class="share-button-wrap">
      <button
        type="button"
        class="share-button"
        onClick={onClick}
        aria-live="polite"
      >
        <span class="share-button-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <path
              d="M12 3v12m0-12-4 4m4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <span>{canShare.value ? copy.button : copy.copyLink}</span>
      </button>
      {toast.value && (
        <span
          class={`share-button-toast share-button-toast--${toast.value.kind}`}
          role="status"
        >
          {toast.value.text}
        </span>
      )}
    </span>
  );
}
