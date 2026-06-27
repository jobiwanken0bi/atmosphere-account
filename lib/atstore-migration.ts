import { appCollectionForTag } from "./app-collections.ts";
import { ATSTORE_LISTING_NSID, parseAtstoreListing } from "./app-lexicons.ts";
import { upsertAppRecordFromDraft } from "./app-directory.ts";
import type { BlobRef, LinkEntry, ProfileRecord } from "./lexicons.ts";
import { listRecordsPublic, putRecord } from "./pds.ts";
import type { ProfileRow } from "./registry.ts";
import { createAtprotoTid } from "./tid.ts";

export interface AtstoreListingLink {
  type: string;
  url: string;
  label?: string;
}

export interface AtstoreListingRecord {
  $type?: typeof ATSTORE_LISTING_NSID;
  slug: string;
  name: string;
  tagline: string;
  description?: string;
  externalUrl: string;
  icon: BlobRef;
  heroImage?: BlobRef;
  screenshots?: BlobRef[];
  categorySlug: string[];
  createdAt: string;
  updatedAt: string;
  appTags?: string[];
  productAccountDid: string;
  migratedFromAtUri?: string;
  links?: AtstoreListingLink[];
}

export interface AtstoreMigrationReadiness {
  ok: boolean;
  issues: string[];
}

export interface AtstoreMigrationRecordRef {
  uri: string;
  cid: string;
  rkey: string;
  value: unknown;
}

export interface AtstoreMigrationPublishResult {
  uri: string;
  cid: string;
  rkey: string;
  slug: string | undefined;
}

const ATSTORE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

export function atmosphereProfileAtUri(did: string): string {
  return `at://${did}/com.atmosphereaccount.registry.profile/self`;
}

export function atstoreListingAtUri(did: string, rkey: string): string {
  return `at://${did}/${ATSTORE_LISTING_NSID}/${rkey}`;
}

export function getAtstoreMigrationReadiness(
  profile: ProfileRow,
  record: ProfileRecord | null,
): AtstoreMigrationReadiness {
  const issues: string[] = [];
  if (profile.takedownStatus === "taken_down") {
    issues.push("Restore this app before migrating it.");
  }
  if (!profile.categories.includes("app")) {
    issues.push("Only app listings can be migrated to ATStore.");
  }
  if (!primaryUrl(profile)) {
    issues.push("Add a website, iOS, or Android link.");
  }
  if (!record) {
    issues.push("Publish the latest Atmosphere app profile first.");
  } else if (!isAtstoreImageBlob(record.avatar)) {
    issues.push("Add an app icon/avatar and publish it first.");
  }
  return { ok: issues.length === 0, issues };
}

export function buildAtstoreListingFromProfile(
  profile: ProfileRow,
  record: ProfileRecord,
  now = new Date(),
): AtstoreListingRecord {
  const url = primaryUrl(profile);
  if (!url) throw new Error("missing_external_url");
  if (!isAtstoreImageBlob(record.avatar)) throw new Error("missing_icon");
  const createdAt = validIso(record.createdAt) ??
    validIso(new Date(profile.createdAt).toISOString()) ??
    now.toISOString();
  const tags = uniqueStrings([
    ...profile.subcategories,
    ...profile.categories.filter((category) => category !== "app"),
  ]);
  const links = directoryLinks(profile.links, profile);
  return {
    $type: ATSTORE_LISTING_NSID,
    slug: slugForProfile(profile),
    name: profile.name.trim().slice(0, 640),
    tagline: taglineForProfile(profile),
    ...(profile.description.trim()
      ? { description: profile.description.trim().slice(0, 20_000) }
      : {}),
    externalUrl: url,
    icon: record.avatar,
    ...(isAtstoreImageBlob(record.banner) ? { heroImage: record.banner } : {}),
    screenshots: (record.screenshots ?? [])
      .map((entry) => entry.image)
      .filter(isAtstoreImageBlob)
      .slice(0, 20),
    categorySlug: [categorySlugForProfile(profile)],
    createdAt,
    updatedAt: now.toISOString(),
    ...(tags.length > 0 ? { appTags: tags.slice(0, 64) } : {}),
    productAccountDid: profile.did,
    migratedFromAtUri: atmosphereProfileAtUri(profile.did),
    ...(links.length > 0 ? { links } : {}),
  };
}

export function buildAtstoreListingFromProfileRecord(
  input: {
    did: string;
    handle: string;
    record: ProfileRecord;
    createdAt?: string | null;
    now?: Date;
  },
): AtstoreListingRecord {
  const now = input.now ?? new Date();
  const url = primaryUrlFromRecord(input.record);
  if (!url) throw new Error("missing_external_url");
  if (!isAtstoreImageBlob(input.record.avatar)) {
    throw new Error("missing_icon");
  }
  const createdAt = validIso(input.createdAt) ??
    validIso(input.record.createdAt) ?? now.toISOString();
  const categories = input.record.categories ?? [];
  const subcategories = input.record.subcategories ?? [];
  const tags = uniqueStrings([
    ...subcategories,
    ...categories.filter((category) => category !== "app"),
  ]);
  const links = directoryLinksFromParts(input.record.links ?? [], {
    handle: input.handle,
    iosLink: input.record.iosLink ?? null,
    androidLink: input.record.androidLink ?? null,
  });

  return {
    $type: ATSTORE_LISTING_NSID,
    slug: slugForHandleNameOrDid(input.handle, input.record.name, input.did),
    name: input.record.name.trim().slice(0, 640),
    tagline: taglineForText(input.record.description, input.record.name),
    ...(input.record.description.trim()
      ? { description: input.record.description.trim().slice(0, 20_000) }
      : {}),
    externalUrl: url,
    icon: input.record.avatar,
    ...(isAtstoreImageBlob(input.record.banner)
      ? { heroImage: input.record.banner }
      : {}),
    screenshots: (input.record.screenshots ?? [])
      .map((entry) => entry.image)
      .filter(isAtstoreImageBlob)
      .slice(0, 20),
    categorySlug: [categorySlugFromSubcategories(subcategories)],
    createdAt,
    updatedAt: now.toISOString(),
    ...(tags.length > 0 ? { appTags: tags.slice(0, 64) } : {}),
    productAccountDid: input.did,
    ...(links.length > 0 ? { links } : {}),
  };
}

export async function findExistingAtstoreListingForProfile(
  profileDid: string,
  pdsUrl: string,
): Promise<AtstoreMigrationRecordRef | null> {
  const sourceAtUri = atmosphereProfileAtUri(profileDid);
  let cursor: string | undefined;
  do {
    const page = await listRecordsPublic(
      pdsUrl,
      profileDid,
      ATSTORE_LISTING_NSID,
      { limit: 100, cursor },
    );
    for (const record of page.records) {
      const value = asRecord(record.value);
      if (
        value?.migratedFromAtUri === sourceAtUri ||
        value?.productAccountDid === profileDid
      ) {
        return {
          uri: record.uri,
          cid: record.cid,
          rkey: record.uri.split("/").at(-1) ?? "",
          value: record.value,
        };
      }
    }
    cursor = page.cursor;
  } while (cursor);
  return null;
}

export async function indexAtstoreListingMigrationRecord(
  record: AtstoreMigrationRecordRef,
  repoDid: string,
): Promise<AtstoreMigrationPublishResult | null> {
  const draft = parseAtstoreListing({
    uri: record.uri,
    cid: record.cid,
    repoDid,
    rkey: record.rkey,
    value: record.value,
  });
  if (!draft) return null;
  await upsertAppRecordFromDraft({ draft, rawRecord: record.value });
  return {
    uri: record.uri,
    cid: record.cid,
    rkey: record.rkey,
    slug: draft.slug,
  };
}

export async function publishAtstoreListingMigration(
  input: {
    did: string;
    pdsUrl: string;
    profile: ProfileRow;
    sourceRecord: ProfileRecord;
  },
): Promise<AtstoreMigrationPublishResult> {
  const record = buildAtstoreListingFromProfile(
    input.profile,
    input.sourceRecord,
  );
  const rkey = createAtstoreListingRkey();
  const result = await putRecord(
    input.did,
    input.pdsUrl,
    ATSTORE_LISTING_NSID,
    rkey,
    record as unknown as Record<string, unknown>,
  );
  const uri = result.uri || atstoreListingAtUri(input.did, rkey);
  const indexed = await indexAtstoreListingMigrationRecord(
    { uri, cid: result.cid, rkey, value: record },
    input.did,
  );
  if (!indexed) {
    throw new Error(
      "The ATStore record was published but could not be parsed.",
    );
  }
  return indexed;
}

export async function publishAtstoreListingFromProfileRecord(
  input: {
    did: string;
    handle: string;
    pdsUrl: string;
    record: ProfileRecord;
    existingRecord?: AtstoreMigrationRecordRef | null;
  },
): Promise<AtstoreMigrationPublishResult> {
  const existing = asRecord(input.existingRecord?.value);
  const record = buildAtstoreListingFromProfileRecord({
    did: input.did,
    handle: input.handle,
    record: input.record,
    createdAt: typeof existing?.createdAt === "string"
      ? existing.createdAt
      : null,
  });
  const rkey = input.existingRecord?.rkey || createAtstoreListingRkey();
  const result = await putRecord(
    input.did,
    input.pdsUrl,
    ATSTORE_LISTING_NSID,
    rkey,
    record as unknown as Record<string, unknown>,
  );
  const uri = result.uri || atstoreListingAtUri(input.did, rkey);
  const indexed = await indexAtstoreListingMigrationRecord(
    { uri, cid: result.cid, rkey, value: record },
    input.did,
  );
  if (!indexed) {
    throw new Error(
      "The ATStore record was published but could not be parsed.",
    );
  }
  return indexed;
}

export function createAtstoreListingRkey(): string {
  return createAtprotoTid();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function primaryUrl(profile: ProfileRow): string | null {
  return normalizeHttpUrl(profile.mainLink) ??
    normalizeHttpUrl(profile.iosLink) ??
    normalizeHttpUrl(profile.androidLink);
}

function primaryUrlFromRecord(record: ProfileRecord): string | null {
  return normalizeHttpUrl(record.mainLink) ??
    normalizeHttpUrl(record.iosLink) ??
    normalizeHttpUrl(record.androidLink);
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function validIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function taglineForProfile(profile: ProfileRow): string {
  return taglineForText(profile.description, profile.name);
}

function taglineForText(descriptionValue: string, nameValue: string): string {
  const description = descriptionValue.trim().replaceAll(/\s+/g, " ");
  const source = description || `${nameValue.trim()} on the AT Protocol.`;
  return source.length <= 300 ? source : `${source.slice(0, 297).trim()}...`;
}

function slugForProfile(profile: ProfileRow): string {
  return slugForHandleNameOrDid(profile.handle, profile.name, profile.did);
}

function slugForHandleNameOrDid(
  handle: string,
  name: string,
  did: string,
): string {
  const source = handle || name || did;
  const slug = source
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 512);
  return slug || did.replaceAll(/[^a-z0-9._-]+/g, "-").slice(0, 512);
}

function categorySlugForProfile(profile: ProfileRow): string {
  return categorySlugFromSubcategories(profile.subcategories);
}

function categorySlugFromSubcategories(subcategories: string[]): string {
  for (const tag of subcategories) {
    const collection = appCollectionForTag(tag);
    if (collection) return `apps/${collection.key}`;
  }
  const fallback = slugTag(subcategories[0]) || "other";
  return `apps/${fallback}`;
}

function slugTag(value: string | null | undefined): string | null {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug || null;
}

function directoryLinks(
  links: LinkEntry[],
  profile: ProfileRow,
): AtstoreListingLink[] {
  return directoryLinksFromParts(links, {
    handle: profile.handle,
    iosLink: profile.iosLink,
    androidLink: profile.androidLink,
  });
}

function directoryLinksFromParts(
  links: LinkEntry[],
  input: { handle: string; iosLink: string | null; androidLink: string | null },
): AtstoreListingLink[] {
  const out: AtstoreListingLink[] = [];
  addLink(out, "ios", input.iosLink, "App Store");
  addLink(out, "android", input.androidLink, "Google Play");
  for (const link of links) {
    const url = linkUrl(link, input.handle);
    if (!url) continue;
    const label = link.label?.trim() || labelForKind(link.kind);
    addLink(out, link.kind || "other", url, label);
  }
  return dedupeLinks(out).slice(0, 12);
}

function linkUrl(link: LinkEntry, handle: string): string | null {
  if (link.url) return normalizeHttpUrl(link.url);
  if (link.kind === "bsky") {
    return `https://bsky.app/profile/${encodeURIComponent(handle)}`;
  }
  if (link.kind === "tangled") {
    return `https://tangled.org/${encodeURIComponent(handle)}`;
  }
  if (link.kind === "supper") {
    return `https://supper.support/@${encodeURIComponent(handle)}`;
  }
  return null;
}

function labelForKind(kind: string): string {
  if (kind === "bsky") return "Bluesky";
  if (kind === "tangled") return "Tangled";
  if (kind === "supper") return "Supper";
  if (kind === "website") return "Website";
  return "Link";
}

function addLink(
  links: AtstoreListingLink[],
  type: string,
  value: string | null | undefined,
  label: string,
): void {
  const url = normalizeHttpUrl(value);
  if (!url) return;
  links.push({ type: type || "other", url, label });
}

function dedupeLinks(links: AtstoreListingLink[]): AtstoreListingLink[] {
  const out: AtstoreListingLink[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const key = link.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

function uniqueStrings(values: Iterable<string | null | undefined>): string[] {
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

function isAtstoreImageBlob(value: unknown): value is BlobRef {
  if (!value || typeof value !== "object") return false;
  const blob = value as Partial<BlobRef>;
  return blob.$type === "blob" &&
    typeof blob.ref?.$link === "string" &&
    typeof blob.mimeType === "string" &&
    ATSTORE_IMAGE_MIME_TYPES.has(blob.mimeType.toLowerCase()) &&
    typeof blob.size === "number" &&
    Number.isFinite(blob.size) &&
    blob.size > 0;
}
