import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { createPortal } from "preact/compat";

interface Props {
  /**
   * When true, the modal opens itself on mount. Used by the dashboard
   * to auto-show the upgrade prompt when the user lands here from a
   * "Submit your project" CTA while already signed in as a user.
   */
  initiallyOpen?: boolean;
  copy: {
    button: string;
    modalTitle: string;
    modalBody: string;
    signInWithProjectLink: string;
    signInWithProjectSuffix: string;
    yes: string;
    cancel: string;
    submitting: string;
    error: string;
  };
}

export default function UpgradeToProjectModal(
  { initiallyOpen = false, copy }: Props,
) {
  /**
   * `open` always starts false so SSR never tries to evaluate
   * `document.body` (which doesn't exist server-side). The `useEffect`
   * below flips it true after hydration when `initiallyOpen` is set,
   * and clears the `?upgrade=1` query param so refreshes don't replay
   * the modal forever.
   */
  const open = useSignal(false);
  const submitting = useSignal(false);
  const error = useSignal<string | null>(null);

  useEffect(() => {
    if (!initiallyOpen) return;
    open.value = true;
    const url = new URL(globalThis.location.href);
    if (url.searchParams.has("upgrade")) {
      url.searchParams.delete("upgrade");
      const next = url.pathname + (url.search ? url.search : "") + url.hash;
      globalThis.history.replaceState(null, "", next);
    }
  }, []);

  const onConfirm = async () => {
    submitting.value = true;
    error.value = null;
    try {
      const body = new URLSearchParams({ accountType: "project" });
      const res = await fetch("/api/account/type", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        redirect: "manual",
      });
      /**
       * The API responds 303 → /explore/manage on success. `redirect:
       * "manual"` surfaces that as `res.type === "opaqueredirect"`
       * (status 0); treat any 2xx/3xx outcome as success and navigate
       * the browser to the project dashboard ourselves.
       */
      if (
        res.type === "opaqueredirect" ||
        (res.status >= 200 && res.status < 400)
      ) {
        globalThis.location.href = "/explore/manage";
        return;
      }
      const text = await res.text().catch(() => "");
      throw new Error(text || copy.error);
    } catch (err) {
      error.value = err instanceof Error ? err.message : copy.error;
      submitting.value = false;
    }
  };

  return (
    <>
      <button
        type="button"
        class="profile-form-button-secondary user-profile-upgrade-button"
        onClick={() => {
          open.value = true;
        }}
      >
        {copy.button}
      </button>

      {open.value && createPortal(
        <div
          class="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting.value) {
              open.value = false;
            }
          }}
        >
          <div class="modal-card">
            <div class="modal-header">
              <p class="modal-title">{copy.modalTitle}</p>
              <p class="modal-body-text">
                {copy.modalBody}{" "}
                <a href="/oauth/add-account?intent=project">
                  {copy.signInWithProjectLink}
                </a>
                {copy.signInWithProjectSuffix}
              </p>
            </div>
            {error.value && (
              <p class="report-modal-status report-modal-status--error">
                {error.value}
              </p>
            )}
            <div class="profile-review-composer-actions">
              <button
                type="button"
                class="profile-form-button-link"
                onClick={() => {
                  open.value = false;
                }}
                disabled={submitting.value}
              >
                {copy.cancel}
              </button>
              <button
                type="button"
                class="profile-form-button-primary"
                onClick={onConfirm}
                disabled={submitting.value}
              >
                {submitting.value ? copy.submitting : copy.yes}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
