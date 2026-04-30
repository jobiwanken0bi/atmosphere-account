import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useT } from "../i18n/mod.ts";

interface RememberedAccount {
  did: string;
  handle: string;
}

interface Props {
  /** null when signed out — drives whether the menu shows sign-in or
   *  sign-out + manage actions. */
  user: { did: string; handle: string } | null;
  accountType?: "user" | "project" | null;
  /**
   * Server-resolved avatar URL (typically /api/me/avatar). Falls back
   * to a handle-initial pill if the image 404s or fails to load.
   *
   * The route handler is responsible for cache-busting per-DID so
   * switching accounts doesn't show the previous user's portrait —
   * see e.g. `routes/explore.tsx` which appends `?v=<did>`.
   */
  avatarUrl?: string | null;
  /**
   * If we already know the user has a registry profile, link to the
   * public profile page from the menu so they can preview what others
   * see. Otherwise we just show "Manage profile".
   */
  publicProfileHandle?: string | null;
  /**
   * Accounts that have completed OAuth on this device. Drives the
   * switcher list inside the menu — accounts other than the current
   * one render as one-click switch buttons that POST to /oauth/switch.
   * Defaults to an empty list (renders nothing) when omitted.
   */
  rememberedAccounts?: RememberedAccount[];
}

export default function AccountMenu(
  {
    user,
    accountType,
    avatarUrl,
    publicProfileHandle,
    rememberedAccounts,
  }: Props,
) {
  const t = useT().nav.account;
  const accounts = rememberedAccounts ?? [];

  if (!user) {
    /**
     * Signed out with remembered accounts — show the dropdown in a
     * "signed out" state so the user can see (and one-click switch
     * back to) any account they previously authenticated with on this
     * device. This is the state you land in after /oauth/add-account
     * clears the active session while preserving the cookie.
     */
    if (accounts.length > 0) {
      return <SignedOutMenu rememberedAccounts={accounts} />;
    }
    /** Fully signed out, no remembered accounts — plain link. */
    return (
      <a
        href="/explore/create"
        class="nav-btn nav-btn-ghost account-menu-signin"
      >
        {t.signIn}
      </a>
    );
  }

  return (
    <SignedInMenu
      user={user}
      accountType={accountType ?? null}
      avatarUrl={avatarUrl ?? null}
      publicProfileHandle={publicProfileHandle ?? null}
      rememberedAccounts={accounts}
    />
  );
}

/** Shown when the session is cleared but the device still has remembered
 *  accounts (e.g. after /oauth/add-account redirects to the sign-in page).
 *  Gives the user a quick way to switch back without having to type their
 *  handle again. */
function SignedOutMenu(
  { rememberedAccounts }: { rememberedAccounts: RememberedAccount[] },
) {
  const t = useT().nav.account;
  const open = useSignal(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current) return;
      const node = e.target;
      if (node instanceof Node && !wrapRef.current.contains(node)) {
        open.value = false;
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open.value) {
        open.value = false;
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div class="account-menu" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        class="account-menu-trigger account-menu-trigger--signed-out"
        aria-haspopup="menu"
        aria-expanded={open.value}
        aria-label={t.menuLabel}
        onClick={() => {
          open.value = !open.value;
        }}
      >
        <span class="account-menu-avatar" aria-hidden="true">
          <span class="account-menu-avatar-initial">?</span>
        </span>
        <span class="account-menu-chevron" aria-hidden="true">▾</span>
      </button>

      {open.value && (
        <div class="account-menu-popup glass" role="menu">
          <div class="account-menu-header">
            <span class="account-menu-header-label">
              {t.signedOut}
            </span>
          </div>
          <div class="account-menu-divider" aria-hidden="true" />
          <div class="account-menu-section-label">{t.yourAccounts}</div>
          {rememberedAccounts.map((account) => (
            <SwitchRow
              key={account.did}
              account={account}
              forgetLabel={t.forget}
              switchLabel={t.switchTo(account.handle)}
              forgetConfirm={t.forgetConfirm(account.handle)}
            />
          ))}
          <div class="account-menu-divider" aria-hidden="true" />
          <a
            href="/explore/create"
            class="account-menu-item account-menu-item-add"
            role="menuitem"
            onClick={() => {
              open.value = false;
            }}
          >
            <span class="account-menu-add-glyph" aria-hidden="true">+</span>
            {t.signIn}
          </a>
        </div>
      )}
    </div>
  );
}

interface SignedInMenuProps {
  user: { did: string; handle: string };
  accountType: "user" | "project" | null;
  avatarUrl: string | null;
  publicProfileHandle: string | null;
  rememberedAccounts: RememberedAccount[];
}

function SignedInMenu(
  { user, accountType, avatarUrl, publicProfileHandle, rememberedAccounts }:
    SignedInMenuProps,
) {
  const t = useT().nav.account;
  const open = useSignal(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current) return;
      const node = e.target;
      if (node instanceof Node && !wrapRef.current.contains(node)) {
        open.value = false;
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open.value) {
        open.value = false;
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const others = rememberedAccounts.filter((a) => a.did !== user.did);

  return (
    <div class="account-menu" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        class="account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open.value}
        aria-label={t.menuLabel}
        onClick={() => {
          open.value = !open.value;
        }}
      >
        <Avatar
          /** Re-key on `user.did` so when the user switches accounts
           *  Preact actually unmounts the previous <img> instead of
           *  reusing the DOM node (which would have caused the cached
           *  pixels for the previous account to flash before the new
           *  source loaded). */
          key={user.did}
          url={avatarUrl}
          handle={user.handle}
        />
        <span class="account-menu-chevron" aria-hidden="true">▾</span>
      </button>

      {open.value && (
        <div class="account-menu-popup glass" role="menu">
          <div class="account-menu-header">
            <span class="account-menu-header-label">
              {t.signedInAs}
            </span>
            <span class="account-menu-header-handle">
              @{user.handle}
            </span>
          </div>
          <div class="account-menu-divider" aria-hidden="true" />
          {publicProfileHandle && (
            <a
              href={`/explore/${encodeURIComponent(publicProfileHandle)}`}
              class="account-menu-item"
              role="menuitem"
              onClick={() => {
                open.value = false;
              }}
            >
              {t.viewProfile}
            </a>
          )}
          <a
            href={accountType === "project"
              ? "/explore/manage"
              : "/account/reviews"}
            class="account-menu-item"
            role="menuitem"
            onClick={() => {
              open.value = false;
            }}
          >
            {t.manageProfile}
          </a>
          <form
            method="POST"
            action="/oauth/logout"
            class="account-menu-form"
          >
            <button
              type="submit"
              class="account-menu-item account-menu-item-danger"
              role="menuitem"
            >
              {t.signOut}
            </button>
          </form>

          {
            /* Always render the switcher section so users can add a
           *  second account even when only one is remembered — the
           *  list of switch rows just collapses to empty in that case. */
          }
          <div class="account-menu-divider" aria-hidden="true" />
          <div class="account-menu-section-label">
            {t.switchHeading}
          </div>
          {others.map((account) => (
            <SwitchRow
              key={account.did}
              account={account}
              forgetLabel={t.forget}
              switchLabel={t.switchTo(account.handle)}
              forgetConfirm={t.forgetConfirm(account.handle)}
            />
          ))}
          {
            /* POST so the server can clear the live session and route
           *  the browser to /explore/create even when the user is
           *  currently signed in (a normal /explore/create GET would
           *  redirect them back to /explore/manage). */
          }
          <form
            method="POST"
            action="/oauth/add-account"
            class="account-menu-form"
          >
            <button
              type="submit"
              class="account-menu-item account-menu-item-add"
              role="menuitem"
            >
              <span class="account-menu-add-glyph" aria-hidden="true">+</span>
              {t.addAccount}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

interface SwitchRowProps {
  account: RememberedAccount;
  switchLabel: string;
  forgetLabel: string;
  forgetConfirm: string;
}

function SwitchRow(
  { account, switchLabel, forgetLabel, forgetConfirm }: SwitchRowProps,
) {
  return (
    <div class="account-menu-switch-row" role="none">
      <form
        method="POST"
        action="/oauth/switch"
        class="account-menu-switch-form"
      >
        <input type="hidden" name="did" value={account.did} />
        <button
          type="submit"
          class="account-menu-item account-menu-switch-btn"
          role="menuitem"
          aria-label={switchLabel}
          title={switchLabel}
        >
          <Avatar
            url={`/api/registry/avatar/${encodeURIComponent(account.did)}`}
            handle={account.handle}
          />
          <span class="account-menu-switch-handle">@{account.handle}</span>
        </button>
      </form>
      <form
        method="POST"
        action="/oauth/forget"
        class="account-menu-forget-form"
        onSubmit={(e) => {
          if (!globalThis.confirm(forgetConfirm)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="did" value={account.did} />
        <button
          type="submit"
          class="account-menu-forget-btn"
          aria-label={`${forgetLabel} @${account.handle}`}
          title={forgetLabel}
        >
          ×
        </button>
      </form>
    </div>
  );
}

interface AvatarProps {
  url: string | null;
  handle: string;
}

function Avatar({ url, handle }: AvatarProps) {
  const failed = useSignal(false);
  const initial = handle?.[0]?.toUpperCase() ?? "?";
  const showImage = !!url && !failed.value;
  return (
    <span class="account-menu-avatar" aria-hidden="true">
      {showImage
        ? (
          <img
            src={url!}
            alt=""
            loading="eager"
            decoding="async"
            onError={() => {
              failed.value = true;
            }}
          />
        )
        : <span class="account-menu-avatar-initial">{initial}</span>}
    </span>
  );
}
