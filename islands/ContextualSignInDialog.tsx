import { createPortal } from "preact/compat";
import { useEffect, useId } from "preact/hooks";
import type { OAuthAction } from "../lib/oauth-action.ts";
import type { OAuthCapability } from "../lib/oauth-scopes.ts";
import {
  authActionCopy,
  oauthActionAllowsAccountCreation,
} from "../lib/oauth-action-copy.ts";
import { ensureSigninFormRuntime } from "../lib/signin-form-runtime.ts";
import { useDialog } from "../lib/use-dialog.ts";
import SignInForm, { accountCreationFallbackHref } from "./SignInForm.tsx";

interface Props {
  fallbackHref: string;
  returnTo: string;
  action: OAuthAction;
  capabilities: readonly OAuthCapability[];
  targetName: string;
  onClose: () => void;
  closeLabel?: string;
  intent?: "user" | "project";
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  initialHandle?: string;
  initialDid?: string;
  onAuthorizationStart?: () => void;
  allowAccountCreation?: boolean;
  forceReauthorization?: boolean;
  restrictToInitialHandle?: boolean;
}

/**
 * Shared first-party account chooser for action CTAs. The trigger keeps a
 * contextual `/signin` href for no-JS and modified-click fallbacks; this
 * dialog is the progressively enhanced in-page experience.
 */
export default function ContextualSignInDialog(
  {
    fallbackHref,
    returnTo,
    action,
    capabilities,
    targetName,
    onClose,
    closeLabel = "Cancel",
    intent,
    rememberedAccounts = [],
    initialHandle,
    initialDid,
    onAuthorizationStart,
    allowAccountCreation: allowAccountCreationOverride,
    forceReauthorization = false,
    restrictToInitialHandle = false,
  }: Props,
) {
  const copy = authActionCopy(action, targetName);
  const dialogTitle = contextualDialogTitle(forceReauthorization);
  const restrictAccount = restrictToInitialHandle && !!initialHandle &&
    !!initialDid;
  const allowAccountCreation = !restrictAccount &&
    (allowAccountCreationOverride ?? oauthActionAllowsAccountCreation(action));
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const titleId = `contextual-signin-title-${id}`;
  const bodyId = `contextual-signin-body-${id}`;
  const dialogRef = useDialog<HTMLDivElement>(true, onClose);

  useEffect(() => {
    // These form-only modules are deferred until an action actually opens the
    // chooser. The form remains a complete server fallback while they load.
    ensureSigninFormRuntime();
  }, []);

  return createPortal(
    <div
      class="modal-backdrop contextual-signin-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
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
            aria-label={forceReauthorization
              ? "Close permission request"
              : "Close sign-in"}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div class="modal-header">
          <h2 id={titleId} class="modal-title">{dialogTitle}</h2>
          <p id={bodyId} class="modal-body-text">
            {(restrictAccount || forceReauthorization) && initialHandle
              ? copy.upgradeBody(initialHandle)
              : copy.signInBody}
          </p>
        </div>
        <SignInForm
          returnTo={returnTo}
          intent={intent}
          capabilities={capabilities}
          action={action}
          targetName={targetName}
          rememberedAccounts={restrictAccount ? [] : rememberedAccounts}
          initialHandle={initialHandle}
          initialDid={restrictAccount ? initialDid : undefined}
          allowAccountCreation={allowAccountCreation}
          submitLabel="Continue"
          forceReauthorization={forceReauthorization}
          lockInitialHandle={restrictAccount}
          onAuthorizationStart={onAuthorizationStart}
        />
        {allowAccountCreation && (
          <p class="signin-modal-account-link">
            Need an account?{" "}
            <a href={accountCreationFallbackHref(fallbackHref)}>Create one</a>.
          </p>
        )}
        <div class="profile-review-composer-actions">
          <button
            type="button"
            class="profile-form-button-link"
            onClick={onClose}
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function contextualDialogTitle(forceReauthorization: boolean): string {
  return forceReauthorization
    ? "Additional permission required"
    : "Sign in with Atmosphere account";
}
