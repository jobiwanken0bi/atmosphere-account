const BSKY_FEED_FULLSIZE_PREFIX = "https://cdn.bsky.app/img/feed_fullsize/";
const BSKY_FEED_THUMBNAIL_PREFIX = "https://cdn.bsky.app/img/feed_thumbnail/";
const BSKY_AVATAR_PREFIX = "https://cdn.bsky.app/img/avatar/";

export type AppImageContext = "icon" | "media";

export function appImageUrl(
  url: string | null | undefined,
  context: AppImageContext,
): string | null {
  if (!url) return null;
  if (context === "icon" && url.startsWith(BSKY_FEED_FULLSIZE_PREFIX)) {
    return `${BSKY_AVATAR_PREFIX}${
      url.slice(BSKY_FEED_FULLSIZE_PREFIX.length).replace(/@[a-z0-9]+$/i, "")
    }`;
  }
  if (context === "media" && url.startsWith(BSKY_FEED_FULLSIZE_PREFIX)) {
    return `${BSKY_FEED_THUMBNAIL_PREFIX}${
      url.slice(BSKY_FEED_FULLSIZE_PREFIX.length)
    }`;
  }
  return url;
}
