import type { ContextualReauthorization } from "../lib/reauth-required.ts";
import ContextualSignInDialog from "./ContextualSignInDialog.tsx";

interface Props {
  authorization: ContextualReauthorization;
  onClose: () => void;
  closeLabel?: string;
  currentHandle: string;
  currentDid: string;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  onAuthorizationStart?: () => void;
  restrictToCurrentAccount?: boolean;
}

/**
 * Adapts a validated API reauthorization response to the same contextual
 * chooser used by signed-out CTAs. The original `/signin` URL remains the
 * full-page fallback while normal form submissions continue without client
 * scripting once the dialog is open.
 */
export default function ContextualReauthorizationDialog(
  {
    authorization,
    onClose,
    closeLabel,
    currentHandle,
    currentDid,
    rememberedAccounts = [],
    onAuthorizationStart,
    restrictToCurrentAccount = false,
  }: Props,
) {
  return (
    <ContextualSignInDialog
      fallbackHref={authorization.fallbackHref}
      returnTo={authorization.returnTo}
      action={authorization.action}
      capabilities={authorization.capabilities}
      targetName={authorization.targetName}
      intent={authorization.intent}
      initialHandle={currentHandle}
      initialDid={currentDid}
      rememberedAccounts={rememberedAccounts}
      closeLabel={closeLabel}
      allowAccountCreation={false}
      forceReauthorization
      restrictToInitialHandle={restrictToCurrentAccount}
      onAuthorizationStart={onAuthorizationStart}
      onClose={onClose}
    />
  );
}
