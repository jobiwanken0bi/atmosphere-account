import { oauthSigninUrl } from "./oauth-action.ts";

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
