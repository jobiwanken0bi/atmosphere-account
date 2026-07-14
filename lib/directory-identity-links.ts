import type { AccountHost } from "./account-hosts.ts";
import type { AppListing } from "./app-directory.ts";

type AppIdentity = Pick<
  AppListing,
  | "slug"
  | "productDid"
  | "profileDid"
  | "legacyProfileDid"
  | "accountHost"
>;

type HostIdentity = Pick<AccountHost, "host" | "profileDid">;

export function hostHrefForApp(
  app: Pick<AppListing, "accountHost">,
): string | null {
  const host = app.accountHost?.trim().toLowerCase();
  return host ? `/hosts/${encodeURIComponent(host)}` : null;
}

export function appHrefForHost(
  host: HostIdentity,
  app: AppIdentity | null,
): string | null {
  if (!app || !host.profileDid) return null;
  const hostDid = host.profileDid.trim();
  const accountHost = app.accountHost?.trim().toLowerCase();
  const accountDids = [
    app.productDid,
    app.profileDid,
    app.legacyProfileDid,
  ];
  if (
    !hostDid || accountHost !== host.host.trim().toLowerCase() ||
    !accountDids.includes(hostDid)
  ) {
    return null;
  }
  return `/apps/${encodeURIComponent(app.slug)}`;
}
