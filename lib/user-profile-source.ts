import type { AppUserRow } from "./account-types.ts";
import type { ProfileRow } from "./registry.ts";

export interface EffectiveUserProfile {
  displayName: string;
  bio: string;
  avatarCid: string | null;
  avatarMime: string | null;
  websiteUrl: string | null;
  hasAtmosphereProfile: boolean;
}

/**
 * Resolve the account identity shown by Atmosphere surfaces.
 *
 * A published Atmosphere user profile is authoritative. The app-user row is
 * initially populated from the account's microblog profile and remains the
 * fallback until the user saves an Atmosphere profile of their own.
 */
export function effectiveUserProfile(input: {
  handle: string;
  appUser: AppUserRow | null;
  atmosphereProfile: ProfileRow | null;
}): EffectiveUserProfile {
  const { handle, appUser, atmosphereProfile } = input;
  return {
    displayName: atmosphereProfile?.name?.trim() ||
      appUser?.displayName?.trim() || handle,
    bio: atmosphereProfile?.description ?? appUser?.bio ?? "",
    avatarCid: atmosphereProfile
      ? atmosphereProfile.avatarCid
      : appUser?.avatarCid ?? null,
    avatarMime: atmosphereProfile
      ? atmosphereProfile.avatarMime
      : appUser?.avatarMime ?? null,
    websiteUrl: atmosphereProfile
      ? atmosphereProfile.mainLink
      : appUser?.websiteUrl ?? null,
    hasAtmosphereProfile: atmosphereProfile !== null,
  };
}
