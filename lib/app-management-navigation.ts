import type { AppListing } from "./app-directory.ts";

type ManagedAppTarget = Pick<
  AppListing,
  "id" | "atstoreListingUri"
>;

/**
 * Direct owner-facing edits to shared ATStore listings name the exact app.
 * Legacy profiles still use the DID-scoped management route.
 */
export function appManagementHref(
  app: ManagedAppTarget,
  ownerDid: string,
): string {
  const ownedAtstorePrefix = `at://${ownerDid}/`;
  return app.atstoreListingUri?.startsWith(ownedAtstorePrefix)
    ? `/apps/manage?app=${encodeURIComponent(app.id)}`
    : "/apps/manage";
}
