import ContextualSignInLink from "../islands/ContextualSignInLink.tsx";
import { oauthSigninUrl } from "../lib/oauth-action.ts";
import ManagementActionIcon, {
  type ManagementActionIconName,
} from "./ManagementActionIcon.tsx";

export type OwnerManagementKind = "app" | "host";

interface Props {
  authorized: boolean;
  kind: OwnerManagementKind;
  destinationHref: string;
  targetName: string;
  label: string;
  className?: string;
  leadingIcon?: ManagementActionIconName;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  initialHandle?: string;
}

interface AuthorizationInput {
  kind: OwnerManagementKind;
  destinationHref: string;
  targetName: string;
}

export function ownerManagementAuthorizationHref(
  { kind, destinationHref, targetName }: AuthorizationInput,
): string {
  return kind === "app"
    ? oauthSigninUrl({
      next: destinationHref,
      action: "app",
      capabilities: ["app"],
      name: targetName,
    })
    : oauthSigninUrl({
      next: destinationHref,
      action: "host_manage",
      capabilities: ["host"],
      name: targetName,
    });
}

/**
 * Owner-only management entry points stay ordinary links when the current
 * session is ready. A narrower session gets the same destination as a no-JS
 * `/signin` fallback and an in-page permission dialog when JavaScript runs.
 */
export default function OwnerManagementLink(
  {
    authorized,
    kind,
    destinationHref,
    targetName,
    label,
    className = "",
    leadingIcon,
    rememberedAccounts = [],
    initialHandle,
  }: Props,
) {
  if (authorized) {
    return (
      <a class={className} href={destinationHref}>
        {leadingIcon && <ManagementActionIcon name={leadingIcon} />}
        <span>{label}</span>
      </a>
    );
  }

  const action = kind === "app" ? "app" : "host_manage";
  const capabilities = kind === "app" ? ["app"] as const : ["host"] as const;
  return (
    <ContextualSignInLink
      href={ownerManagementAuthorizationHref({
        kind,
        destinationHref,
        targetName,
      })}
      returnTo={destinationHref}
      action={action}
      capabilities={capabilities}
      targetName={targetName}
      label={label}
      className={className}
      leadingIcon={leadingIcon}
      rememberedAccounts={rememberedAccounts}
      initialHandle={initialHandle}
    />
  );
}
