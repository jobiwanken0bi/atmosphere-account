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
 * Display names come from the resolved directory records; the `app` query
 * parameter is an opaque listing ID and must never be presented as a name. */
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

/** Identity-only picker for a hidden admin route. The allowlist check remains
 * server-side and still returns 404 after an unauthorized identity signs in. */
export function adminAuthorizationHref(url: URL): string {
  return oauthSigninUrl({
    next: requestPath(url),
    action: "admin",
    capabilities: ["identity"],
  });
}
