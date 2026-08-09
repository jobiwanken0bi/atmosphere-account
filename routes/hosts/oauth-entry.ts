/** Reuse a validated action-scoped sign-in URL at the add-account entry. */
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
