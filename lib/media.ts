const BSKY_FEED_FULLSIZE_PREFIX = "https://cdn.bsky.app/img/feed_fullsize/";
const BSKY_FEED_THUMBNAIL_PREFIX = "https://cdn.bsky.app/img/feed_thumbnail/";
const BSKY_AVATAR_PREFIX = "https://cdn.bsky.app/img/avatar/";

export type AppImageContext = "icon" | "media";

export function appImageUrl(
  url: string | null | undefined,
  context: AppImageContext,
  maxWidth = context === "icon" ? 320 : 1200,
  fallbackUrl?: string | null,
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
  if (url.startsWith("/api/atproto/blob?")) {
    const parsed = new URL(url, "https://atmosphere.invalid");
    parsed.searchParams.set("w", String(maxWidth));
    if (fallbackUrl?.startsWith("/api/atproto/blob?")) {
      const fallback = new URL(fallbackUrl, "https://atmosphere.invalid");
      const fallbackDid = fallback.searchParams.get("did");
      const fallbackCid = fallback.searchParams.get("cid");
      if (fallbackDid && fallbackCid) {
        parsed.searchParams.set("fallbackDid", fallbackDid);
        parsed.searchParams.set("fallbackCid", fallbackCid);
      }
    }
    return `${parsed.pathname}${parsed.search}`;
  }
  return url;
}
