import { useT } from "../i18n/mod.ts";
import AccountMenu from "../islands/AccountMenu.tsx";
import NavScroll from "../islands/NavScroll.tsx";

interface NavProps {
  /**
   * When set, render the explore-page AccountMenu rail directly under
   * the protocol button. `user: null` shows a generic avatar with a
   * "Sign in" entry; an authenticated user shows their pic + manage /
   * sign-out actions.
   *
   * Pages that don't want the menu (the marketing homepage) just omit
   * this prop entirely.
   */
  account?: {
    user: { did: string; handle: string } | null;
    accountType?: "user" | "project" | null;
    avatarUrl?: string | null;
    publicProfileHandle?: string | null;
    /** Other accounts that have signed in on this device, used to
     *  power the in-menu account switcher. Optional — pages that
     *  don't have access to the per-request value (e.g. the static
     *  marketing nav) can omit it. */
    rememberedAccounts?: { did: string; handle: string }[];
  };
  showEffects?: boolean;
}

export default function Nav({ account, showEffects = false }: NavProps = {}) {
  const t = useT();
  return (
    <>
      <nav class="nav" id="main-nav">
        <a href="/" class="nav-logo">
          <img src="/union.svg" alt={t.nav.logoAlt} width="26" height="26" />
          <span class="nav-logo-text">{t.nav.brand}</span>
        </a>
        <div class="nav-links">
          {
            /* Protocol moved to the footer — the top-right slot now
            * belongs to Explore (the primary call to action) with the
            * account button stacked beneath it via the rail below. */
          }
          <a href="/explore" class="nav-btn nav-btn-glass">
            {t.nav.explore}
          </a>
        </div>
      </nav>
      {account !== undefined && (
        <div class="account-menu-rail" id="account-menu-rail">
          <AccountMenu
            user={account.user}
            accountType={account.accountType ?? null}
            avatarUrl={account.avatarUrl ?? null}
            publicProfileHandle={account.publicProfileHandle ?? null}
            rememberedAccounts={account.rememberedAccounts ?? []}
          />
        </div>
      )}
      {showEffects && (
        <div class="nav-effects-bar" id="nav-effects-bar">
          <label class="nav-sky-switch-label">
            <span class="nav-sky-switch-text">{t.nav.effects}</span>
            <span class="nav-sky-switch">
              <input
                type="checkbox"
                id="sky-effects-toggle"
                class="nav-sky-switch-input"
                defaultChecked
                aria-label={t.nav.effectsOn}
              />
              <span class="nav-sky-switch-track" aria-hidden="true" />
            </span>
          </label>
        </div>
      )}
      {!showEffects && <NavScroll />}
    </>
  );
}
