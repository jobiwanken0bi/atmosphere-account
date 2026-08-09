import { oauthSigninUrl, safeOAuthTargetName } from "./oauth-action.ts";

function requestPath(url: URL): string {
  return `${url.pathname}${url.search}`;
}

/** Identity-only picker used by developer-registration pages. */
export function developerAuthorizationHref(url: URL): string {
  return oauthSigninUrl({
    next: requestPath(url),
    action: "developer",
    capabilities: ["identity"],
  });
}

/** Identity-only picker used before either owner approves an app/host link.
 * Display names come from resolved directory records; opaque listing IDs are
 * never presented as authorization context. */
export function relationshipConfirmationAuthorizationHref(
  url: URL,
  target: { appName: string; hostName: string },
): string {
  const app = safeOAuthTargetName(target.appName);
  const host = safeOAuthTargetName(target.hostName);
  const name = app && host
    ? `${app} and ${host}`
    : app ?? host ?? "this app and account host";
  return oauthSigninUrl({
    next: requestPath(url),
    action: "relationship_confirm",
    capabilities: ["identity"],
    name,
  });
}

/** Identity-only picker for hidden admin routes. The server-side allowlist
 * remains authoritative after sign-in. */
export function adminAuthorizationHref(url: URL): string {
  return oauthSigninUrl({
    next: requestPath(url),
    action: "admin",
    capabilities: ["identity"],
  });
}
