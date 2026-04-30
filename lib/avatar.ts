/**
 * Bluesky's public CDN is a cached proxy for repo blob avatars. Any profile
 * avatar stored as a did/cid pair can use this directly and avoid our app
 * server's PDS blob proxy on hot UI paths.
 */
export function bskyCdnAvatarUrl(did: string, cid: string): string {
  return `https://cdn.bsky.app/img/avatar/plain/${did}/${cid}`;
}

/**
 * Same proxy, banner variant. Bluesky exposes a separate path with
 * banner-friendly resizing (16:9-ish, larger). Rendered at the top of
 * project pages and used as the OpenGraph / Twitter card image when
 * the page URL is shared.
 */
export function bskyCdnBannerUrl(
  did: string,
  cid: string,
  mime = "jpeg",
): string {
  const fmt = mime === "image/png" ? "png" : "jpeg";
  return `https://cdn.bsky.app/img/banner/plain/${did}/${cid}@${fmt}`;
}

/**
 * Returns true when a PDS URL belongs to Bluesky's own infrastructure
 * (bsky.social or *.bsky.network). Banners on Bluesky-hosted accounts can be
 * served straight from cdn.bsky.app, which is on Bluesky's own domain
 * allowlist for link-preview images. Custom-PDS banners must go through our
 * own proxy instead.
 */
export function isBlueskyPds(pdsUrl: string | null | undefined): boolean {
  if (!pdsUrl) return false;
  try {
    const host = new URL(pdsUrl).hostname;
    return host === "bsky.social" || host.endsWith(".bsky.network");
  } catch {
    return false;
  }
}
