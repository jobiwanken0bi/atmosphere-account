import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useT } from "../i18n/mod.ts";

interface Props {
  /** null when signed out — drives whether the menu shows sign-in or
   *  sign-out + manage actions. */
  user: { did: string; handle: string } | null;
  /**
   * Server-resolved avatar URL (typically /api/me/avatar). Falls back
   * to a handle-initial pill if the image 404s or fails to load.
   */
  avatarUrl?: string | null;
  /**
   * If we already know the user has a registry profile, link to the
   * public profile page from the menu so they can preview what others
   * see. Otherwise we just show "Manage profile".
   */
  publicProfileHandle?: string | null;
}

export default function AccountMenu(
  { user, avatarUrl, publicProfileHandle }: Props,
) {
  const t = useT().nav.account;

  /** Signed out: a plain text link in the same slot the dropdown
   *  occupies when authenticated. No glass pill — that styling is
   *  reserved for the Explore CTA above and the avatar trigger that
   *  appears post-sign-in. */
  if (!user) {
    return (
      <a
        href="/explore/create"
        class="nav-btn nav-btn-ghost account-menu-signin"
      >
        {t.signIn}
      </a>
    );
  }

  return <SignedInMenu
    user={user}
    avatarUrl={avatarUrl ?? null}
    publicProfileHandle={publicProfileHandle ?? null}
  />;
}

interface SignedInMenuProps {
  user: { did: string; handle: string };
  avatarUrl: string | null;
  publicProfileHandle: string | null;
}

function SignedInMenu(
  { user, avatarUrl, publicProfileHandle }: SignedInMenuProps,
) {
  const t = useT().nav.account;
  const open = useSignal(false);
  const avatarFailed = useSignal(false);

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

  /** First letter of the handle for the fallback avatar. For DIDs
   *  (e.g. "did:plc:abc") fall back to "?". */
  const initial = user.handle?.[0]?.toUpperCase() ?? "?";
  const showImage = !!avatarUrl && !avatarFailed.value;

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
        <span class="account-menu-avatar" aria-hidden="true">
          {showImage
            ? (
              <img
                src={avatarUrl!}
                alt=""
                loading="eager"
                decoding="async"
                onError={() => {
                  avatarFailed.value = true;
                }}
              />
            )
            : <span class="account-menu-avatar-initial">{initial}</span>}
        </span>
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
            href="/explore/manage"
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
        </div>
      )}
    </div>
  );
}
