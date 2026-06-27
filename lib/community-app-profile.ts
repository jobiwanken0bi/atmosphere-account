import {
  COMMUNITY_APP_PROFILE_NSID,
  parseCommunityAppRecord,
} from "./app-lexicons.ts";
import { upsertAppRecordFromDraft } from "./app-directory.ts";
import type { BlobRef, LinkEntry, ProfileRecord } from "./lexicons.ts";
import { getRecordPublic, putRecord } from "./pds.ts";

export interface CommunityAppLink {
  uri: string;
  role?: string;
  label?: string;
}

export interface CommunityAppImage {
  alt: string;
  purpose?: string;
  image?: BlobRef;
  uri?: string;
}

export interface CommunityAppProfileRecord {
  $type?: typeof COMMUNITY_APP_PROFILE_NSID;
  name: string;
  description?: string;
  tags?: string[];
  links: CommunityAppLink[];
  images?: CommunityAppImage[];
  status?: string;
  platforms?: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface CommunityAppProfileRecordRef {
  uri: string;
  cid: string;
  rkey: "self";
  value: unknown;
}

export interface CommunityAppProfilePublishResult {
  uri: string;
  cid: string;
  rkey: "self";
}

const LINK_ROLE_WEBSITE = "community.lexicon.app.defs#linkRoleWebsite";
const LINK_ROLE_APP_STORE = "community.lexicon.app.defs#linkRoleAppStore";
const LINK_ROLE_PLAY_STORE = "community.lexicon.app.defs#linkRolePlayStore";
const PURPOSE_ICON = "community.lexicon.app.defs#purposeIcon";
const PURPOSE_HERO = "community.lexicon.app.defs#purposeHero";
const PURPOSE_SCREENSHOT = "community.lexicon.app.defs#purposeScreenshot";
const PLATFORM_WEB = "community.lexicon.app.defs#platformWeb";
const PLATFORM_IOS = "community.lexicon.app.defs#platformIOS";
const PLATFORM_ANDROID = "community.lexicon.app.defs#platformAndroid";
const STATUS_RELEASED = "community.lexicon.app.defs#released";

export function communityAppProfileAtUri(did: string): string {
  return `at://${did}/${COMMUNITY_APP_PROFILE_NSID}/self`;
}

export async function findExistingCommunityAppProfile(
  did: string,
  pdsUrl: string,
): Promise<CommunityAppProfileRecordRef | null> {
  const record = await getRecordPublic(
    pdsUrl,
    did,
    COMMUNITY_APP_PROFILE_NSID,
    "self",
  );
  if (!record) return null;
  return {
    uri: record.uri,
    cid: record.cid,
    rkey: "self",
    value: record.value,
  };
}

export function buildCommunityAppProfileFromProfileRecord(
  input: {
    did: string;
    handle: string;
    record: ProfileRecord;
    existingRecord?: CommunityAppProfileRecordRef | null;
    now?: Date;
  },
): CommunityAppProfileRecord {
  const now = input.now ?? new Date();
  const existing = asRecord(input.existingRecord?.value);
  const createdAt = validIso(
    typeof existing?.createdAt === "string" ? existing.createdAt : null,
  ) ?? validIso(input.record.createdAt) ?? now.toISOString();
  const links = communityLinksFromProfile(input.record, input.handle);
  const images = communityImagesFromProfile(input.record);
  const tags = uniqueStrings([
    ...(input.record.subcategories ?? []),
    ...(input.record.categories ?? []).filter((category) => category !== "app"),
  ]).slice(0, 10);
  const platforms = communityPlatformsFromProfile(input.record);

  return {
    $type: COMMUNITY_APP_PROFILE_NSID,
    name: input.record.name.trim().slice(0, 200),
    ...(input.record.description.trim()
      ? { description: input.record.description.trim().slice(0, 3000) }
      : {}),
    ...(tags.length > 0 ? { tags } : {}),
    links,
    ...(images.length > 0 ? { images } : {}),
    status: STATUS_RELEASED,
    ...(platforms.length > 0 ? { platforms } : {}),
    createdAt,
    updatedAt: now.toISOString(),
  };
}

export async function indexCommunityAppProfileRecord(
  record: CommunityAppProfileRecordRef,
  repoDid: string,
): Promise<CommunityAppProfilePublishResult | null> {
  const draft = parseCommunityAppRecord({
    uri: record.uri,
    cid: record.cid,
    repoDid,
    rkey: record.rkey,
    collection: COMMUNITY_APP_PROFILE_NSID,
    value: record.value,
  });
  if (!draft) return null;
  await upsertAppRecordFromDraft({ draft, rawRecord: record.value });
  return {
    uri: record.uri,
    cid: record.cid,
    rkey: "self",
  };
}

export async function publishCommunityAppProfileFromProfileRecord(
  input: {
    did: string;
    handle: string;
    pdsUrl: string;
    record: ProfileRecord;
    existingRecord?: CommunityAppProfileRecordRef | null;
  },
): Promise<CommunityAppProfilePublishResult> {
  const record = buildCommunityAppProfileFromProfileRecord(input);
  const result = await putRecord(
    input.did,
    input.pdsUrl,
    COMMUNITY_APP_PROFILE_NSID,
    "self",
    record as unknown as Record<string, unknown>,
  );
  const uri = result.uri || communityAppProfileAtUri(input.did);
  const indexed = await indexCommunityAppProfileRecord(
    { uri, cid: result.cid, rkey: "self", value: record },
    input.did,
  );
  if (!indexed) {
    throw new Error(
      "The community app profile was published but could not be parsed.",
    );
  }
  return indexed;
}

function communityLinksFromProfile(
  record: ProfileRecord,
  handle: string,
): CommunityAppLink[] {
  const out: CommunityAppLink[] = [];
  addCommunityLink(out, record.mainLink, "Website", LINK_ROLE_WEBSITE);
  addCommunityLink(out, record.iosLink, "App Store", LINK_ROLE_APP_STORE);
  addCommunityLink(
    out,
    record.androidLink,
    "Play Store",
    LINK_ROLE_PLAY_STORE,
  );
  for (const link of record.links ?? []) {
    const url = linkUrl(link, handle);
    if (!url) continue;
    addCommunityLink(
      out,
      url,
      link.label?.trim() || labelForKind(link.kind),
      roleForKind(link.kind),
    );
  }
  return dedupeLinks(out).slice(0, 12);
}

function communityImagesFromProfile(
  record: ProfileRecord,
): CommunityAppImage[] {
  const out: CommunityAppImage[] = [];
  const name = record.name.trim() || "App";
  if (record.avatar) {
    out.push({
      image: record.avatar,
      purpose: PURPOSE_ICON,
      alt: `${name} icon`,
    });
  }
  if (record.banner) {
    out.push({
      image: record.banner,
      purpose: PURPOSE_HERO,
      alt: `${name} banner`,
    });
  }
  for (const [index, screenshot] of (record.screenshots ?? []).entries()) {
    if (!screenshot.image) continue;
    out.push({
      image: screenshot.image,
      purpose: PURPOSE_SCREENSHOT,
      alt: `${name} screenshot ${index + 1}`,
    });
  }
  return out.slice(0, 24);
}

function communityPlatformsFromProfile(record: ProfileRecord): string[] {
  return uniqueStrings([
    record.mainLink ? PLATFORM_WEB : null,
    record.iosLink ? PLATFORM_IOS : null,
    record.androidLink ? PLATFORM_ANDROID : null,
  ]);
}

function addCommunityLink(
  links: CommunityAppLink[],
  value: string | null | undefined,
  label: string,
  role?: string,
): void {
  const uri = normalizeHttpUrl(value);
  if (!uri) return;
  links.push({ uri, label, ...(role ? { role } : {}) });
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

function roleForKind(kind: string): string | undefined {
  return kind === "website" ? LINK_ROLE_WEBSITE : undefined;
}

function dedupeLinks(links: CommunityAppLink[]): CommunityAppLink[] {
  const out: CommunityAppLink[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const key = link.uri.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
