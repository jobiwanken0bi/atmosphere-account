import type { ProfileRecord } from "./lexicons.ts";

export const ATSTORE_LISTING_NSID = "fyi.atstore.listing.detail";
export const ATSTORE_PROFILE_NSID = "fyi.atstore.profile";
export const ATSTORE_REVIEW_NSID = "fyi.atstore.listing.review";
export const ATSTORE_FAVORITE_NSID = "fyi.atstore.listing.favorite";
export const COMMUNITY_APP_PROFILE_NSID = "community.lexicon.app.profile";
export const COMMUNITY_APP_ENTRY_NSID = "community.lexicon.app.entry";
export const COMMUNITY_APP_LOCALIZATION_NSID =
  "community.lexicon.app.profileLocalization";
const ATSTORE_LISTING_URI_RE =
  /^at:\/\/[^/]+\/fyi\.atstore\.listing\.detail\/[A-Za-z0-9._~:-]+$/;

export const APP_DIRECTORY_COLLECTIONS = [
  ATSTORE_LISTING_NSID,
  ATSTORE_REVIEW_NSID,
  ATSTORE_FAVORITE_NSID,
  COMMUNITY_APP_PROFILE_NSID,
  COMMUNITY_APP_ENTRY_NSID,
] as const;

export type AppSourceType =
  | "atmosphere_profile"
  | "atstore_listing"
  | "atstore_review"
  | "atstore_favorite"
  | "community_profile"
  | "community_entry"
  | "community_localization";

export interface AppDirectoryLink {
  uri: string;
  label?: string;
  role?: string;
}

export interface AppDirectoryImage {
  url: string;
  alt?: string;
  purpose?: string;
  aspectRatio?: { width: number; height: number };
}

export interface AppListingDraft {
  sourceType: AppSourceType;
  sourceUri: string;
  collection: string;
  repoDid: string;
  rkey: string;
  cid: string;
  name?: string;
  description?: string;
  tagline?: string;
  status?: string;
  slug?: string;
  primaryUrl?: string;
  iconUrl?: string;
  heroUrl?: string;
  screenshotUrls: string[];
  links: AppDirectoryLink[];
  tags: string[];
  platforms: string[];
  categorySlugs: string[];
  lexiconsProduces: string[];
  lexiconsConsumes: string[];
  accountIndicators: Array<{ collection: string; rkey?: string }>;
  productDid?: string;
  profileDid?: string;
  legacyProfileDid?: string;
  atstoreListingUri?: string;
  communityProfileUri?: string;
  communityEntryUri?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface AppReviewDraft {
  sourceType: "atstore_review";
  uri: string;
  cid: string;
  repoDid: string;
  rkey: string;
  subject: string;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppFavoriteDraft {
  sourceType: "atstore_favorite";
  uri: string;
  cid: string;
  repoDid: string;
  rkey: string;
  subject: string;
  createdAt: number;
}

type BlobLike = {
  ref?: { $link?: string; link?: string };
  cid?: string;
  mimeType?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function str(value: unknown, max = 8192): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, max)
    : undefined;
}

function strArray(value: unknown, maxItems = 64, max = 512): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const s = str(item, max);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function strOneOrMany(value: unknown, maxItems = 64, max = 512): string[] {
  if (Array.isArray(value)) return strArray(value, maxItems, max);
  const item = str(value, max);
  return item ? [item] : [];
}

function timestamp(value: unknown): number | undefined {
  const s = str(value, 128);
  if (!s) return undefined;
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : undefined;
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrl(value: unknown): string | undefined {
  const s = str(value, 2048);
  return isHttpUrl(s) ? s : undefined;
}

function blobCid(blob: unknown): string | null {
  const b = asRecord(blob) as BlobLike | null;
  if (!b) return null;
  if (typeof b.cid === "string" && b.cid) return b.cid;
  const ref = b.ref;
  if (!ref || typeof ref !== "object") return null;
  return typeof ref.$link === "string" && ref.$link
    ? ref.$link
    : typeof ref.link === "string" && ref.link
    ? ref.link
    : null;
}

export function blobCdnUrl(blob: unknown, repoDid: string): string | null {
  const cid = blobCid(blob);
  if (!cid) return null;
  return `/api/atproto/blob?did=${encodeURIComponent(repoDid)}&cid=${
    encodeURIComponent(cid)
  }`;
}

function readLinks(value: unknown): AppDirectoryLink[] {
  if (!Array.isArray(value)) return [];
  const out: AppDirectoryLink[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const uri = normalizeUrl(row.uri) ?? normalizeUrl(row.url);
    if (!uri) continue;
    out.push({
      uri,
      label: str(row.label, 100),
      role: str(row.role ?? row.type, 128),
    });
  }
  return out.slice(0, 12);
}

function readCommunityImages(
  value: unknown,
  repoDid: string,
): AppDirectoryImage[] {
  if (!Array.isArray(value)) return [];
  const out: AppDirectoryImage[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const remote = normalizeUrl(row.uri);
    const local = row.image ? blobCdnUrl(row.image, repoDid) : null;
    if ((!remote && !local) || (remote && local)) continue;
    const url = remote ?? local ?? undefined;
    if (!url) continue;
    const aspect = asRecord(row.aspectRatio);
    const width = Number(aspect?.width);
    const height = Number(aspect?.height);
    out.push({
      url,
      alt: str(row.alt, 1000),
      purpose: str(row.purpose, 128),
      aspectRatio: Number.isFinite(width) && Number.isFinite(height) &&
          width > 0 && height > 0
        ? { width, height }
        : undefined,
    });
  }
  return out;
}

function imageForPurpose(images: AppDirectoryImage[], purpose: string) {
  return images.find((img) => img.purpose === purpose)?.url;
}

function screenshotsFromImages(images: AppDirectoryImage[]) {
  return images
    .filter((img) =>
      img.purpose === "community.lexicon.app.defs#purposeScreenshot"
    )
    .map((img) => img.url)
    .slice(0, 20);
}

function communityTokenSuffix(value: unknown, prefix: string): string | null {
  const raw = str(value, 128);
  if (!raw) return null;
  if (!raw.startsWith(prefix)) return raw;
  const suffix = raw.slice(prefix.length);
  return suffix || null;
}

function normalizeCommunityPlatform(value: unknown): string | null {
  const suffix = communityTokenSuffix(
    value,
    "community.lexicon.app.defs#platform",
  );
  if (!suffix) return null;
  const normalized = suffix.toLowerCase();
  if (normalized === "ios") return "ios";
  if (normalized === "macos") return "macos";
  return normalized;
}

function normalizeCommunityPlatforms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const platform = normalizeCommunityPlatform(item);
    if (!platform || seen.has(platform)) continue;
    seen.add(platform);
    out.push(platform);
    if (out.length >= 12) break;
  }
  return out;
}

function normalizeCommunityStatus(value: unknown): string | undefined {
  const suffix = communityTokenSuffix(
    value,
    "community.lexicon.app.defs#",
  );
  if (!suffix) return undefined;
  const status = suffix.toLowerCase();
  return [
      "unreleased",
      "preview",
      "released",
      "unmaintained",
      "discontinued",
    ].includes(status)
    ? status
    : undefined;
}

export function parseAtstoreListing(
  input: {
    uri: string;
    cid: string;
    repoDid: string;
    rkey: string;
    value: unknown;
  },
): AppListingDraft | null {
  const value = asRecord(input.value);
  if (!value) return null;
  const name = str(value.name, 640);
  const tagline = str(value.tagline, 300);
  const primaryUrl = normalizeUrl(value.externalUrl);
  const iconUrl = blobCdnUrl(value.icon, input.repoDid) ?? undefined;
  if (!name || !tagline || !primaryUrl || !iconUrl) return null;
  const screenshots = Array.isArray(value.screenshots)
    ? value.screenshots
      .map((blob) => blobCdnUrl(blob, input.repoDid))
      .filter((url): url is string => !!url)
    : [];
  return {
    sourceType: "atstore_listing",
    sourceUri: input.uri,
    collection: ATSTORE_LISTING_NSID,
    repoDid: input.repoDid,
    rkey: input.rkey,
    cid: input.cid,
    name,
    tagline,
    description: str(value.description, 20000),
    slug: str(value.slug, 512),
    primaryUrl,
    iconUrl,
    heroUrl: blobCdnUrl(value.heroImage, input.repoDid) ?? undefined,
    screenshotUrls: screenshots,
    links: readLinks(value.links),
    tags: strArray(value.appTags, 64, 96),
    platforms: [],
    categorySlugs: [
      ...strOneOrMany(value.categorySlug, 1, 256),
      ...strArray(value.categorySlugs, 32, 256),
    ],
    lexiconsProduces: [],
    lexiconsConsumes: [],
    accountIndicators: [],
    productDid: str(value.productAccountDid, 2048),
    atstoreListingUri: input.uri,
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt),
  };
}

export function parseAtstoreReview(
  input: {
    uri: string;
    cid: string;
    repoDid: string;
    rkey: string;
    value: unknown;
  },
): AppReviewDraft | null {
  const value = asRecord(input.value);
  if (!value) return null;
  const subject = str(value.subject, 8192);
  const rating = Number(value.rating);
  const createdAt = timestamp(value.createdAt) ?? Date.now();
  if (
    !subject || !ATSTORE_LISTING_URI_RE.test(subject) ||
    ![1, 2, 3, 4, 5].includes(rating)
  ) return null;
  return {
    sourceType: "atstore_review",
    uri: input.uri,
    cid: input.cid,
    repoDid: input.repoDid,
    rkey: input.rkey,
    subject,
    rating: rating as 1 | 2 | 3 | 4 | 5,
    body: str(value.text, 8000) ?? "",
    createdAt,
    updatedAt: createdAt,
  };
}

export function parseAtstoreFavorite(
  input: {
    uri: string;
    cid: string;
    repoDid: string;
    rkey: string;
    value: unknown;
  },
): AppFavoriteDraft | null {
  const value = asRecord(input.value);
  if (!value) return null;
  const subject = str(value.subject, 8192);
  if (!subject || !ATSTORE_LISTING_URI_RE.test(subject)) return null;
  return {
    sourceType: "atstore_favorite",
    uri: input.uri,
    cid: input.cid,
    repoDid: input.repoDid,
    rkey: input.rkey,
    subject,
    createdAt: timestamp(value.createdAt) ?? Date.now(),
  };
}

export function parseCommunityAppRecord(
  input: {
    uri: string;
    cid: string;
    repoDid: string;
    rkey: string;
    collection: string;
    value: unknown;
  },
): AppListingDraft | null {
  const value = asRecord(input.value);
  if (!value) return null;
  const isProfile = input.collection === COMMUNITY_APP_PROFILE_NSID;
  const isEntry = input.collection === COMMUNITY_APP_ENTRY_NSID;
  if (!isProfile && !isEntry) return null;
  const name = str(value.name, 200);
  const links = readLinks(value.links);
  const createdAt = timestamp(value.createdAt);
  if (!name || links.length === 0 || !createdAt) return null;
  const images = readCommunityImages(value.images, input.repoDid);
  const lex = asRecord(value.lexicons);
  const profileDid = isProfile ? input.repoDid : str(value.profileDid, 2048);
  return {
    sourceType: isProfile ? "community_profile" : "community_entry",
    sourceUri: input.uri,
    collection: input.collection,
    repoDid: input.repoDid,
    rkey: input.rkey,
    cid: input.cid,
    name,
    description: str(value.description, 3000),
    tagline: str(value.description, 3000),
    status: normalizeCommunityStatus(value.status),
    primaryUrl: links[0]?.uri,
    iconUrl: imageForPurpose(
      images,
      "community.lexicon.app.defs#purposeIcon",
    ) ?? imageForPurpose(images, "community.lexicon.app.defs#purposeLogo"),
    heroUrl: imageForPurpose(
      images,
      "community.lexicon.app.defs#purposeHero",
    ) ?? imageForPurpose(images, "community.lexicon.app.defs#purposeBanner"),
    screenshotUrls: screenshotsFromImages(images),
    links,
    tags: strArray(value.tags, 10, 64),
    platforms: normalizeCommunityPlatforms(value.platforms),
    categorySlugs: [],
    lexiconsProduces: strArray(lex?.produces, 64, 256),
    lexiconsConsumes: strArray(lex?.consumes, 64, 256),
    accountIndicators: Array.isArray(value.accountIndicators)
      ? value.accountIndicators.flatMap((item) => {
        const row = asRecord(item);
        const collection = str(row?.collection, 256);
        if (!collection) return [];
        const rkey = str(row?.rkey, 256);
        return [{ collection, ...(rkey ? { rkey } : {}) }];
      })
      : [],
    profileDid,
    productDid: profileDid,
    communityProfileUri: isProfile ? input.uri : undefined,
    communityEntryUri: isEntry ? input.uri : undefined,
    createdAt,
    updatedAt: timestamp(value.updatedAt),
  };
}

export function atmosphereProfileToDraft(input: {
  did: string;
  handle: string;
  uri: string;
  cid: string;
  record: ProfileRecord;
  iconUrl?: string;
  heroUrl?: string;
  screenshotUrls?: string[];
}): AppListingDraft {
  const links: AppDirectoryLink[] = [];
  if (input.record.mainLink) {
    links.push({
      uri: input.record.mainLink,
      label: "Website",
      role: "community.lexicon.app.defs#linkRoleWebsite",
    });
  }
  if (input.record.iosLink) {
    links.push({
      uri: input.record.iosLink,
      label: "App Store",
      role: "community.lexicon.app.defs#linkRoleAppStore",
    });
  }
  if (input.record.androidLink) {
    links.push({
      uri: input.record.androidLink,
      label: "Play Store",
      role: "community.lexicon.app.defs#linkRolePlayStore",
    });
  }
  for (const link of input.record.links ?? []) {
    if (!link.url) continue;
    links.push({ uri: link.url, label: link.label ?? link.kind });
  }
  return {
    sourceType: "atmosphere_profile",
    sourceUri: input.uri,
    collection: "com.atmosphereaccount.registry.profile",
    repoDid: input.did,
    rkey: "self",
    cid: input.cid,
    name: input.record.name,
    description: input.record.description,
    tagline: input.record.description,
    slug: input.handle,
    primaryUrl: input.record.mainLink ?? input.record.iosLink ??
      input.record.androidLink,
    iconUrl: input.iconUrl,
    heroUrl: input.heroUrl,
    screenshotUrls: input.screenshotUrls ?? [],
    links,
    tags: input.record.subcategories ?? [],
    platforms: [
      ...(input.record.mainLink ? ["web"] : []),
      ...(input.record.iosLink ? ["ios"] : []),
      ...(input.record.androidLink ? ["android"] : []),
    ],
    categorySlugs: input.record.categories ?? [],
    lexiconsProduces: input.record.lexicons?.produces ?? [],
    lexiconsConsumes: input.record.lexicons?.consumes ?? [],
    accountIndicators: input.record.accountIndicators ?? [],
    productDid: input.did,
    profileDid: input.did,
    legacyProfileDid: input.did,
    createdAt: timestamp(input.record.createdAt),
    updatedAt: timestamp(input.record.createdAt),
  };
}
