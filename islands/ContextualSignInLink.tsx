import { useSignal } from "@preact/signals";
import type { OAuthAction } from "../lib/oauth-action.ts";
import type { OAuthCapability } from "../lib/oauth-scopes.ts";
import ManagementActionIcon, {
  type ManagementActionIconName,
} from "../components/ManagementActionIcon.tsx";
import { isPlainLinkActivation } from "../lib/link-activation.ts";
import ContextualSignInDialog from "./ContextualSignInDialog.tsx";

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
  }: Props,
) {
  const open = useSignal(false);

  return (
    <>
      <a
        class={className}
        href={href}
        aria-haspopup="dialog"
        aria-expanded={open.value ? "true" : "false"}
        onClick={(event) => {
          if (!isPlainLinkActivation(event)) return;
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
          returnTo={returnTo}
          intent={intent}
          action={action}
          capabilities={capabilities}
          targetName={targetName}
          rememberedAccounts={rememberedAccounts}
          initialHandle={initialHandle}
          onClose={() => open.value = false}
        />
      )}
    </>
  );
}
