// This route is keyed by DID rather than immutable CID. Keep the public window
// short so an access revocation or moderation decision takes effect promptly.
const PUBLIC_ICON_CACHE = "public, max-age=60, s-maxage=60, must-revalidate";
const OWNER_PREVIEW_CACHE = "private, max-age=60";

/** Owner previews bypass the public visibility gate, so they must never become
 * shared-cacheable unless the exact same icon is currently public. */
export function iconProxyCacheControl(
  accessStatus: string | null | undefined,
  iconStatus: string | null | undefined,
): string {
  return accessStatus === "granted" && iconStatus === "approved"
    ? PUBLIC_ICON_CACHE
    : OWNER_PREVIEW_CACHE;
}
