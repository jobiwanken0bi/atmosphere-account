import { useSignal } from "@preact/signals";
import { createPortal } from "preact/compat";
import type { Ref } from "preact";
import ManagementActionIcon, {
  type ManagementActionIconName,
} from "../components/ManagementActionIcon.tsx";
import type { OAuthAction } from "../lib/oauth-action.ts";
import type { OAuthCapability } from "../lib/oauth-scopes.ts";
import { useDialog } from "../lib/use-dialog.ts";
import SignInForm from "./SignInForm.tsx";

interface Props {
  href: string;
  returnTo: string;
  action: OAuthAction;
  capabilities: readonly OAuthCapability[];
  targetName: string;
  title?: string;
  body: string;
  label: string;
  className: string;
  leadingPlus?: boolean;
  trailingArrow?: boolean;
  leadingIcon?: ManagementActionIconName;
  intent?: "user" | "project";
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  initialHandle?: string;
}

interface PrimaryActivation {
  button: number;
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function isPlainPrimaryActivation(event: PrimaryActivation): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.altKey &&
    !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

export function LoginWithAtmosphereDialog(
  {
    id,
    body,
    onClose,
    dialogRef,
    returnTo,
    action,
    capabilities,
    targetName,
    intent,
    rememberedAccounts = [],
    initialHandle,
  }: {
    id: string;
    body: string;
    onClose: () => void;
    dialogRef?: Ref<HTMLDivElement>;
    returnTo: string;
    action: OAuthAction;
    capabilities: readonly OAuthCapability[];
    targetName: string;
    intent?: "user" | "project";
    rememberedAccounts?: Array<{ did: string; handle: string }>;
    initialHandle?: string;
  },
) {
  return (
    <div
      class="modal-card signin-modal-card auth-dialog-card"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={id}
      tabIndex={-1}
    >
      <button
        type="button"
        class="auth-dialog-close"
        aria-label="Close Login with Atmosphere"
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
      <div class="modal-header auth-dialog-header">
        <h2 id={id} class="modal-title auth-brand-title">
          <img src="/union.svg" alt="" width="28" height="28" />
          <span>Login with Atmosphere</span>
        </h2>
        <p class="modal-body-text">{body}</p>
      </div>
      <SignInForm
        returnTo={returnTo}
        intent={intent}
        capabilities={capabilities}
        action={action}
        targetName={targetName}
        rememberedAccounts={rememberedAccounts}
        initialHandle={initialHandle}
      />
    </div>
  );
}

/**
 * Progressive enhancement for public action links. Without JavaScript the
 * contextual `/signin` href remains fully functional; with JavaScript the
 * same explanation and account chooser open in place.
 */
export default function ContextualSignInLink(
  {
    href,
    returnTo,
    action,
    capabilities,
    targetName,
    body,
    label,
    className,
    leadingPlus = false,
    trailingArrow = false,
    leadingIcon,
    intent,
    rememberedAccounts = [],
    initialHandle,
  }: Props,
) {
  const open = useSignal(false);
  const dialogRef = useDialog<HTMLDivElement>(open.value, () => {
    open.value = false;
  });

  return (
    <>
      <a
        class={className}
        href={href}
        aria-haspopup="dialog"
        onClick={(event) => {
          if (!isPlainPrimaryActivation(event)) return;
          event.preventDefault();
          open.value = true;
        }}
      >
        {leadingIcon && <ManagementActionIcon name={leadingIcon} />}
        {leadingPlus && (
          <span class="directory-register-button-icon" aria-hidden="true">
            +
          </span>
        )}
        <span>{label}</span>
        {trailingArrow && <span aria-hidden="true">→</span>}
      </a>
      {open.value && createPortal(
        <div
          class="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) open.value = false;
          }}
        >
          <LoginWithAtmosphereDialog
            id="contextual-signin-title"
            body={body}
            onClose={() => open.value = false}
            dialogRef={dialogRef}
            returnTo={returnTo}
            intent={intent}
            capabilities={capabilities}
            action={action}
            targetName={targetName}
            rememberedAccounts={rememberedAccounts}
            initialHandle={initialHandle}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
