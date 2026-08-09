import { useT } from "../i18n/mod.ts";
import AccountMenu from "../islands/AccountMenu.tsx";

interface NavProps {
  /**
   * Account state for the global account control. Anonymous callers render
   * only the public destinations; authenticated callers also get their menu.
   */
  account?: {
    user: { did: string; handle: string } | null;
    hasManagedAppProfile?: boolean;
    hasManagedHostProfiles?: boolean;
    hasManagedProfiles?: boolean;
    accountType?: "user" | "project" | null;
    avatarUrl?: string | null;
    publicProfileHandle?: string | null;
    accountHost?: {
      displayName: string;
      endpoint: string;
    } | null;
    /** Other accounts that have signed in on this device, used to
     *  power the in-menu account switcher. Optional — pages that
     *  don't have access to the per-request value (e.g. the static
     *  marketing nav) can omit it. */
    rememberedAccounts?: { did: string; handle: string }[];
  };
  disableScrollEffects?: boolean;
  active?: "hosts" | "apps" | "docs" | null;
}

export default function Nav(
  { account, disableScrollEffects = false, active = null }: NavProps = {},
) {
  const t = useT();
  const accountProps = account ?? {
    user: null,
    hasManagedAppProfile: false,
    hasManagedHostProfiles: false,
    hasManagedProfiles: false,
    accountType: null,
    avatarUrl: null,
    publicProfileHandle: null,
    accountHost: null,
    rememberedAccounts: [],
  };
  const hostsCurrent = active === "hosts"
    ? { "aria-current": "page" as const, "data-current": "true" }
    : {};
  const appsCurrent = active === "apps"
    ? { "aria-current": "page" as const, "data-current": "true" }
    : {};
  const docsCurrent = active === "docs"
    ? { "aria-current": "page" as const, "data-current": "true" }
    : {};
  return (
    <nav
      class="nav"
      id="main-nav"
      data-scroll-effects={disableScrollEffects ? "false" : "true"}
    >
      <a class="nav-skip-link" href="#main-content">
        Skip to main content
      </a>
      <a href="/" class="nav-logo">
        <img src="/union.svg" alt={t.nav.logoAlt} width="26" height="26" />
        <span class="nav-logo-text">{t.nav.brand}</span>
      </a>
      <div class="nav-actions">
        <div class="nav-links">
          <a
            href="/hosts"
            class="nav-btn nav-btn-ghost"
            {...hostsCurrent}
          >
            {t.nav.hosts}
          </a>
          <a
            href="/apps"
            class="nav-btn nav-btn-ghost"
            {...appsCurrent}
          >
            {t.nav.apps}
          </a>
          <a
            href="/docs"
            class="nav-btn nav-btn-ghost nav-docs-link"
            aria-label={t.nav.docs}
            {...docsCurrent}
          >
            <svg
              class="nav-docs-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                d="M5 4.75h4.4c1.1 0 2.1.45 2.6 1.2.5-.75 1.5-1.2 2.6-1.2H19v14h-4.4c-1.1 0-2.1.45-2.6 1.2-.5-.75-1.5-1.2-2.6-1.2H5v-14Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M12 6v13.7"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
              />
            </svg>
            <span class="nav-docs-label">{t.nav.docs}</span>
          </a>
        </div>
        <div class="nav-account">
          <AccountMenu
            user={accountProps.user}
            hasManagedProfiles={accountProps.hasManagedProfiles ?? false}
            accountType={accountProps.accountType ?? null}
            avatarUrl={accountProps.avatarUrl ?? null}
            publicProfileHandle={accountProps.publicProfileHandle ?? null}
            accountHost={accountProps.accountHost ?? null}
            rememberedAccounts={accountProps.rememberedAccounts ?? []}
          />
        </div>
      </div>
    </nav>
  );
}
