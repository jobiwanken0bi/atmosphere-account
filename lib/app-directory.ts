import type { InValue } from "@libsql/client";
import { isPostgresBackend, withDb } from "./db.ts";
import {
  type AppDirectoryLink,
  type AppFavoriteDraft,
  type AppListingDraft,
  type AppReviewDraft,
  atmosphereProfileToDraft,
} from "./app-lexicons.ts";
import {
  APP_COLLECTIONS,
  appCollectionAliases,
  normalizeAppCollectionSlug,
  normalizeAppTag,
} from "./app-collections.ts";
import {
  bayesianAverageRating,
  blendRatingSignals,
  combineTrendingScore,
  daysToMs,
  decayedBayesianRating,
  favoriteVelocitySignal,
  mentionVolumeSignal,
  ratingSignalFromAverage,
  sumDecayedWeights,
  trendingDecayWindowDays,
  trendingFavoriteHalfLifeDays,
  trendingFavoriteVelocityBaselineDays,
  trendingFavoriteVelocityPrior,
  trendingFavoriteVelocityRecentDays,
  trendingFavoriteVelocitySquashK,
  trendingMentionHalfLifeDays,
  trendingRatingRecentBlendWeight,
  trendingRatingRecentHalfLifeDays,
} from "./app-trending.ts";
import type { ProfileRow } from "./registry.ts";
import { searchProfiles } from "./registry.ts";

export type AppDirectorySort = "trending" | "newest" | "az";
export type AppReviewSort = "newest" | "highest" | "lowest";

export interface AppListingSourceRefs {
  atmosphere?: string;
  atstore?: string;
  communityProfile?: string;
  communityEntry?: string;
}

export interface AppListing {
  id: string;
  slug: string;
  name: string;
  description: string;
  tagline: string;
  appStatus: string | null;
  primaryUrl: string | null;
  iconUrl: string | null;
  heroUrl: string | null;
  screenshotUrls: string[];
  links: AppDirectoryLink[];
  tags: string[];
  platforms: string[];
  categorySlugs: string[];
  lexicons: { produces: string[]; consumes: string[] };
  accountIndicators: Array<{ collection: string; rkey?: string }>;
  sourceRefs: AppListingSourceRefs;
  canonicalSource: string;
  canonicalUri: string;
  productDid: string | null;
  profileDid: string | null;
  legacyProfileDid: string | null;
  accountHost: string | null;
  atstoreListingUri: string | null;
  communityProfileUri: string | null;
  communityEntryUri: string | null;
  reviewCount: number;
  averageRating: number | null;
  favoriteCount: number;
  mentionCount24h: number;
  mentionCount7d: number;
  trendingScore: number | null;
  publishedAt: number | null;
  updatedAt: number;
  indexedAt: number;
}

export interface AppTagSummary {
  tag: string;
  count: number;
}

export interface AppSearchResult {
  apps: AppListing[];
  featured: AppListing[];
  trending: AppListing[];
  fresh: AppListing[];
  total: number;
  page: number;
  pageSize: number;
  tags: string[];
  tagSummaries: AppTagSummary[];
}

export interface AppMirroredReview {
  uri: string;
  listingUri: string;
  listingId: string | null;
  authorDid: string;
  rating: number;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppOwnReview {
  uri: string;
  rkey: string;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppOwnFavorite {
  uri: string;
  rkey: string;
  createdAt: number;
}

export interface AppAliasRow {
  aliasKey: string;
  sourceUri: string;
  createdAt: number;
}

interface RawAppListingRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  tagline: string;
  app_status: string | null;
  primary_url: string | null;
  icon_url: string | null;
  hero_url: string | null;
  screenshot_urls: string;
  links_json: string;
  tags_json: string;
  platforms_json: string;
  category_slugs_json: string;
  lexicons_json: string;
  account_indicators_json: string;
  source_refs_json: string;
  canonical_source: string;
  canonical_uri: string;
  product_did: string | null;
  profile_did: string | null;
  legacy_profile_did: string | null;
  account_host: string | null;
  atstore_listing_uri: string | null;
  community_profile_uri: string | null;
  community_entry_uri: string | null;
  review_count: number;
  average_rating: number | null;
  favorite_count: number;
  mention_count_24h: number;
  mention_count_7d: number;
  trending_score: number | null;
  published_at: number | null;
  updated_at: number;
  indexed_at: number;
}

const SOURCE_RANK: Record<string, number> = {
  atstore_listing: 0,
  community_profile: 1,
  community_entry: 2,
  atmosphere_profile: 3,
};

const FEATURED_SECTION_SIZE = 3;
const FEATURED_CANDIDATE_LIMIT = 18;
const FEATURED_ROTATION_MS = 1000 * 60 * 60 * 12;
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 80;
const TAG_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;

const searchCache = new Map<
  string,
  { expiresAt: number; result: AppSearchResult }
>();

let tagSummaryCache:
  | {
    expiresAt: number;
    tags: string[];
    tagSummaries: AppSearchResult["tagSummaries"];
  }
  | null = null;

export function clearAppDirectorySearchCache(): void {
  searchCache.clear();
  tagSummaryCache = null;
}

function trimSearchQuery(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeSearchTags(value: string | string[] | undefined): string[] {
  const tags = Array.isArray(value) ? value : value ? [value] : [];
  return uniqueStrings(tags.map((tag) => tag.trim().toLowerCase())).sort();
}

function searchCacheKey(input: {
  query?: string;
  tag?: string | string[];
  sort: AppDirectorySort;
  page: number;
  pageSize: number;
  includeSections: boolean;
  includeApps: boolean;
  includeTags: boolean;
  includeTotal: boolean;
}): string {
  return JSON.stringify({
    q: trimSearchQuery(input.query),
    tag: normalizeSearchTags(input.tag),
    sort: input.sort,
    page: input.page,
    pageSize: input.pageSize,
    sections: input.includeSections,
    apps: input.includeApps,
    tags: input.includeTags,
    total: input.includeTotal,
  });
}

function cachedSearchResult(key: string, now = Date.now()) {
  const cached = searchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= now) {
    searchCache.delete(key);
    return null;
  }
  return cached.result;
}

function rememberSearchResult(
  key: string,
  result: AppSearchResult,
  now = Date.now(),
): AppSearchResult {
  if (searchCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) searchCache.delete(oldestKey);
  }
  searchCache.set(key, { expiresAt: now + SEARCH_CACHE_TTL_MS, result });
  return result;
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function uniqueStrings(values: Iterable<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = value?.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const DID_RE = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;

function didAlias(value: string | undefined | null): string | null {
  const did = value?.trim();
  return did && DID_RE.test(did) ? did : null;
}

function canonicalUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function urlAlias(value: string | undefined | null): string | null {
  const url = canonicalUrl(value);
  return url ? `url:${url}` : null;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replaceAll(/[^a-z0-9.]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "app";
}

function sourceRank(draft: AppListingDraft): number {
  return SOURCE_RANK[draft.sourceType] ?? 99;
}

function isLocalDevListingDraft(draft: AppListingDraft): boolean {
  return draft.repoDid.startsWith("did:plc:localdev") ||
    draft.sourceUri.includes("did:plc:localdev") ||
    (draft.productDid?.startsWith("did:plc:localdev") ?? false) ||
    (draft.profileDid?.startsWith("did:plc:localdev") ?? false);
}

export function compareAppListingDraftPrecedence(
  a: AppListingDraft,
  b: AppListingDraft,
): number {
  const aLocal = isLocalDevListingDraft(a);
  const bLocal = isLocalDevListingDraft(b);
  if (aLocal !== bLocal) return aLocal ? 1 : -1;

  const sourceDiff = sourceRank(a) - sourceRank(b);
  if (sourceDiff !== 0) return sourceDiff;

  const updatedDiff = (b.updatedAt ?? b.createdAt ?? 0) -
    (a.updatedAt ?? a.createdAt ?? 0);
  if (updatedDiff !== 0) return updatedDiff;

  return a.sourceUri.localeCompare(b.sourceUri);
}

function displaySlug(draft: AppListingDraft): string {
  return slugify(
    draft.slug ?? draft.name ?? draft.productDid ?? draft.profileDid ??
      draft.sourceUri,
  );
}

function atUri(repoDid: string, collection: string, rkey: string): string {
  return `at://${repoDid}/${collection}/${rkey}`;
}

export function aliasesForDraft(draft: AppListingDraft): string[] {
  const aliases = [
    `uri:${draft.sourceUri}`,
    didAlias(draft.productDid),
    didAlias(draft.profileDid),
    didAlias(draft.legacyProfileDid),
    draft.legacyProfileDid ? `legacy:${draft.legacyProfileDid}` : null,
    urlAlias(draft.primaryUrl),
    draft.atstoreListingUri ? `atstore:${draft.atstoreListingUri}` : null,
    draft.communityProfileUri ? `community:${draft.communityProfileUri}` : null,
    draft.communityEntryUri ? `community:${draft.communityEntryUri}` : null,
  ];
  return uniqueStrings(aliases);
}

function rowToAppListing(input: unknown): AppListing {
  const row = input as RawAppListingRow;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    tagline: row.tagline,
    appStatus: row.app_status,
    primaryUrl: row.primary_url,
    iconUrl: row.icon_url,
    heroUrl: row.hero_url,
    screenshotUrls: safeJson<string[]>(row.screenshot_urls, []),
    links: safeJson<AppDirectoryLink[]>(row.links_json, []),
    tags: safeJson<string[]>(row.tags_json, []),
    platforms: safeJson<string[]>(row.platforms_json, []),
    categorySlugs: safeJson<string[]>(row.category_slugs_json, []),
    lexicons: safeJson<{ produces: string[]; consumes: string[] }>(
      row.lexicons_json,
      { produces: [], consumes: [] },
    ),
    accountIndicators: safeJson<Array<{ collection: string; rkey?: string }>>(
      row.account_indicators_json,
      [],
    ),
    sourceRefs: safeJson<AppListingSourceRefs>(row.source_refs_json, {}),
    canonicalSource: row.canonical_source,
    canonicalUri: row.canonical_uri,
    productDid: row.product_did,
    profileDid: row.profile_did,
    legacyProfileDid: row.legacy_profile_did,
    accountHost: row.account_host,
    atstoreListingUri: row.atstore_listing_uri,
    communityProfileUri: row.community_profile_uri,
    communityEntryUri: row.community_entry_uri,
    reviewCount: Number(row.review_count ?? 0),
    averageRating: row.average_rating == null
      ? null
      : Number(row.average_rating),
    favoriteCount: Number(row.favorite_count ?? 0),
    mentionCount24h: Number(row.mention_count_24h ?? 0),
    mentionCount7d: Number(row.mention_count_7d ?? 0),
    trendingScore: row.trending_score == null
      ? null
      : Number(row.trending_score),
    publishedAt: row.published_at == null ? null : Number(row.published_at),
    updatedAt: Number(row.updated_at),
    indexedAt: Number(row.indexed_at),
  };
}

export function mergeAppListingDrafts(drafts: AppListingDraft[]) {
  const nonLocalDrafts = drafts.filter((draft) =>
    !isLocalDevListingDraft(draft)
  );
  const sourceDrafts = nonLocalDrafts.length > 0 ? nonLocalDrafts : drafts;
  const sorted = [...sourceDrafts].sort(compareAppListingDraftPrecedence);
  const allSorted = [...drafts].sort(compareAppListingDraftPrecedence);
  const canonical = sorted[0]!;
  const atstoreDrafts = sorted.filter((draft) =>
    draft.sourceType === "atstore_listing"
  );
  const contentDrafts = atstoreDrafts.length > 0 ? atstoreDrafts : sorted;
  const first = <K extends keyof AppListingDraft>(key: K) =>
    contentDrafts.find((draft) => draft[key] != null && draft[key] !== "")
      ?.[key];
  const identityFirst = <K extends keyof AppListingDraft>(key: K) =>
    sorted.find((draft) => draft[key] != null && draft[key] !== "")?.[key];
  const publishedAt = Math.min(
    ...contentDrafts.map((draft) => draft.createdAt ?? Date.now()),
  );
  const updatedAt = Math.max(
    ...contentDrafts.map((draft) =>
      draft.updatedAt ?? draft.createdAt ?? Date.now()
    ),
  );
  const sourceRefs: AppListingSourceRefs = {};
  for (const draft of sorted) {
    if (draft.sourceType === "atmosphere_profile") {
      sourceRefs.atmosphere ??= draft.sourceUri;
    } else if (draft.sourceType === "atstore_listing") {
      sourceRefs.atstore ??= draft.sourceUri;
    } else if (draft.sourceType === "community_profile") {
      sourceRefs.communityProfile ??= draft.sourceUri;
    } else if (draft.sourceType === "community_entry") {
      sourceRefs.communityEntry ??= draft.sourceUri;
    }
  }
  return {
    slug: displaySlug(canonical),
    name: String(first("name") ?? "Untitled app"),
    description: String(first("description") ?? first("tagline") ?? ""),
    tagline: String(first("tagline") ?? first("description") ?? ""),
    appStatus: first("status") as string | undefined,
    primaryUrl: first("primaryUrl") as string | undefined,
    iconUrl: first("iconUrl") as string | undefined,
    heroUrl: first("heroUrl") as string | undefined,
    screenshotUrls: uniqueStrings(
      contentDrafts.flatMap((draft) => draft.screenshotUrls),
    ),
    links: mergedListingLinks(contentDrafts, allSorted),
    tags: uniqueStrings(contentDrafts.flatMap((draft) => draft.tags)).slice(
      0,
      16,
    ),
    platforms: uniqueStrings(
      contentDrafts.flatMap((draft) => draft.platforms),
    ),
    categorySlugs: uniqueStrings(
      contentDrafts.flatMap((draft) => draft.categorySlugs),
    ),
    lexicons: {
      produces: uniqueStrings(
        contentDrafts.flatMap((draft) => draft.lexiconsProduces),
      ),
      consumes: uniqueStrings(
        contentDrafts.flatMap((draft) => draft.lexiconsConsumes),
      ),
    },
    accountIndicators: dedupeIndicators(
      contentDrafts.flatMap((draft) => draft.accountIndicators),
    ),
    sourceRefs,
    canonicalSource: canonical.sourceType,
    canonicalUri: canonical.sourceUri,
    productDid: first("productDid") as string | undefined,
    profileDid: identityFirst("profileDid") as string | undefined,
    legacyProfileDid: identityFirst("legacyProfileDid") as string | undefined,
    atstoreListingUri: first("atstoreListingUri") as string | undefined,
    communityProfileUri: first("communityProfileUri") as string | undefined,
    communityEntryUri: first("communityEntryUri") as string | undefined,
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function mergedListingLinks(
  contentDrafts: AppListingDraft[],
  sortedDrafts: AppListingDraft[],
): AppDirectoryLink[] {
  const contentSet = new Set(contentDrafts);
  const supplementalLinks = sortedDrafts
    .filter((draft) => !contentSet.has(draft))
    .flatMap((draft) => draft.links)
    .filter(isLegacySupplementalAppLink);
  return dedupeLinks([
    ...contentDrafts.flatMap((draft) => draft.links),
    ...supplementalLinks,
  ]);
}

function isLegacySupplementalAppLink(link: AppDirectoryLink): boolean {
  const url = canonicalUrl(link.uri);
  if (!url) return false;
  const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  // Legacy profiles are only additive for links whose destination proves what
  // they are. Labels and roles are user-controlled and must not turn an
  // arbitrary URL into an App Store, Play Store, or Tangled action on an
  // otherwise authoritative ATStore listing.
  return host === "apps.apple.com" || host === "itunes.apple.com" ||
    host === "play.google.com" ||
    host === "tangled.org" || host.endsWith(".tangled.org") ||
    host === "tangled.sh" || host.endsWith(".tangled.sh");
}

function dedupeLinks(links: AppDirectoryLink[]) {
  const seen = new Set<string>();
  const out: AppDirectoryLink[] = [];
  for (const link of links) {
    const url = canonicalUrl(link.uri) ?? link.uri;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(link);
  }
  return out.slice(0, 16);
}

function dedupeIndicators(
  indicators: Array<{ collection: string; rkey?: string }>,
) {
  const seen = new Set<string>();
  const out: Array<{ collection: string; rkey?: string }> = [];
  for (const item of indicators) {
    const key = `${item.collection}/${item.rkey ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function ensureUniqueSlug(
  execute: (
    args: { sql: string; args: InValue[] },
  ) => Promise<{ rows: unknown[] }>,
  base: string,
  listingId: string,
): Promise<string> {
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const res = await execute({
      sql: `SELECT id FROM app_listing WHERE slug = ? AND id <> ? LIMIT 1`,
      args: [slug, listingId],
    });
    if (res.rows.length === 0) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${listingId.slice(0, 8)}`;
}

export async function upsertAppRecordFromDraft(input: {
  draft: AppListingDraft;
  rawRecord: unknown;
}): Promise<string> {
  const now = Date.now();
  try {
    return await withDb(async (c) => {
      const aliases = aliasesForDraft(input.draft);
      const existing = aliases.length > 0
        ? await c.execute({
          sql: `SELECT listing_id FROM app_alias WHERE alias_key IN (${
            aliases.map(() => "?").join(",")
          })`,
          args: aliases,
        })
        : { rows: [] };
      const listingIds = uniqueStrings(
        existing.rows.map((row) =>
          String((row as Record<string, unknown>).listing_id ?? "")
        ),
      );
      const listingId = listingIds[0] ?? crypto.randomUUID();
      for (const duplicateId of listingIds.slice(1)) {
        await mergeDuplicateListing(c, listingId, duplicateId, now);
      }
      await c.execute({
        sql: `
          INSERT INTO app_record (
            uri, cid, collection, source_type, repo_did, rkey, listing_id,
            raw_json, parsed_json, record_created_at, record_updated_at,
            indexed_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(uri) DO UPDATE SET
            cid=excluded.cid,
            collection=excluded.collection,
            source_type=excluded.source_type,
            repo_did=excluded.repo_did,
            rkey=excluded.rkey,
            listing_id=excluded.listing_id,
            raw_json=excluded.raw_json,
            parsed_json=excluded.parsed_json,
            record_created_at=excluded.record_created_at,
            record_updated_at=excluded.record_updated_at,
            indexed_at=excluded.indexed_at,
            deleted_at=NULL
        `,
        args: [
          input.draft.sourceUri,
          input.draft.cid,
          input.draft.collection,
          input.draft.sourceType,
          input.draft.repoDid,
          input.draft.rkey,
          listingId,
          JSON.stringify(input.rawRecord),
          JSON.stringify(input.draft),
          input.draft.createdAt ?? null,
          input.draft.updatedAt ?? null,
          now,
        ],
      });
      await recomputeListing(c, listingId);
      for (const alias of aliases) {
        await c.execute({
          sql: `
            INSERT INTO app_alias (alias_key, listing_id, source_uri, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(alias_key) DO UPDATE SET
              listing_id=excluded.listing_id,
              source_uri=excluded.source_uri
          `,
          args: [alias, listingId, input.draft.sourceUri, now],
        });
      }
      return listingId;
    });
  } finally {
    clearAppDirectorySearchCache();
  }
}

async function mergeDuplicateListing(
  c: {
    execute: (
      args: { sql: string; args: InValue[] },
    ) => Promise<{ rows: unknown[] }>;
  },
  listingId: string,
  duplicateId: string,
  now: number,
): Promise<void> {
  if (listingId === duplicateId) return;
  await c.execute({
    sql: `UPDATE app_alias SET listing_id = ? WHERE listing_id = ?`,
    args: [listingId, duplicateId],
  });
  await c.execute({
    sql: `UPDATE app_record SET listing_id = ? WHERE listing_id = ?`,
    args: [listingId, duplicateId],
  });
  await c.execute({
    sql: `UPDATE app_review SET listing_id = ? WHERE listing_id = ?`,
    args: [listingId, duplicateId],
  });
  await c.execute({
    sql: `UPDATE app_favorite SET listing_id = ? WHERE listing_id = ?`,
    args: [listingId, duplicateId],
  });
  await c.execute({
    sql: `UPDATE app_mention SET listing_id = ? WHERE listing_id = ?`,
    args: [listingId, duplicateId],
  });
  await c.execute({
    sql: `
      INSERT INTO app_featured (listing_id, position, label, added_at)
      SELECT ?, position, label, added_at FROM app_featured WHERE listing_id = ?
      ON CONFLICT(listing_id) DO NOTHING
    `,
    args: [listingId, duplicateId],
  });
  await c.execute({
    sql: `DELETE FROM app_featured WHERE listing_id = ?`,
    args: [duplicateId],
  });
  await c.execute({
    sql: `
      INSERT INTO app_moderation (listing_id, status, reason, updated_at, updated_by)
      SELECT ?, status, reason, updated_at, updated_by FROM app_moderation WHERE listing_id = ?
      ON CONFLICT(listing_id) DO NOTHING
    `,
    args: [listingId, duplicateId],
  });
  await c.execute({
    sql: `DELETE FROM app_moderation WHERE listing_id = ?`,
    args: [duplicateId],
  });
  await c.execute({
    sql: `UPDATE app_listing SET deleted_at = ?, indexed_at = ? WHERE id = ?`,
    args: [now, now, duplicateId],
  });
}

async function recomputeListing(
  c: {
    execute: (
      args: { sql: string; args: InValue[] },
    ) => Promise<{ rows: unknown[] }>;
  },
  listingId: string,
): Promise<void> {
  const rows = await c.execute({
    sql:
      `SELECT parsed_json FROM app_record WHERE listing_id = ? AND deleted_at IS NULL`,
    args: [listingId],
  });
  const drafts = rows.rows
    .map((row) =>
      safeJson<AppListingDraft>(
        String((row as Record<string, unknown>).parsed_json ?? ""),
        null as unknown as AppListingDraft,
      )
    )
    .filter((draft): draft is AppListingDraft => !!draft?.sourceUri);
  if (drafts.length === 0) {
    await c.execute({
      sql: `UPDATE app_listing SET deleted_at = ? WHERE id = ?`,
      args: [Date.now(), listingId],
    });
    return;
  }
  const merged = mergeAppListingDrafts(drafts);
  const slug = await ensureUniqueSlug(
    c.execute.bind(c),
    merged.slug,
    listingId,
  );
  const now = Date.now();
  await c.execute({
    sql: `
      INSERT INTO app_listing (
        id, slug, name, description, tagline, app_status,
        primary_url, icon_url, hero_url, screenshot_urls, links_json,
        tags_json, platforms_json,
        category_slugs_json, lexicons_json, account_indicators_json,
        source_refs_json, canonical_source, canonical_uri, product_did,
        profile_did, legacy_profile_did, atstore_listing_uri,
        community_profile_uri, community_entry_uri, published_at, updated_at,
        indexed_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        slug=excluded.slug,
        name=excluded.name,
        description=excluded.description,
        tagline=excluded.tagline,
        app_status=excluded.app_status,
        primary_url=excluded.primary_url,
        icon_url=excluded.icon_url,
        hero_url=excluded.hero_url,
        screenshot_urls=excluded.screenshot_urls,
        links_json=excluded.links_json,
        tags_json=excluded.tags_json,
        platforms_json=excluded.platforms_json,
        category_slugs_json=excluded.category_slugs_json,
        lexicons_json=excluded.lexicons_json,
        account_indicators_json=excluded.account_indicators_json,
        source_refs_json=excluded.source_refs_json,
        canonical_source=excluded.canonical_source,
        canonical_uri=excluded.canonical_uri,
        product_did=excluded.product_did,
        profile_did=excluded.profile_did,
        legacy_profile_did=excluded.legacy_profile_did,
        atstore_listing_uri=excluded.atstore_listing_uri,
        community_profile_uri=excluded.community_profile_uri,
        community_entry_uri=excluded.community_entry_uri,
        published_at=excluded.published_at,
        updated_at=excluded.updated_at,
        indexed_at=excluded.indexed_at,
        deleted_at=NULL
    `,
    args: [
      listingId,
      slug,
      merged.name,
      merged.description,
      merged.tagline,
      merged.appStatus ?? null,
      merged.primaryUrl ?? null,
      merged.iconUrl ?? null,
      merged.heroUrl ?? null,
      JSON.stringify(merged.screenshotUrls),
      JSON.stringify(merged.links),
      JSON.stringify(merged.tags),
      JSON.stringify(merged.platforms),
      JSON.stringify(merged.categorySlugs),
      JSON.stringify(merged.lexicons),
      JSON.stringify(merged.accountIndicators),
      JSON.stringify(merged.sourceRefs),
      merged.canonicalSource,
      merged.canonicalUri,
      merged.productDid ?? null,
      merged.profileDid ?? null,
      merged.legacyProfileDid ?? null,
      merged.atstoreListingUri ?? null,
      merged.communityProfileUri ?? null,
      merged.communityEntryUri ?? null,
      merged.publishedAt,
      merged.updatedAt,
      now,
    ],
  });
  if (merged.atstoreListingUri) {
    await linkAppSocialRecords(c, listingId, merged.atstoreListingUri);
  }
  await updateAppListingAggregatesForId(c, listingId);
}

async function linkAppSocialRecords(
  c: {
    execute: (
      args: { sql: string; args: InValue[] },
    ) => Promise<{ rows: unknown[] }>;
  },
  listingId: string,
  listingUri: string,
): Promise<void> {
  await c.execute({
    sql: `
      UPDATE app_review
      SET listing_id = ?
      WHERE listing_uri = ? AND deleted_at IS NULL
    `,
    args: [listingId, listingUri],
  });
  await c.execute({
    sql: `
      UPDATE app_favorite
      SET listing_id = ?
      WHERE listing_uri = ? AND deleted_at IS NULL
    `,
    args: [listingId, listingUri],
  });
  await c.execute({
    sql: `
      UPDATE app_mention
      SET listing_id = ?
      WHERE listing_uri = ? AND deleted_at IS NULL
    `,
    args: [listingId, listingUri],
  });
}

export async function deleteAppRecord(uri: string): Promise<void> {
  try {
    await withDb(async (c) => {
      const res = await c.execute({
        sql: `SELECT listing_id FROM app_record WHERE uri = ? LIMIT 1`,
        args: [uri],
      });
      const listingId = (res.rows[0] as Record<string, unknown> | undefined)
        ?.listing_id;
      await c.execute({
        sql:
          `UPDATE app_record SET deleted_at = ?, indexed_at = ? WHERE uri = ?`,
        args: [Date.now(), Date.now(), uri],
      });
      if (typeof listingId === "string" && listingId) {
        await recomputeListing(c, listingId);
      }
    });
  } finally {
    clearAppDirectorySearchCache();
  }
}

export async function upsertAppReview(draft: AppReviewDraft): Promise<void> {
  try {
    await withDb(async (c) => {
      const previous = await c.execute({
        sql: `SELECT listing_id FROM app_review WHERE uri = ? LIMIT 1`,
        args: [draft.uri],
      });
      const previousListingId =
        (previous.rows[0] as Record<string, unknown> | undefined)?.listing_id;
      const listing = await findListingByAtstoreUri(c, draft.subject);
      await c.execute({
        sql: `
          INSERT INTO app_review (
            uri, listing_uri, listing_id, author_did, rkey, cid, rating, body,
            created_at, updated_at, indexed_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(uri) DO UPDATE SET
            listing_uri=excluded.listing_uri,
            listing_id=excluded.listing_id,
            author_did=excluded.author_did,
            rkey=excluded.rkey,
            cid=excluded.cid,
            rating=excluded.rating,
            body=excluded.body,
            created_at=excluded.created_at,
            updated_at=excluded.updated_at,
            indexed_at=excluded.indexed_at,
            deleted_at=NULL
        `,
        args: [
          draft.uri,
          draft.subject,
          listing?.id ?? null,
          draft.repoDid,
          draft.rkey,
          draft.cid,
          draft.rating,
          draft.body,
          draft.createdAt,
          draft.updatedAt,
          Date.now(),
        ],
      });
      await updateAffectedListingAggregates(c, [
        typeof previousListingId === "string" ? previousListingId : null,
        listing?.id ?? null,
      ]);
    });
  } finally {
    clearAppDirectorySearchCache();
  }
}

export async function deleteAppReview(uri: string): Promise<void> {
  try {
    await withDb(async (c) => {
      const res = await c.execute({
        sql: `SELECT listing_id FROM app_review WHERE uri = ? LIMIT 1`,
        args: [uri],
      });
      const listingId = (res.rows[0] as Record<string, unknown> | undefined)
        ?.listing_id;
      await c.execute({
        sql:
          `UPDATE app_review SET deleted_at = ?, indexed_at = ? WHERE uri = ?`,
        args: [Date.now(), Date.now(), uri],
      });
      if (typeof listingId === "string" && listingId) {
        await updateAppListingAggregatesForId(c, listingId);
      }
    });
  } finally {
    clearAppDirectorySearchCache();
  }
}

export async function listAppReviewsForListing(
  listingId: string,
  options: { limit?: number; sort?: AppReviewSort } = {},
): Promise<AppMirroredReview[]> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 12));
  const order = appReviewOrder(options.sort ?? "newest");
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT
          uri, listing_uri, listing_id, author_did, rating, body,
          created_at, updated_at
        FROM app_review
        WHERE listing_id = ? AND deleted_at IS NULL
        ORDER BY ${order}
        LIMIT ?
      `,
      args: [listingId, limit],
    });
    return result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        uri: String(r.uri),
        listingUri: String(r.listing_uri),
        listingId: typeof r.listing_id === "string" ? r.listing_id : null,
        authorDid: String(r.author_did),
        rating: Number(r.rating ?? 0),
        body: String(r.body ?? ""),
        createdAt: Number(r.created_at ?? 0),
        updatedAt: Number(r.updated_at ?? r.created_at ?? 0),
      };
    });
  });
}

function appReviewOrder(sort: AppReviewSort): string {
  if (sort === "highest") {
    return "rating DESC, updated_at DESC, created_at DESC";
  }
  if (sort === "lowest") {
    return "rating ASC, updated_at DESC, created_at DESC";
  }
  return "updated_at DESC, created_at DESC";
}

export async function getOwnAppReview(
  listingId: string,
  authorDid: string,
): Promise<AppOwnReview | null> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT uri, rkey, rating, body, created_at, updated_at
        FROM app_review
        WHERE listing_id = ? AND author_did = ? AND deleted_at IS NULL
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      args: [listingId, authorDid],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const rating = Number(row.rating);
    if (![1, 2, 3, 4, 5].includes(rating)) return null;
    return {
      uri: String(row.uri),
      rkey: String(row.rkey),
      rating: rating as 1 | 2 | 3 | 4 | 5,
      body: String(row.body ?? ""),
      createdAt: Number(row.created_at ?? 0),
      updatedAt: Number(row.updated_at ?? row.created_at ?? 0),
    };
  });
}

export async function listAppAliasesForListing(
  listingId: string,
): Promise<AppAliasRow[]> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT alias_key, source_uri, created_at
        FROM app_alias
        WHERE listing_id = ?
        ORDER BY ${caseInsensitiveOrder("alias_key")}
      `,
      args: [listingId],
    });
    return result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        aliasKey: String(r.alias_key),
        sourceUri: String(r.source_uri),
        createdAt: Number(r.created_at ?? 0),
      };
    });
  });
}

export async function upsertAppFavorite(
  draft: AppFavoriteDraft,
): Promise<void> {
  try {
    await withDb(async (c) => {
      const previous = await c.execute({
        sql: `SELECT listing_id FROM app_favorite WHERE uri = ? LIMIT 1`,
        args: [draft.uri],
      });
      const previousListingId =
        (previous.rows[0] as Record<string, unknown> | undefined)?.listing_id;
      const listing = await findListingByAtstoreUri(c, draft.subject);
      await c.execute({
        sql: `
          INSERT INTO app_favorite (
            uri, listing_uri, listing_id, author_did, rkey, cid, created_at,
            indexed_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(uri) DO UPDATE SET
            listing_uri=excluded.listing_uri,
            listing_id=excluded.listing_id,
            author_did=excluded.author_did,
            rkey=excluded.rkey,
            cid=excluded.cid,
            created_at=excluded.created_at,
            indexed_at=excluded.indexed_at,
            deleted_at=NULL
        `,
        args: [
          draft.uri,
          draft.subject,
          listing?.id ?? null,
          draft.repoDid,
          draft.rkey,
          draft.cid,
          draft.createdAt,
          Date.now(),
        ],
      });
      await updateAffectedListingAggregates(c, [
        typeof previousListingId === "string" ? previousListingId : null,
        listing?.id ?? null,
      ]);
    });
  } finally {
    clearAppDirectorySearchCache();
  }
}

export async function deleteAppFavorite(uri: string): Promise<void> {
  try {
    await withDb(async (c) => {
      const res = await c.execute({
        sql: `SELECT listing_id FROM app_favorite WHERE uri = ? LIMIT 1`,
        args: [uri],
      });
      const listingId = (res.rows[0] as Record<string, unknown> | undefined)
        ?.listing_id;
      await c.execute({
        sql:
          `UPDATE app_favorite SET deleted_at = ?, indexed_at = ? WHERE uri = ?`,
        args: [Date.now(), Date.now(), uri],
      });
      if (typeof listingId === "string" && listingId) {
        await updateAppListingAggregatesForId(c, listingId);
      }
    });
  } finally {
    clearAppDirectorySearchCache();
  }
}

export async function getOwnAppFavorite(
  listingId: string,
  authorDid: string,
): Promise<AppOwnFavorite | null> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT uri, rkey, created_at
        FROM app_favorite
        WHERE listing_id = ? AND author_did = ? AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `,
      args: [listingId, authorDid],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row
      ? {
        uri: String(row.uri),
        rkey: String(row.rkey),
        createdAt: Number(row.created_at ?? 0),
      }
      : null;
  });
}

async function findListingByAtstoreUri(
  c: {
    execute: (
      args: { sql: string; args: InValue[] },
    ) => Promise<{ rows: unknown[] }>;
  },
  uri: string,
): Promise<{ id: string } | null> {
  const res = await c.execute({
    sql: `SELECT id FROM app_listing WHERE atstore_listing_uri = ? LIMIT 1`,
    args: [uri],
  });
  const id = (res.rows[0] as Record<string, unknown> | undefined)?.id;
  return typeof id === "string" ? { id } : null;
}

async function updateAppListingAggregatesForId(
  c: {
    execute: (
      args: { sql: string; args: InValue[] },
    ) => Promise<{ rows: unknown[] }>;
  },
  listingId: string,
): Promise<void> {
  const now = Date.now();
  const decaySince = now - daysToMs(trendingDecayWindowDays());
  const recentRatingHalfLife = trendingRatingRecentHalfLifeDays();
  const recentReviewSince = now - daysToMs(recentRatingHalfLife * 2);
  const favoriteVelocityRecentDays = trendingFavoriteVelocityRecentDays();
  const favoriteVelocityBaselineDays = trendingFavoriteVelocityBaselineDays();
  const favoriteVelocityRecentSince = now -
    daysToMs(favoriteVelocityRecentDays);
  const favoriteVelocityBaselineSince = now -
    daysToMs(favoriteVelocityBaselineDays);
  const mention24hSince = now - daysToMs(1);
  const mention7dSince = now - daysToMs(7);

  const reviews = await c.execute({
    sql: `
      SELECT COUNT(*) AS n, AVG(rating) AS avg_rating
      FROM app_review
      WHERE listing_id = ? AND deleted_at IS NULL
    `,
    args: [listingId],
  });
  const favoriteCountResult = await c.execute({
    sql: `
      SELECT COUNT(*) AS n FROM app_favorite
      WHERE listing_id = ? AND deleted_at IS NULL
    `,
    args: [listingId],
  });
  const [
    favoriteRows,
    reviewRows,
    mentionRows,
    mention24hResult,
    mention7dResult,
    favoriteRecentResult,
    favoriteBaselineResult,
  ] = await Promise.all([
    c.execute({
      sql: `
        SELECT created_at FROM app_favorite
        WHERE listing_id = ? AND deleted_at IS NULL AND created_at >= ?
      `,
      args: [listingId, decaySince],
    }),
    c.execute({
      sql: `
        SELECT rating, created_at FROM app_review
        WHERE listing_id = ? AND deleted_at IS NULL AND created_at >= ?
      `,
      args: [listingId, recentReviewSince],
    }),
    c.execute({
      sql: `
        SELECT post_created_at FROM app_mention
        WHERE listing_id = ? AND deleted_at IS NULL AND post_created_at >= ?
      `,
      args: [listingId, decaySince],
    }),
    c.execute({
      sql: `
        SELECT COUNT(*) AS n FROM app_mention
        WHERE listing_id = ? AND deleted_at IS NULL AND post_created_at >= ?
      `,
      args: [listingId, mention24hSince],
    }),
    c.execute({
      sql: `
        SELECT COUNT(*) AS n FROM app_mention
        WHERE listing_id = ? AND deleted_at IS NULL AND post_created_at >= ?
      `,
      args: [listingId, mention7dSince],
    }),
    c.execute({
      sql: `
        SELECT COUNT(*) AS n FROM app_favorite
        WHERE listing_id = ? AND deleted_at IS NULL AND created_at >= ?
      `,
      args: [listingId, favoriteVelocityRecentSince],
    }),
    c.execute({
      sql: `
        SELECT COUNT(*) AS n FROM app_favorite
        WHERE listing_id = ? AND deleted_at IS NULL AND created_at >= ?
      `,
      args: [listingId, favoriteVelocityBaselineSince],
    }),
  ]);

  const reviewRow = reviews.rows[0] as Record<string, unknown> | undefined;
  const favoriteRow = favoriteCountResult.rows[0] as
    | Record<string, unknown>
    | undefined;
  const reviewCount = Number(reviewRow?.n ?? 0);
  const averageRating = reviewRow?.avg_rating == null
    ? null
    : Number(reviewRow.avg_rating);
  const favoriteCount = Number(favoriteRow?.n ?? 0);
  const mentionCount24h = countFromResult(mention24hResult);
  const mentionCount7d = countFromResult(mention7dResult);
  const recentRatingMean = reviewRows.rows.length > 0
    ? decayedBayesianRating(
      reviewRows.rows.map((row) => ({
        rating: Number((row as Record<string, unknown>).rating ?? 0),
        createdAtMs: Number((row as Record<string, unknown>).created_at ?? 0),
      })),
      recentRatingHalfLife,
      now,
    )
    : null;
  const allTimeRating01 = ratingSignalFromAverage(
    bayesianAverageRating({ reviewCount, averageRating }),
  );
  const recentRating01 = recentRatingMean == null
    ? allTimeRating01
    : ratingSignalFromAverage(recentRatingMean);
  const ratingSignal01 = blendRatingSignals(
    allTimeRating01,
    recentRating01,
    trendingRatingRecentBlendWeight(),
  );
  const favoriteVelocity01 = favoriteVelocitySignal({
    recentCount: countFromResult(favoriteRecentResult),
    baselineCount: countFromResult(favoriteBaselineResult),
    recentDays: favoriteVelocityRecentDays,
    baselineDays: favoriteVelocityBaselineDays,
    prior: trendingFavoriteVelocityPrior(),
    squashK: trendingFavoriteVelocitySquashK(),
  });
  const trendingScore = combineTrendingScore({
    decayedFavoriteWeight: sumDecayedWeights(
      favoriteRows.rows.map((row) =>
        Number((row as Record<string, unknown>).created_at ?? 0)
      ),
      trendingFavoriteHalfLifeDays(),
      now,
    ),
    ratingSignal01,
    decayedMentionWeight: sumDecayedWeights(
      mentionRows.rows.map((row) =>
        Number((row as Record<string, unknown>).post_created_at ?? 0)
      ),
      trendingMentionHalfLifeDays(),
      now,
    ),
    mentionVolume01: mentionVolumeSignal(mentionCount7d),
    favoriteVelocity01,
  });
  await c.execute({
    sql: `
      UPDATE app_listing
      SET review_count = ?, average_rating = ?, favorite_count = ?,
          mention_count_24h = ?, mention_count_7d = ?, trending_score = ?
      WHERE id = ?
    `,
    args: [
      reviewCount,
      averageRating,
      favoriteCount,
      mentionCount24h,
      mentionCount7d,
      trendingScore,
      listingId,
    ],
  });
}

async function updateAffectedListingAggregates(
  c: {
    execute: (
      args: { sql: string; args: InValue[] },
    ) => Promise<{ rows: unknown[] }>;
  },
  listingIds: Array<string | null>,
): Promise<void> {
  for (const id of uniqueStrings(listingIds)) {
    if (id) await updateAppListingAggregatesForId(c, id);
  }
}

function countFromResult(result: { rows: unknown[] }): number {
  return Number(
    (result.rows[0] as Record<string, unknown> | undefined)?.n ?? 0,
  );
}

export async function rescoreAppDirectoryTrending(): Promise<number> {
  try {
    return await withDb(async (c) => {
      const rows = await c.execute(`
        SELECT id FROM app_listing
        WHERE deleted_at IS NULL
        ORDER BY COALESCE(trending_score, -1) ASC, updated_at ASC
      `);
      for (const row of rows.rows) {
        const id = (row as Record<string, unknown>).id;
        if (typeof id === "string" && id.length > 0) {
          await updateAppListingAggregatesForId(c, id);
        }
      }
      return rows.rows.length;
    });
  } finally {
    clearAppDirectorySearchCache();
  }
}

export async function upsertLegacyProfileAsApp(
  profile: ProfileRow,
): Promise<string> {
  const uri = atUri(
    profile.did,
    "com.atmosphereaccount.registry.profile",
    "self",
  );
  const record = {
    profileType: profile.profileType,
    name: profile.name,
    description: profile.description,
    mainLink: profile.mainLink ?? undefined,
    iosLink: profile.iosLink ?? undefined,
    androidLink: profile.androidLink ?? undefined,
    categories: profile.categories,
    subcategories: profile.subcategories,
    links: profile.links,
    lexicons: profile.lexicons,
    accountIndicators: profile.accountIndicators,
    screenshots: profile.screenshots,
    createdAt: new Date(profile.createdAt).toISOString(),
  };
  const draft = atmosphereProfileToDraft({
    did: profile.did,
    handle: profile.handle,
    uri,
    cid: profile.recordCid,
    record,
    iconUrl: profile.avatarCid
      ? `/api/registry/avatar/${encodeURIComponent(profile.did)}`
      : undefined,
    heroUrl: profile.bannerCid
      ? `/api/registry/project-og/${encodeURIComponent(profile.handle)}`
      : undefined,
    screenshotUrls: profile.screenshots.map((_, index) =>
      `/api/registry/screenshot/${encodeURIComponent(profile.did)}/${index}`
    ),
  });
  return await upsertAppRecordFromDraft({ draft, rawRecord: record });
}

let legacySyncPromise: Promise<void> | null = null;
let legacySyncCheckedAt = 0;
const LEGACY_SYNC_CHECK_TTL_MS = 5 * 60 * 1000;

export function syncLegacyAppProfilesToDirectory(): Promise<void> {
  if (legacySyncPromise) return legacySyncPromise;
  if (Date.now() - legacySyncCheckedAt < LEGACY_SYNC_CHECK_TTL_MS) {
    return Promise.resolve();
  }
  legacySyncPromise = (async () => {
    const alreadySeeded = await withDb(async (c) => {
      const result = await c.execute({
        sql: `
          SELECT 1 FROM app_record
          WHERE source_type = 'atmosphere_profile' AND deleted_at IS NULL
          LIMIT 1
        `,
        args: [],
      });
      return result.rows.length > 0;
    });
    if (alreadySeeded) {
      legacySyncCheckedAt = Date.now();
      return;
    }
    for (let page = 1; page < 50; page++) {
      const result = await searchProfiles({
        category: "app",
        page,
        pageSize: 48,
      });
      await Promise.all(result.profiles.map(upsertLegacyProfileAsApp));
      if (page * result.pageSize >= result.total) break;
    }
    legacySyncCheckedAt = Date.now();
  })().finally(() => {
    legacySyncPromise = null;
  });
  return legacySyncPromise;
}

function listSelect(prefix: string) {
  const p = prefix ? `${prefix}.` : "";
  return `
    ${p}id, ${p}slug, ${p}name, ${p}description, ${p}tagline,
    ${p}app_status, ${p}primary_url, ${p}icon_url, ${p}hero_url, ${p}screenshot_urls,
    ${p}links_json, ${p}tags_json, ${p}platforms_json,
    ${p}category_slugs_json, ${p}lexicons_json,
    ${p}account_indicators_json, ${p}source_refs_json,
    ${p}canonical_source, ${p}canonical_uri, ${p}product_did,
    ${p}profile_did, ${p}legacy_profile_did,
    (SELECT h.host
      FROM account_host h
      WHERE h.profile_did IS NOT NULL
        AND h.profile_did IN (
          ${p}product_did,
          ${p}profile_did,
          ${p}legacy_profile_did
        )
      ORDER BY
        CASE
          WHEN h.verification_status IN ('verified', 'claimed') THEN 0
          WHEN h.source = 'seeded' THEN 1
          ELSE 2
        END,
        h.observed_account_count DESC,
        h.host ASC
      LIMIT 1
    ) AS account_host,
    ${p}atstore_listing_uri,
    ${p}community_profile_uri, ${p}community_entry_uri, ${p}review_count,
    ${p}average_rating, ${p}favorite_count, ${p}mention_count_24h,
    ${p}mention_count_7d, ${p}trending_score, ${p}published_at,
    ${p}updated_at, ${p}indexed_at
  `;
}

function appWhere(query?: string, tags?: string | string[]) {
  const where = [
    "l.deleted_at IS NULL",
    "COALESCE(m.status, 'visible') = 'visible'",
  ];
  const args: InValue[] = [];
  if (query?.trim()) {
    const raw = query.trim();
    if (isPostgresBackend()) {
      where.push(
        `(l.search_vector @@ plainto_tsquery('simple', ?) OR l.slug ILIKE ? OR l.name ILIKE ?)`,
      );
      const like = `%${raw}%`;
      args.push(raw, like, like);
    } else {
      const q = `%${raw.toLowerCase()}%`;
      where.push(
        `(lower(l.name) LIKE ? OR lower(l.description) LIKE ? OR lower(l.tagline) LIKE ? OR lower(l.tags_json) LIKE ? OR lower(l.category_slugs_json) LIKE ?)`,
      );
      args.push(q, q, q, q, q);
    }
  }
  const selectedTags = Array.isArray(tags) ? tags : tags ? [tags] : [];
  const aliases = uniqueStrings(
    selectedTags.flatMap((tag) => appCollectionAliases(tag)),
  );
  if (aliases.length > 0) {
    const placeholders = aliases.map(() => "?").join(",");
    const tagClause = isPostgresBackend()
      ? `(
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(l.category_slugs_json::jsonb) AS category(value)
          WHERE lower(replace(replace(replace(category.value, 'apps/', ''), '-', ' '), '_', ' ')) IN (${placeholders})
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(l.tags_json::jsonb) AS tag(value)
          WHERE lower(replace(replace(tag.value, '-', ' '), '_', ' ')) IN (${placeholders})
        )
      )`
      : `(
        EXISTS (
          SELECT 1 FROM json_each(l.category_slugs_json)
          WHERE lower(replace(replace(replace(value, 'apps/', ''), '-', ' '), '_', ' ')) IN (${placeholders})
        )
        OR EXISTS (
          SELECT 1 FROM json_each(l.tags_json)
          WHERE lower(replace(replace(value, '-', ' '), '_', ' ')) IN (${placeholders})
        )
      )`;
    where.push(tagClause);
    args.push(...aliases, ...aliases);
  }
  return { clause: where.join(" AND "), args };
}

function orderForSort(sort: AppDirectorySort) {
  if (sort === "newest") return "COALESCE(l.published_at, l.updated_at) DESC";
  if (sort === "az") return caseInsensitiveOrder("l.name");
  return trendingOrder();
}

function caseInsensitiveOrder(column: string): string {
  return isPostgresBackend()
    ? `lower(${column}) ASC`
    : `${column} COLLATE NOCASE ASC`;
}

function trendingOrder(): string {
  return `
    CASE WHEN l.trending_score IS NULL THEN 1 ELSE 0 END,
    l.trending_score DESC,
    l.updated_at DESC,
    COALESCE(l.published_at, l.indexed_at) DESC
  `;
}

export async function searchAppDirectory(input: {
  query?: string;
  tag?: string | string[];
  sort?: AppDirectorySort;
  page?: number;
  pageSize?: number;
  includeSections?: boolean;
  includeApps?: boolean;
  includeTags?: boolean;
  includeTotal?: boolean;
  syncLegacy?: boolean;
} = {}): Promise<AppSearchResult> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(48, Math.max(1, input.pageSize ?? 24));
  const offset = (page - 1) * pageSize;
  const sort = input.sort ?? "trending";
  const includeApps = input.includeApps !== false;
  const includeTags = input.includeTags !== false;
  const includeTotal = input.includeTotal !== false;
  const includeSections = input.includeSections !== false;
  const cacheKey = searchCacheKey({
    query: input.query,
    tag: input.tag,
    sort,
    page,
    pageSize,
    includeSections,
    includeApps,
    includeTags,
    includeTotal,
  });
  const cached = cachedSearchResult(cacheKey);
  if (cached) return cached;

  if (input.syncLegacy !== false) {
    await syncLegacyAppProfilesToDirectory().catch((err) =>
      console.warn("[app-directory] legacy sync failed:", err)
    );
  }
  const { clause, args } = appWhere(input.query, input.tag);
  const result = await withDb(async (c) => {
    const countPromise = includeTotal
      ? c.execute({
        sql: `
          SELECT COUNT(*) AS n
          FROM app_listing l
          LEFT JOIN app_moderation m ON m.listing_id = l.id
          WHERE ${clause}
        `,
        args,
      })
      : Promise.resolve({ rows: [] });
    const rowsPromise = includeApps
      ? c.execute({
        sql: `
          SELECT ${listSelect("l")}
          FROM app_listing l
          LEFT JOIN app_moderation m ON m.listing_id = l.id
          WHERE ${clause}
          ORDER BY ${orderForSort(sort)}
          LIMIT ? OFFSET ?
        `,
        args: [...args, pageSize, offset],
      })
      : Promise.resolve({ rows: [] });
    const tagSummaryPromise = includeTags
      ? listDirectoryTagSummaries(c)
      : Promise.resolve({ tags: [], tagSummaries: [] });
    const sectionsPromise = includeSections && !input.query && !input.tag
      ? Promise.all([
        listSection(c, "featured"),
        listSection(c, "trending"),
        listSection(c, "fresh"),
      ])
      : Promise.resolve([[], [], []] as AppListing[][]);
    const [count, rows, tagSummaryResult, sections] = await Promise.all([
      countPromise,
      rowsPromise,
      tagSummaryPromise,
      sectionsPromise,
    ]);
    const [featured, trending, fresh] = sections;
    return {
      apps: rows.rows.map(rowToAppListing),
      featured,
      trending,
      fresh,
      total: includeTotal
        ? Number((count.rows[0] as Record<string, unknown> | undefined)?.n ?? 0)
        : rows.rows.length,
      page,
      pageSize,
      tags: tagSummaryResult.tags,
      tagSummaries: tagSummaryResult.tagSummaries,
    };
  });
  return rememberSearchResult(cacheKey, result);
}

async function listDirectoryTagSummaries(
  c: {
    execute: (
      args: { sql: string; args?: InValue[] } | string,
    ) => Promise<{ rows: unknown[] }>;
  },
): Promise<Pick<AppSearchResult, "tags" | "tagSummaries">> {
  const cached = tagSummaryCache;
  if (cached && cached.expiresAt > Date.now()) {
    return { tags: cached.tags, tagSummaries: cached.tagSummaries };
  }
  const tagsRows = await c.execute(`
    SELECT l.category_slugs_json, l.tags_json
    FROM app_listing l
    LEFT JOIN app_moderation m ON m.listing_id = l.id
    WHERE l.deleted_at IS NULL
      AND COALESCE(m.status, 'visible') = 'visible'
      AND (
        COALESCE(l.category_slugs_json, '[]') != '[]'
        OR COALESCE(l.tags_json, '[]') != '[]'
      )
    ORDER BY l.updated_at DESC
    LIMIT 500
  `);
  const tagLists = tagsRows.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const categories = safeJson<string[]>(
      String(r.category_slugs_json ?? "[]"),
      [],
    ).map((slug) => normalizeAppCollectionSlug(slug) ?? slug);
    const tags = safeJson<string[]>(String(r.tags_json ?? "[]"), []);
    return uniqueStrings([...categories, ...tags]);
  });
  const collectionCounts = new Map<string, number>();
  for (const tagList of tagLists) {
    const normalizedTags = new Set<string>();
    for (const tag of uniqueStrings(tagList)) {
      const normalized = normalizeAppTag(tag);
      if (normalized) normalizedTags.add(normalized);
    }
    for (const collection of APP_COLLECTIONS) {
      const aliases = appCollectionAliases(collection.tag);
      if (aliases.some((alias) => normalizedTags.has(alias))) {
        collectionCounts.set(
          collection.tag,
          (collectionCounts.get(collection.tag) ?? 0) + 1,
        );
      }
    }
  }
  const tagSummaries = APP_COLLECTIONS
    .map((collection) => ({
      tag: collection.tag,
      count: collectionCounts.get(collection.tag) ?? 0,
    }))
    .filter((collection) => collection.count > 0);
  const tags = tagSummaries.map((collection) => collection.tag);
  tagSummaryCache = {
    expiresAt: Date.now() + TAG_SUMMARY_CACHE_TTL_MS,
    tags,
    tagSummaries,
  };
  return { tags, tagSummaries };
}

async function listSection(
  c: {
    execute: (
      args: { sql: string; args?: InValue[] } | string,
    ) => Promise<{ rows: unknown[] }>;
  },
  section: "featured" | "trending" | "fresh",
): Promise<AppListing[]> {
  const base = `
    SELECT ${listSelect("l")}
    FROM app_listing l
    LEFT JOIN app_moderation m ON m.listing_id = l.id
    WHERE l.deleted_at IS NULL AND COALESCE(m.status, 'visible') = 'visible'
  `;
  const sql = section === "featured"
    ? `
      SELECT ${listSelect("l")}
      FROM app_listing l
      LEFT JOIN app_featured f ON f.listing_id = l.id
      LEFT JOIN app_moderation m ON m.listing_id = l.id
      WHERE l.deleted_at IS NULL AND COALESCE(m.status, 'visible') = 'visible'
      ORDER BY
        CASE WHEN f.listing_id IS NULL THEN 1 ELSE 0 END,
        COALESCE(f.position, 9999) ASC,
        CASE
          WHEN COALESCE(l.hero_url, '') != '' THEN 0
          WHEN COALESCE(l.screenshot_urls, '[]') != '[]' THEN 1
          WHEN COALESCE(l.icon_url, '') != '' THEN 2
          ELSE 3
        END,
        CASE WHEN l.canonical_source = 'atstore_listing' THEN 0 ELSE 1 END,
        ${trendingOrder()}
      LIMIT ${FEATURED_CANDIDATE_LIMIT}
    `
    : section === "fresh"
    ? `${base} ORDER BY COALESCE(l.published_at, l.updated_at) DESC LIMIT 6`
    : `${base} ORDER BY ${trendingOrder()} LIMIT 6`;
  const rows = await c.execute(sql);
  const apps = rows.rows.map(rowToAppListing);
  return section === "featured"
    ? rotateFeaturedApps(apps, FEATURED_SECTION_SIZE)
    : apps;
}

function rotateFeaturedApps(
  apps: AppListing[],
  size: number,
  now = Date.now(),
): AppListing[] {
  if (apps.length <= size) return apps;
  const slot = Math.floor(now / FEATURED_ROTATION_MS);
  const offset = hashFeaturedSlot(apps, slot) % apps.length;
  const rotated: AppListing[] = [];
  for (let index = 0; index < size; index++) {
    rotated.push(apps[(offset + index) % apps.length]);
  }
  return rotated;
}

function hashFeaturedSlot(apps: AppListing[], slot: number): number {
  let hash = 2166136261 ^ slot;
  for (const app of apps) {
    for (let index = 0; index < app.id.length; index++) {
      hash ^= app.id.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

export async function getAppListingByIdentifier(
  identifier: string,
  options: { syncLegacy?: boolean } = {},
): Promise<AppListing | null> {
  if (options.syncLegacy !== false) {
    await syncLegacyAppProfilesToDirectory().catch(() => {});
  }
  const raw = decodeURIComponent(identifier).trim();
  const keyCandidates = uniqueStrings([
    didAlias(raw),
    raw.startsWith("at://") ? `uri:${raw}` : null,
    urlAlias(raw),
  ]);
  return await withDb(async (c) => {
    const bySlug = await c.execute({
      sql: `
        SELECT ${listSelect("l")}
        FROM app_listing l
        WHERE l.slug = ? AND l.deleted_at IS NULL
        LIMIT 1
      `,
      args: [slugify(raw)],
    });
    if (bySlug.rows.length > 0) {
      return rowToAppListing(bySlug.rows[0]);
    }
    if (keyCandidates.length === 0) return null;
    const alias = await c.execute({
      sql: `
        SELECT ${listSelect("l")}
        FROM app_alias a
        JOIN app_listing l ON l.id = a.listing_id
        WHERE a.alias_key IN (${keyCandidates.map(() => "?").join(",")})
          AND l.deleted_at IS NULL
        LIMIT 1
      `,
      args: keyCandidates,
    });
    return alias.rows.length > 0 ? rowToAppListing(alias.rows[0]) : null;
  });
}

export async function getVisibleAppListingByAccountDid(
  did: string,
  options: { syncLegacy?: boolean } = {},
): Promise<AppListing | null> {
  if (options.syncLegacy !== false) {
    await syncLegacyAppProfilesToDirectory().catch(() => {});
  }
  const normalized = did.trim();
  if (!normalized.startsWith("did:")) return null;
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT ${listSelect("l")}
        FROM app_listing l
        LEFT JOIN app_moderation m ON m.listing_id = l.id
        WHERE l.deleted_at IS NULL
          AND COALESCE(m.status, 'visible') = 'visible'
          AND (
            l.product_did = ? OR
            l.profile_did = ? OR
            l.legacy_profile_did = ?
          )
        ORDER BY
          CASE WHEN l.atstore_listing_uri IS NOT NULL THEN 0 ELSE 1 END,
          l.updated_at DESC,
          l.slug ASC
        LIMIT 1
      `,
      args: [normalized, normalized, normalized],
    });
    return result.rows.length > 0 ? rowToAppListing(result.rows[0]) : null;
  });
}
