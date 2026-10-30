import ContextualSignInLink from "../../islands/ContextualSignInLink.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import type { AppListing } from "../../lib/app-directory.ts";
import { appManagementHref } from "../../lib/app-management-navigation.ts";
import { oauthSigninUrl } from "../../lib/oauth-action.ts";
import ManagementActionIcon from "../ManagementActionIcon.tsx";
import OwnerManagementLink from "../OwnerManagementLink.tsx";

type ManagedAppSummary = Pick<
  AppListing,
  "id" | "name" | "atstoreListingUri"
>;

interface Props {
  account: ReturnType<typeof buildAccountMenuProps>;
  appAuthorized: boolean;
  /** `undefined` means ownership could not be checked, so registration fails closed. */
  managedApp: ManagedAppSummary | null | undefined;
  secondaryHref?: string;
  secondaryLabel?: string;
}

/**
 * The app directory has the same owner action on its home and browse pages.
 * An account that already represents an app manages that profile; only an
 * account without an app is offered registration.
 */
export default function AppDirectoryOwnerCta(
  {
    account,
    appAuthorized,
    managedApp,
    secondaryHref,
    secondaryLabel,
  }: Props,
) {
  const user = account.user;
  const manageHref = managedApp && user
    ? appManagementHref(managedApp, user.did)
    : null;

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
      {managedApp && manageHref && user
        ? (
          <OwnerManagementLink
            authorized={appAuthorized}
            kind="app"
            destinationHref={manageHref}
            targetName={managedApp.name}
            label="Manage your app"
            className="directory-register-button"
            leadingIcon="edit"
            rememberedAccounts={account.rememberedAccounts}
            initialHandle={user.handle}
          />
        )
        : user && managedApp === undefined
        ? (
          <a href="/account/products" class="directory-register-button">
            <ManagementActionIcon name="edit" />
            <span>Manage listings</span>
          </a>
        )
        : user && appAuthorized
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
            intent="project"
            action="app"
            capabilities={["app"]}
            targetName="your app"
            label="Register an app"
            className="directory-register-button"
            leadingPlus
            rememberedAccounts={account.rememberedAccounts}
            initialHandle={user?.handle}
          />
        )}
    </div>
  );
}

export function appRegistrationSigninHref(): string {
  return oauthSigninUrl({
    next: "/apps/manage?new=1",
    intent: "project",
    action: "app",
    capabilities: ["app"],
    name: "your app",
  });
}
