import type { BlobRef } from "./lexicons.ts";

export interface MicroblogAccountProfile {
  displayName?: string;
  description?: string;
  avatar?: BlobRef;
}

export interface MicroblogAccountIdentity {
  displayName: string | null;
  bio: string | null;
  avatarCid: string | null;
  avatarMime: string | null;
}

/**
 * Convert the account's Bluesky profile into the local identity cache shape.
 * A missing profile deliberately produces nulls so callers clear any retired
 * Atmosphere-user-profile values instead of continuing to display them.
 */
export function microblogAccountIdentity(
  profile: MicroblogAccountProfile | null,
): MicroblogAccountIdentity {
  return {
    displayName: profile?.displayName?.trim() || null,
    bio: profile?.description == null ? null : profile.description.trim(),
    avatarCid: profile?.avatar?.ref.$link ?? null,
    avatarMime: profile?.avatar?.mimeType ?? null,
  };
}
