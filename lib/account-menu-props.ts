/**
 * Tiny helper that assembles the props every signed-in `Nav account`
 * needs: the live user, a DID-versioned avatar URL (so the browser
 * doesn't reuse the previous account's portrait after switching),
 * the public profile handle for deep-linking, and the per-device
 * remembered-accounts list that powers the in-menu switcher.
 *
 * The avatar URL deliberately includes the DID as a query param —
 * `/api/me/avatar` resolves identity from the session cookie, so the
 * URL string would otherwise collide across accounts and the browser
 * would happily serve its `private, max-age=300` cache from the
 * previous user.
 */
import type { State } from "../utils.ts";
import type { AccountType } from "./account-types.ts";

interface AccountMenuProps {
  user: { did: string; handle: string } | null;
  accountType: AccountType | null;
  avatarUrl: string | null;
  publicProfileHandle: string | null;
  rememberedAccounts: { did: string; handle: string }[];
}

export function buildAccountMenuProps(
  state: Pick<State, "user" | "accountType" | "rememberedAccounts">,
  publicProfileHandle: string | null = null,
): AccountMenuProps {
  const user = state.user;
  return {
    user: user ? { did: user.did, handle: user.handle } : null,
    accountType: state.accountType ?? null,
    avatarUrl: user ? `/api/me/avatar?v=${encodeURIComponent(user.did)}` : null,
    publicProfileHandle,
    rememberedAccounts: state.rememberedAccounts ?? [],
  };
}
