import { useSignal } from "@preact/signals";
import ManagementActionIcon, {
  type ManagementActionIconName,
} from "../components/ManagementActionIcon.tsx";
import type { OAuthAction } from "../lib/oauth-action.ts";
import type { OAuthCapability } from "../lib/oauth-scopes.ts";
import ContextualSignInDialog from "./ContextualSignInDialog.tsx";

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
      {open.value && (
        <ContextualSignInDialog
          fallbackHref={href}
          bodyOverride={body}
          onClose={() => open.value = false}
          returnTo={returnTo}
          intent={intent}
          capabilities={capabilities}
          action={action}
          targetName={targetName}
          rememberedAccounts={rememberedAccounts}
          initialHandle={initialHandle}
        />
      )}
    </>
  );
}
