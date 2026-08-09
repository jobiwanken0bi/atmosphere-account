import type { AppListing } from "./app-directory.ts";

type ManagedAppTarget = Pick<AppListing, "id" | "atstoreListingUri">;

/** Target the exact owner-controlled ATStore record; legacy apps remain DID-scoped. */
export function appManagementHref(
  app: ManagedAppTarget,
  ownerDid: string,
): string {
  return app.atstoreListingUri?.startsWith(`at://${ownerDid}/`)
    ? `/apps/manage?app=${encodeURIComponent(app.id)}`
    : "/apps/manage";
}
