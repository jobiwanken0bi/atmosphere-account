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
import SignInForm from "./SignInForm.tsx";

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
  /** Optional task-specific explanation. The dialog title and actions remain
   * shared so contextual entry points cannot drift from the login UX. */
  bodyOverride?: string;
}

/**
 * Shared first-party account chooser for action CTAs. The trigger keeps a
 * contextual `/signin` href for no-JS and modified-click fallbacks; this
 * dialog is the progressively enhanced in-page experience.
 */
export default function ContextualSignInDialog(
  props: Props,
) {
  return createPortal(
    <div
      class="modal-backdrop contextual-signin-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <ContextualSignInDialogCard {...props} />
    </div>,
    document.body,
  );
}

/** Portal-free dialog body so the complete account chooser can be covered by
 * focused server-rendering tests as well as the live island flow. */
export function ContextualSignInDialogCard(
  {
    returnTo,
    action,
    capabilities,
    targetName,
    onClose,
    intent,
    rememberedAccounts = [],
    initialHandle,
    initialDid,
    onAuthorizationStart,
    allowAccountCreation: allowAccountCreationOverride,
    forceReauthorization = false,
    restrictToInitialHandle = false,
    bodyOverride,
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

  return (
    <div
      class="modal-card signin-modal-card auth-dialog-card"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
    >
      <button
        type="button"
        class="auth-dialog-close"
        aria-label={forceReauthorization
          ? "Close permission request"
          : "Close Login with Atmosphere"}
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
      <div class="modal-header auth-dialog-header">
        <h2 id={titleId} class="modal-title auth-brand-title">
          <img src="/union.svg" alt="" width="28" height="28" />
          <span>{dialogTitle}</span>
        </h2>
        <p id={bodyId} class="modal-body-text">
          {bodyOverride ??
            ((restrictAccount || forceReauthorization) && initialHandle
              ? copy.upgradeBody(initialHandle)
              : copy.signInBody)}
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
    </div>
  );
}

export function contextualDialogTitle(forceReauthorization: boolean): string {
  return forceReauthorization
    ? "Additional permission required"
    : "Login with Atmosphere";
}
