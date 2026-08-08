import type { OAuthCapability } from "./oauth-scopes.ts";

interface MediaUpload {
  dataBase64?: string;
}

export interface AppProfileWritePayload {
  avatarUpload?: MediaUpload;
  bannerUpload?: MediaUpload;
  iconUpload?: MediaUpload;
  iconBwUpload?: MediaUpload;
  screenshotUploads?: MediaUpload[];
}

/**
 * App record writes always need the app capability. Blob permission is
 * additive and is requested only for a save that actually includes new image
 * bytes; retaining or removing an existing blob does not require an upload.
 */
export function appProfileWriteCapabilities(
  body: AppProfileWritePayload,
): OAuthCapability[] {
  const screenshotUploads = Array.isArray(body.screenshotUploads)
    ? body.screenshotUploads
    : [];
  const hasMediaUpload = !!(
    body.avatarUpload?.dataBase64 ||
    body.bannerUpload?.dataBase64 ||
    body.iconUpload?.dataBase64 ||
    body.iconBwUpload?.dataBase64 ||
    screenshotUploads.some((upload) => !!upload?.dataBase64)
  );
  return hasMediaUpload ? ["app", "media"] : ["app"];
}

export function userProfileWriteCapabilities(
  hasAvatarUpload: boolean,
): OAuthCapability[] {
  return hasAvatarUpload ? ["profile", "media"] : ["profile"];
}
