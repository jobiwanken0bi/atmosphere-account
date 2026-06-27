export interface AppCollectionDefinition {
  key: string;
  tag: string;
  label: string;
  icon: string;
  aliases: string[];
}

export const APP_COLLECTIONS: AppCollectionDefinition[] = [
  {
    key: "social",
    tag: "social",
    label: "Social",
    icon: "people",
    aliases: ["social", "clients", "bluesky client", "social networking"],
  },
  {
    key: "account-tool",
    tag: "account tool",
    label: "Account Tool",
    icon: "id-card",
    aliases: ["account tool", "account tools", "identity", "account"],
  },
  {
    key: "analytics",
    tag: "analytics",
    label: "Analytics",
    icon: "list",
    aliases: ["analytics", "data", "dashboards", "measurement"],
  },
  {
    key: "annotation",
    tag: "annotation",
    label: "Annotation",
    icon: "pen",
    aliases: ["annotation", "annotations", "annotate"],
  },
  {
    key: "art",
    tag: "art",
    label: "Art",
    icon: "gallery",
    aliases: ["art", "artist", "gallery"],
  },
  {
    key: "articles",
    tag: "articles",
    label: "Articles",
    icon: "reader",
    aliases: ["articles", "article", "reading", "reader"],
  },
  {
    key: "developer",
    tag: "developer",
    label: "Developer",
    icon: "code",
    aliases: [
      "developer",
      "developer tool",
      "developer tools",
      "development tools",
      "tools",
      "data-explorer",
      "experiments",
    ],
  },
  {
    key: "games",
    tag: "games",
    label: "Games",
    icon: "game",
    aliases: ["games", "gaming", "roleplaying"],
  },
  {
    key: "productivity",
    tag: "productivity",
    label: "Productivity",
    icon: "checklist",
    aliases: ["productivity", "automation"],
  },
  {
    key: "community",
    tag: "community",
    label: "Community",
    icon: "people",
    aliases: ["community", "communities"],
  },
  {
    key: "creative",
    tag: "creative",
    label: "Creative",
    icon: "gallery",
    aliases: ["creative", "creativity"],
  },
  {
    key: "creator-tool",
    tag: "creator tool",
    label: "Creator Tool",
    icon: "player",
    aliases: ["creator tool", "creator tools", "creator"],
  },
  {
    key: "design",
    tag: "design",
    label: "Design",
    icon: "gallery",
    aliases: ["design", "designer"],
  },
  {
    key: "events",
    tag: "events",
    label: "Events",
    icon: "calendar",
    aliases: ["events", "event"],
  },
  {
    key: "feed-generator",
    tag: "feed generator",
    label: "Feed Generator",
    icon: "feed",
    aliases: [
      "feed generator",
      "feed generators",
      "feeds",
      "feed",
      "algorithms",
      "algorithm",
    ],
  },
  {
    key: "fun",
    tag: "fun",
    label: "Fun",
    icon: "game",
    aliases: ["fun"],
  },
  {
    key: "work",
    tag: "work",
    label: "Work",
    icon: "briefcase",
    aliases: ["work", "conferencing", "groups"],
  },
  {
    key: "publishing",
    tag: "publishing",
    label: "Publishing",
    icon: "pen",
    aliases: [
      "publishing",
      "writing",
      "blogging",
      "blogs",
      "books",
      "news",
      "publications",
    ],
  },
  {
    key: "audio",
    tag: "audio",
    label: "Audio",
    icon: "wave",
    aliases: ["audio", "music"],
  },
  {
    key: "bookmarks",
    tag: "bookmarks",
    label: "Bookmarks",
    icon: "bookmark",
    aliases: ["bookmarks", "collections", "reading", "readers", "reader"],
  },
  {
    key: "labeler",
    tag: "labeler",
    label: "Labeler",
    icon: "list",
    aliases: ["labeler", "labelers", "labels"],
  },
  {
    key: "livestreaming",
    tag: "livestreaming",
    label: "Livestreaming",
    icon: "video",
    aliases: ["livestreaming", "live streaming", "streaming"],
  },
  {
    key: "location",
    tag: "location",
    label: "Location",
    icon: "follow",
    aliases: ["location", "maps", "map"],
  },
  {
    key: "marketplace",
    tag: "marketplace",
    label: "Marketplace",
    icon: "list",
    aliases: ["marketplace", "marketplaces"],
  },
  {
    key: "messaging",
    tag: "messaging",
    label: "Messaging",
    icon: "comment",
    aliases: ["messaging", "messages", "chat"],
  },
  {
    key: "moderation",
    tag: "moderation",
    label: "Moderation",
    icon: "list",
    aliases: ["moderation", "moderator", "moderators"],
  },
  {
    key: "personal-page",
    tag: "personal page",
    label: "Personal Page",
    icon: "id-card",
    aliases: ["personal page", "personal-page", "profile", "domains"],
  },
  {
    key: "reviews",
    tag: "reviews",
    label: "Reviews",
    icon: "review",
    aliases: ["reviews", "review", "ratings"],
  },
  {
    key: "science",
    tag: "science",
    label: "Science",
    icon: "list",
    aliases: ["science", "research"],
  },
  {
    key: "sports",
    tag: "sports",
    label: "Sports",
    icon: "player",
    aliases: ["sports", "sport"],
  },
  {
    key: "utility",
    tag: "utility",
    label: "Utility",
    icon: "checklist",
    aliases: ["utility", "utilities"],
  },
  {
    key: "photos",
    tag: "photos",
    label: "Photos",
    icon: "photo",
    aliases: ["photos", "photo", "images", "gallery"],
  },
  {
    key: "video",
    tag: "video",
    label: "Video",
    icon: "video",
    aliases: ["video", "videos", "media"],
  },
];

export function appCollectionForTag(
  tag: string | null | undefined,
): AppCollectionDefinition | null {
  const normalized = normalizeAppTag(normalizeAppCollectionSlug(tag));
  if (!normalized) return null;
  return APP_COLLECTIONS.find((collection) =>
    collection.aliases.some((alias) => normalizeAppTag(alias) === normalized) ||
    normalizeAppTag(collection.tag) === normalized
  ) ?? null;
}

export function appCollectionAliases(
  tag: string | null | undefined,
): string[] {
  const collection = appCollectionForTag(tag);
  if (!collection) {
    const normalized = normalizeAppTag(normalizeAppCollectionSlug(tag));
    return normalized ? [normalized] : [];
  }
  return uniqueNormalized([
    collection.tag,
    collection.label,
    collection.key,
    ...collection.aliases,
  ]);
}

export function appCollectionLabel(tag: string): string {
  const normalized = normalizeAppCollectionSlug(tag) ?? tag;
  return appCollectionForTag(normalized)?.label ?? toTitleCase(normalized);
}

export function appCollectionKey(tag: string): string {
  const normalized = normalizeAppCollectionSlug(tag) ?? tag;
  return appCollectionForTag(normalized)?.key ?? slugifyTag(normalized);
}

export function appCollectionHref(
  tag: string,
  basePath = "/apps/all",
): string {
  const params = new URLSearchParams();
  params.set("tag", appCollectionForTag(tag)?.tag ?? tag);
  params.set("sort", "trending");
  return `${basePath}?${params.toString()}`;
}

export function normalizeAppTag(
  tag: string | null | undefined,
): string | null {
  const value = tag?.trim().toLowerCase();
  if (!value) return null;
  return value.replaceAll(/[\s_-]+/g, " ");
}

export function normalizeAppCollectionSlug(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^apps?\//, "")
    .replaceAll("/", " ")
    .replaceAll(/[\s_-]+/g, " ");
}

function uniqueNormalized(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeAppTag(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function slugifyTag(tag: string): string {
  return tag.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(
    /^-+|-+$/g,
    "",
  ) || "collection";
}

function toTitleCase(tag: string): string {
  return tag
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
