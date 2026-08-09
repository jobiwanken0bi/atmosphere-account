import ContextualSignInLink from "../../islands/ContextualSignInLink.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  APP_MANAGEMENT_CAPABILITIES,
  oauthSigninUrl,
} from "../../lib/oauth-action.ts";

interface Props {
  account: ReturnType<typeof buildAccountMenuProps>;
  secondaryHref?: string;
  secondaryLabel?: string;
}

export const APP_REGISTRATION_SIGNIN_BODY =
  "Choose the Atmosphere account that will represent and manage this app, including its public profile and images.";

/**
 * Directory entry point for app registration. A DID that already controls an
 * app manages that app instead; a host-only account may still register its
 * first app.
 */
export default function AppDirectoryOwnerCta(
  { account, secondaryHref, secondaryLabel }: Props,
) {
  return (
    <div class="directory-register-cta">
      {secondaryHref && secondaryLabel && (
        <a href={secondaryHref} class="directory-register-button">
          <span class="directory-register-button-icon" aria-hidden="true">
            ↗
          </span>
          <span>{secondaryLabel}</span>
        </a>
      )}
      {account.user && account.hasManagedAppProfile
        ? (
          <a href="/apps/manage" class="directory-register-button">
            <span class="directory-register-button-icon" aria-hidden="true">
              ✎
            </span>
            <span>Manage your app</span>
          </a>
        )
        : account.user
        ? (
          <a href="/apps/manage?new=1" class="directory-register-button">
            <span class="directory-register-button-icon" aria-hidden="true">
              +
            </span>
            <span>Register an app</span>
          </a>
        )
        : (
          <ContextualSignInLink
            href={appRegistrationSigninHref()}
            returnTo="/apps/manage?new=1"
            action="app"
            capabilities={APP_MANAGEMENT_CAPABILITIES}
            targetName="your app"
            title="Login with Atmosphere"
            body={APP_REGISTRATION_SIGNIN_BODY}
            label="Register an app"
            className="directory-register-button"
            leadingPlus
            rememberedAccounts={account.rememberedAccounts}
          />
        )}
    </div>
  );
}

export function appRegistrationSigninHref(): string {
  return oauthSigninUrl({
    next: "/apps/manage?new=1",
    action: "app",
    capabilities: APP_MANAGEMENT_CAPABILITIES,
    name: "your app",
  });
}
