/**
 * Reuse an action-scoped `/signin` URL at the account-replacement entry point.
 * The original builder has already validated the action/capability bundle; only
 * the route that opens the another-account chooser changes here.
 */
export function oauthAddAccountHref(authorizationHref: string): string {
  const base = new URL("https://atmosphereaccount.invalid");
  const authorization = new URL(authorizationHref, base);
  if (
    authorization.origin !== base.origin || authorization.pathname !== "/signin"
  ) {
    throw new TypeError("Expected a local /signin authorization URL");
  }
  authorization.pathname = "/oauth/add-account";
  return `${authorization.pathname}${authorization.search}`;
}
