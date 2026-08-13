import type { State } from "../utils.ts";
import { buildAccountMenuProps } from "./account-menu-props.ts";

export const ACCOUNT_NAV_STATE_VERSION = "account-nav.v1";

export interface AccountNavStatePayload {
  version: typeof ACCOUNT_NAV_STATE_VERSION;
  account: {
    user: { did: string; handle: string } | null;
    hasManagedProfiles: boolean;
    avatarUrl: string | null;
    publicProfileHandle: string | null;
    accountHost: { displayName: string; endpoint: string } | null;
    rememberedAccounts: { did: string; handle: string }[];
  } | null;
}

type AccountNavRequestState = Pick<
  State,
  "user" | "accountType" | "accountHost" | "rememberedAccounts"
>;

/**
 * Staged JSON contract for eventually making public HTML completely
 * account-neutral. The global nav can hydrate this payload into
 * `#account-nav-slot`; the public directory owner/claim CTAs must move to the
 * same client-side state boundary before cookie-bearing requests can safely
 * share the anonymous HTML variant.
 */
export function accountNavStatePayload(
  state: AccountNavRequestState,
): AccountNavStatePayload {
  const props = buildAccountMenuProps(state);
  const hasAccountControl = Boolean(props.user) ||
    props.rememberedAccounts.length > 0;
  return {
    version: ACCOUNT_NAV_STATE_VERSION,
    account: hasAccountControl
      ? {
        user: props.user,
        hasManagedProfiles: props.hasManagedProfiles,
        avatarUrl: props.avatarUrl,
        publicProfileHandle: props.publicProfileHandle,
        accountHost: props.accountHost
          ? {
            displayName: props.accountHost.displayName,
            endpoint: props.accountHost.endpoint,
          }
          : null,
        rememberedAccounts: props.rememberedAccounts.map(({ did, handle }) => ({
          did,
          handle,
        })),
      }
      : null,
  };
}

export function accountNavStateResponse(
  request: Request,
  state: AccountNavRequestState,
): Response {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    return new Response(
      JSON.stringify({ error: "same_origin_required" }),
      { status: 403, headers: accountNavStateHeaders() },
    );
  }
  return new Response(JSON.stringify(accountNavStatePayload(state)), {
    headers: accountNavStateHeaders(),
  });
}

function accountNavStateHeaders(): Headers {
  return new Headers({
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    "cross-origin-resource-policy": "same-origin",
    "deno-cdn-cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    vary: "Cookie",
    "x-robots-tag": "noindex, nofollow",
  });
}
