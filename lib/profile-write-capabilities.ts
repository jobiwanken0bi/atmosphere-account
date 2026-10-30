import type { OAuthCapability } from "./oauth-scopes.ts";

export type AppProfileWritePayload = object;

/**
 * App management is one understandable permission: it covers the app records
 * and their images. Keeping this helper at the API/UI boundary makes that
 * invariant explicit while preserving the existing recovery call sites.
 */
export function appProfileWriteCapabilities(
  _body: AppProfileWritePayload,
): OAuthCapability[] {
  return ["app"];
}

export function userProfileWriteCapabilities(
  hasAvatarUpload: boolean,
): OAuthCapability[] {
  return hasAvatarUpload ? ["profile", "media"] : ["profile"];
}
