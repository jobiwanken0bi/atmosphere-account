export type AppListingWriteTarget = "atstore_listing" | "legacy_profile";

export function resolveAppListingWriteTarget(input: {
  hasLegacyProfile: boolean;
  hasAtstoreListing?: boolean;
  categories: readonly string[] | undefined;
}): AppListingWriteTarget {
  if (!input.categories?.includes("app")) return "legacy_profile";
  if (input.hasAtstoreListing) return "atstore_listing";
  return !input.hasLegacyProfile ? "atstore_listing" : "legacy_profile";
}
