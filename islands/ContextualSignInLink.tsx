import { useSignal } from "@preact/signals";
import type { OAuthAction } from "../lib/oauth-action.ts";
import type { OAuthCapability } from "../lib/oauth-scopes.ts";
import ManagementActionIcon, {
  type ManagementActionIconName,
} from "../components/ManagementActionIcon.tsx";
import { isPlainLinkActivation } from "../lib/link-activation.ts";

type ContextualSignInDialogComponent =
  typeof import("./ContextualSignInDialog.tsx")["default"];

let dialogModulePromise: Promise<ContextualSignInDialogComponent> | null = null;

function loadContextualSignInDialog(): Promise<
  ContextualSignInDialogComponent
> {
  if (!dialogModulePromise) {
    dialogModulePromise = import("./ContextualSignInDialog.tsx")
      .then((module) => module.default)
      .catch((error) => {
        dialogModulePromise = null;
        throw error;
      });
  }
  return dialogModulePromise;
}

interface Props {
  href: string;
  returnTo: string;
  action: OAuthAction;
  capabilities: readonly OAuthCapability[];
  targetName: string;
  label: string;
  className: string;
  leadingIcon?: ManagementActionIconName;
  leadingPlus?: boolean;
  trailingArrow?: boolean;
  intent?: "user" | "project";
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  initialHandle?: string;
  /** Keep account replacement on the explicit choose-another path. */
  chooseAnotherAccount?: boolean;
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
    label,
    className,
    leadingIcon,
    leadingPlus = false,
    trailingArrow = false,
    intent,
    rememberedAccounts = [],
    initialHandle,
    chooseAnotherAccount = false,
  }: Props,
) {
  const open = useSignal(false);
  const Dialog = useSignal<ContextualSignInDialogComponent | null>(null);

  const prepareDialog = () => {
    if (Dialog.value) return;
    void loadContextualSignInDialog().then((component) => {
      Dialog.value = component;
    }).catch(() => {});
  };
  const DialogComponent = Dialog.value;

  return (
    <>
      <a
        class={className}
        href={href}
        aria-haspopup="dialog"
        aria-expanded={open.value ? "true" : "false"}
        aria-busy={open.value && !Dialog.value ? "true" : undefined}
        onPointerEnter={prepareDialog}
        onPointerDown={prepareDialog}
        onFocus={prepareDialog}
        onClick={(event) => {
          if (!isPlainLinkActivation(event)) return;
          event.preventDefault();
          open.value = true;
          loadContextualSignInDialog().then((component) => {
            Dialog.value = component;
          }).catch(() => {
            globalThis.location.assign(href);
          });
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
      {open.value && DialogComponent && (
        <DialogComponent
          fallbackHref={href}
          returnTo={returnTo}
          intent={intent}
          action={action}
          capabilities={capabilities}
          targetName={targetName}
          rememberedAccounts={rememberedAccounts}
          initialHandle={initialHandle}
          chooseAnotherAccount={chooseAnotherAccount}
          onClose={() => open.value = false}
        />
      )}
      {open.value && !Dialog.value && (
        <span class="visually-hidden" role="status" aria-live="polite">
          Loading account chooser…
        </span>
      )}
    </>
  );
}
