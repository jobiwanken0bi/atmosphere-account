import type { OAuthCapability } from "./oauth-scopes.ts";
import { APP_MANAGEMENT_CAPABILITIES } from "./oauth-action.ts";

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
 * App profile management is one complete authorization job. It always
 * includes image blobs, even when a particular save contains only text, so a
 * later avatar, banner, icon, or screenshot edit does not trigger a second
 * predictable authorization prompt.
 */
export function appProfileWriteCapabilities(
  _body: AppProfileWritePayload,
): OAuthCapability[] {
  return [...APP_MANAGEMENT_CAPABILITIES];
}
