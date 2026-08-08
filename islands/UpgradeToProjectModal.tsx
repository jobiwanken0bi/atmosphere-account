import { useEffect, useId, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { createPortal } from "preact/compat";
import { useDialog } from "../lib/use-dialog.ts";
import { oauthSigninUrl } from "../lib/oauth-action.ts";
import { authActionCopy } from "../lib/oauth-action-copy.ts";
import { ensureSigninFormRuntime } from "../lib/signin-form-runtime.ts";
import SignInForm, { accountCreationFallbackHref } from "./SignInForm.tsx";

interface Props {
  /**
   * When true, the modal opens itself on mount. Used by the dashboard
   * to auto-show the upgrade prompt when the user lands here from a
   * "Register an app" CTA while already signed in as a user.
   */
  initiallyOpen?: boolean;
  /** Hide the standalone trigger when the modal is only a redirect target. */
  showTrigger?: boolean;
  currentHandle: string;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  copy: {
    button: string;
    modalTitle: string;
    modalBody: string;
    signInWithProjectLink: string;
    yes: string;
    cancel: string;
    submitting: string;
    error: string;
  };
}

export default function UpgradeToProjectModal(
  {
    initiallyOpen = false,
    showTrigger = true,
    currentHandle,
    rememberedAccounts = [],
    copy,
  }: Props,
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
  const choosingAccount = useSignal(false);
  const chooseAccountButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreConfirmationFocus = useRef(false);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const titleId = `upgrade-app-title-${id}`;
  const bodyId = `upgrade-app-body-${id}`;
  const fallbackHref = oauthSigninUrl({
    next: "/apps/manage?new=1",
    action: "app",
    capabilities: ["app"],
    name: "your app",
  });
  const appAuthCopy = authActionCopy("app", "your app");

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

  const close = () => {
    if (!submitting.value) {
      open.value = false;
      choosingAccount.value = false;
    }
  };

  const dialogRef = useDialog<HTMLDivElement>(open.value, close);

  useEffect(() => {
    if (!choosingAccount.value && !restoreConfirmationFocus.current) return;
    queueMicrotask(() => {
      if (choosingAccount.value) {
        dialogRef.current?.querySelector<HTMLElement>(
          '[data-dialog-initial-focus="true"]',
        )?.focus();
      } else {
        chooseAccountButtonRef.current?.focus();
        restoreConfirmationFocus.current = false;
      }
    });
  }, [choosingAccount.value]);

  useEffect(() => {
    if (choosingAccount.value) ensureSigninFormRuntime();
  }, [choosingAccount.value]);

  return (
    <>
      {showTrigger && (
        <button
          type="button"
          class="profile-form-button-secondary user-profile-upgrade-button"
          aria-haspopup="dialog"
          aria-expanded={open.value ? "true" : "false"}
          onClick={() => {
            open.value = true;
          }}
        >
          {copy.button}
        </button>
      )}

      {open.value && createPortal(
        <div
          class="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            class="modal-card signin-modal-card"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            tabIndex={-1}
          >
            <div class="modal-close-rail">
              <button
                type="button"
                class="modal-close-button"
                aria-label="Close app setup"
                onClick={close}
                disabled={submitting.value}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div class="modal-header">
              <h2 id={titleId} class="modal-title">
                {choosingAccount.value ? appAuthCopy.title : copy.modalTitle}
              </h2>
              <p id={bodyId} class="modal-body-text">
                {choosingAccount.value
                  ? appAuthCopy.signInBody
                  : copy.modalBody}
              </p>
            </div>
            {error.value && (
              <p
                class="report-modal-status report-modal-status--error"
                role="alert"
              >
                {error.value}
              </p>
            )}
            {choosingAccount.value
              ? (
                <>
                  <SignInForm
                    returnTo="/apps/manage?new=1"
                    action="app"
                    capabilities={["app"]}
                    targetName="your app"
                    rememberedAccounts={rememberedAccounts}
                    submitLabel="Continue"
                  />
                  <p class="signin-modal-account-link">
                    Need an account?{" "}
                    <a href={accountCreationFallbackHref(fallbackHref)}>
                      Create one
                    </a>.
                  </p>
                  <div class="profile-review-composer-actions">
                    <button
                      type="button"
                      class="profile-form-button-link"
                      onClick={() => {
                        restoreConfirmationFocus.current = true;
                        choosingAccount.value = false;
                      }}
                    >
                      Back
                    </button>
                  </div>
                </>
              )
              : (
                <>
                  <button
                    ref={chooseAccountButtonRef}
                    type="button"
                    class="profile-form-button-link"
                    onClick={() => choosingAccount.value = true}
                  >
                    {copy.signInWithProjectLink}
                  </button>
                  <form
                    method="POST"
                    action="/oauth/login"
                    class="profile-review-composer-actions"
                    onSubmit={() => {
                      submitting.value = true;
                      error.value = null;
                    }}
                  >
                    <input type="hidden" name="handle" value={currentHandle} />
                    <input
                      type="hidden"
                      name="next"
                      value="/apps/manage?new=1"
                    />
                    <input type="hidden" name="action" value="app" />
                    <input type="hidden" name="name" value="your app" />
                    <input type="hidden" name="capability" value="app" />
                    <button
                      type="button"
                      class="profile-form-button-link"
                      onClick={close}
                      disabled={submitting.value}
                    >
                      {copy.cancel}
                    </button>
                    <button
                      type="submit"
                      class="profile-form-button-primary"
                      data-dialog-initial-focus="true"
                      disabled={submitting.value}
                    >
                      {submitting.value ? copy.submitting : copy.yes}
                    </button>
                  </form>
                </>
              )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
