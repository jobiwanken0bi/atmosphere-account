import { oauthLoginUrl } from "./oauth-action.ts";

export const PASSKEY_OAUTH_ACTION = "passkey_manage" as const;
export const PASSKEY_OAUTH_CAPABILITIES = ["identity"] as const;

export function passkeyOAuthTargetName(handle: string): string | undefined {
  const normalized = handle.trim();
  return normalized && !normalized.startsWith("did:") ? normalized : undefined;
}

/**
 * Keep passkey verification recognizable through provider denial, retry, and
 * direct no-JS OAuth handoffs. A DID can be used to relink a discoverable
 * passkey, but it is not suitable as user-facing copy, so only handles are
 * forwarded as the optional display name.
 */
export function passkeyAuthorizationUrl(
  identifier: string,
  next: string,
  options: {
    continuation?: "login_selection";
    targetName?: string;
  } = {},
): string {
  const href = oauthLoginUrl({
    handle: identifier,
    next,
    action: PASSKEY_OAUTH_ACTION,
    capabilities: PASSKEY_OAUTH_CAPABILITIES,
    name: options.targetName ?? passkeyOAuthTargetName(identifier),
  });
  if (!options.continuation) return href;
  const url = new URL(href, "https://atmosphere.invalid");
  url.searchParams.set("continuation", options.continuation);
  return `${url.pathname}?${url.searchParams.toString()}`;
}
