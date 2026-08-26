import { createAtprotoTid, isAtprotoTid } from "./tid.ts";

/**
 * Standard.site is the record model ATStore consumes for product publications
 * and their update documents. These constants intentionally replace the
 * legacy com.atmosphereaccount.registry.update collection for new writes.
 */
export const STANDARD_SITE_PUBLICATION_NSID = "site.standard.publication";
export const STANDARD_SITE_DOCUMENT_NSID = "site.standard.document";

/**
 * Standard.site has no dedicated version property. Atmosphere preserves the
 * existing What's New version in a tag with this exact, lowercase prefix.
 */
export const STANDARD_SITE_VERSION_TAG_PREFIX = "version:";
export const ATMOSPHERE_STANDARD_SITE_UPDATE_SOURCE_PREFIX =
  "standard_site_atmosphere:";
export const ATMOSPHERE_STANDARD_SITE_APP_TAG_PREFIX = "atmosphere-app:";

const DID_RE = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+(?:\:[a-zA-Z0-9._:%-]+)*$/;
const DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_NAME_BYTES = 5_000;
const MAX_NAME_GRAPHEMES = 500;
const MAX_DESCRIPTION_BYTES = 30_000;
const MAX_DESCRIPTION_GRAPHEMES = 3_000;
const MAX_TAG_BYTES = 1_280;
const MAX_TAG_GRAPHEMES = 128;
const MAX_ATSTORE_TEXT_CONTENT = 100_000;
const MAX_LEGACY_VERSION_LENGTH = 32;

export interface StandardSiteBlobRef {
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
}

export interface StandardSitePublicationPreferences {
  showInDiscover?: boolean;
}

/**
 * The official publication fields used by Atmosphere and consumed by ATStore.
 * Standard.site records remain extensible; unsupported extension fields are
 * deliberately ignored by the parser.
 */
export interface StandardSitePublicationRecord {
  $type: typeof STANDARD_SITE_PUBLICATION_NSID;
  url: string;
  name: string;
  description?: string;
  icon?: StandardSiteBlobRef;
  preferences?: StandardSitePublicationPreferences;
}

/**
 * ATStore requires a non-empty path to derive a canonical permalink even
 * though path is optional in the base Standard.site lexicon.
 */
export interface StandardSiteDocumentRecord {
  $type: typeof STANDARD_SITE_DOCUMENT_NSID;
  site: string;
  path: string;
  title: string;
  description?: string;
  textContent?: string;
  tags?: string[];
  coverImage?: StandardSiteBlobRef;
  publishedAt: string;
  updatedAt?: string;
}

export type StandardSiteValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface BuildStandardSitePublicationInput {
  url: string;
  name: string;
  description?: string | null;
  icon?: StandardSiteBlobRef | null;
  showInDiscover?: boolean;
}

export type StandardSiteTimestamp = string | number | Date;

/** Flat input matching the fields stored by the existing What's New editor. */
export interface BuildStandardSiteDocumentInput {
  site: string;
  path: string;
  title: string;
  body: string;
  version?: string | null;
  createdAt: StandardSiteTimestamp;
  updatedAt?: StandardSiteTimestamp | null;
  coverImage?: StandardSiteBlobRef | null;
  tags?: readonly string[];
}

export function createStandardSiteRkey(nowMs = Date.now()): string {
  return createAtprotoTid(nowMs);
}

export function isStandardSiteRkey(value: string): boolean {
  return isAtprotoTid(value);
}

export function standardSitePublicationUri(
  did: string,
  rkey: string,
): string {
  assertDidAndTid(did, rkey);
  return `at://${did}/${STANDARD_SITE_PUBLICATION_NSID}/${rkey}`;
}

export function standardSitePublicationRkeyFromUri(
  uri: string,
  did: string,
): string | null {
  const prefix = `at://${did}/${STANDARD_SITE_PUBLICATION_NSID}/`;
  if (!uri.startsWith(prefix)) return null;
  const rkey = uri.slice(prefix.length);
  return rkey && !rkey.includes("/") && isAtprotoTid(rkey) ? rkey : null;
}

export function standardSiteDocumentUri(did: string, rkey: string): string {
  assertDidAndTid(did, rkey);
  return `at://${did}/${STANDARD_SITE_DOCUMENT_NSID}/${rkey}`;
}

/**
 * A self-hosted PDS response is not authoritative for the record identity we
 * just addressed. Accept omitted/empty URIs for compatibility with older PDS
 * implementations, reject any non-empty mismatch, and always persist the
 * locally reconstructed DID/collection/rkey URI.
 */
export function verifiedStandardSiteWriteUri(
  expectedUri: string,
  returnedUri: unknown,
): string {
  if (
    returnedUri !== undefined && returnedUri !== null && returnedUri !== "" &&
    returnedUri !== expectedUri
  ) {
    throw new Error("PDS returned a mismatched Standard.site record URI");
  }
  return expectedUri;
}

/**
 * Public Atmosphere permalink used by ATStore for a What's New document.
 * Both dynamic values are encoded as URL components and the document key must
 * be a TID, matching the Standard.site lexicons' `key: tid` declaration.
 */
export function standardSiteUpdatePath(slug: string, rkey: string): string {
  const normalizedSlug = slug.trim();
  if (!normalizedSlug) throw new Error("slug must be non-empty");
  if (!isAtprotoTid(rkey)) throw new Error("rkey must be an AT Protocol TID");
  return `/apps/${encodeURIComponent(normalizedSlug)}?update=${
    encodeURIComponent(rkey)
  }`;
}

/** Canonical publication URL Atmosphere owns for one directory listing. */
export function atmosphereStandardSitePublicationUrl(
  siteUrl: string,
  slug: string,
): string {
  const normalizedSlug = slug.trim();
  if (!normalizedSlug) throw new Error("slug must be non-empty");
  return new URL(
    `/apps/${encodeURIComponent(normalizedSlug)}`,
    siteUrl,
  ).href;
}

/**
 * Keep Atmosphere-authored update rows app-specific without changing the
 * shared profile_update schema. Generic Standard.site documents retain the
 * `standard_site` source and can still mirror ATStore's DID-level feed.
 */
export function atmosphereStandardSiteUpdateSource(appId: string): string {
  const normalizedAppId = appId.trim();
  if (!normalizedAppId) throw new Error("appId must be non-empty");
  return ATMOSPHERE_STANDARD_SITE_UPDATE_SOURCE_PREFIX + normalizedAppId;
}

export function isAtmosphereStandardSiteUpdateSource(
  source: string,
  appId: string,
): boolean {
  return source === atmosphereStandardSiteUpdateSource(appId);
}

/** Durable app identity embedded in documents independently of mutable slugs. */
export function atmosphereStandardSiteAppTag(appId: string): string {
  const normalizedAppId = appId.trim();
  if (!normalizedAppId) throw new Error("appId must be non-empty");
  const tag = ATMOSPHERE_STANDARD_SITE_APP_TAG_PREFIX + normalizedAppId;
  if (
    [...tag].length > MAX_TAG_GRAPHEMES ||
    new TextEncoder().encode(tag).byteLength > MAX_TAG_BYTES
  ) {
    throw new Error("appId is too long for a Standard.site tag");
  }
  return tag;
}

export function atmosphereStandardSiteAppIdFromTags(
  tags: readonly string[] | null | undefined,
): string | null {
  for (const tag of tags ?? []) {
    if (!tag.startsWith(ATMOSPHERE_STANDARD_SITE_APP_TAG_PREFIX)) continue;
    const appId = tag.slice(ATMOSPHERE_STANDARD_SITE_APP_TAG_PREFIX.length)
      .trim();
    if (appId) return appId;
  }
  return null;
}

/**
 * An editable document must point at the exact publication and canonical path
 * Atmosphere created for this app. A product repo may contain unrelated
 * Standard.site blogs, so collection + repository ownership is insufficient.
 */
export function isAtmosphereStandardSiteDocument(
  record: Pick<StandardSiteDocumentRecord, "site" | "path">,
  input: { publicationUri: string; slug: string; rkey: string },
): boolean {
  return record.site === input.publicationUri &&
    record.path === standardSiteUpdatePath(input.slug, input.rkey);
}

/**
 * Validate the immutable document marker separately from its mutable app
 * slug. This lets a listing retain management of old release notes after a
 * rename while still requiring an exact Atmosphere publication/path pair.
 */
export function atmosphereStandardSiteDocumentSlug(
  record: Pick<StandardSiteDocumentRecord, "path">,
  input: { publicationUrl: string; siteUrl: string; rkey: string },
): string | null {
  let publication: URL;
  let site: URL;
  try {
    publication = new URL(input.publicationUrl);
    site = new URL(input.siteUrl);
  } catch {
    return null;
  }
  if (
    publication.origin !== site.origin || publication.search ||
    publication.hash || !publication.pathname.startsWith("/apps/")
  ) {
    return null;
  }
  const encodedSlug = publication.pathname.slice("/apps/".length);
  if (!encodedSlug || encodedSlug.includes("/")) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(encodedSlug);
  } catch {
    return null;
  }
  if (
    !slug || atmosphereStandardSitePublicationUrl(input.siteUrl, slug) !==
      publication.href ||
    record.path !== standardSiteUpdatePath(slug, input.rkey)
  ) {
    return null;
  }
  return slug;
}

/** Mirrors ATStore's publication-url + document-path permalink resolution. */
export function canonicalStandardSiteDocumentUrl(
  publicationUrl: string,
  documentPath: string,
): string | null {
  const base = normalizePublicationUrl(publicationUrl);
  const path = normalizeDocumentPath(documentPath);
  if (!base || !path) return null;
  try {
    return new URL(path, `${base}/`).href;
  } catch {
    return null;
  }
}

export function standardSiteVersionTag(
  version: string | null | undefined,
): string | null {
  const normalized = version?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > MAX_LEGACY_VERSION_LENGTH) {
    throw new Error(`version must be <=${MAX_LEGACY_VERSION_LENGTH} chars`);
  }
  return `${STANDARD_SITE_VERSION_TAG_PREFIX}${normalized}`;
}

export function standardSiteVersionFromTags(
  tags: readonly string[] | null | undefined,
): string | null {
  for (const tag of tags ?? []) {
    if (!tag.startsWith(STANDARD_SITE_VERSION_TAG_PREFIX)) continue;
    const version = tag.slice(STANDARD_SITE_VERSION_TAG_PREFIX.length).trim();
    if (version && version.length <= MAX_LEGACY_VERSION_LENGTH) return version;
  }
  return null;
}

export function buildStandardSitePublication(
  input: BuildStandardSitePublicationInput,
): StandardSitePublicationRecord {
  const candidate: Record<string, unknown> = {
    $type: STANDARD_SITE_PUBLICATION_NSID,
    url: input.url,
    name: input.name,
    ...(input.description != null ? { description: input.description } : {}),
    ...(input.icon ? { icon: input.icon } : {}),
    ...(input.showInDiscover !== undefined
      ? { preferences: { showInDiscover: input.showInDiscover } }
      : {}),
  };
  return valueOrThrow(
    validateStandardSitePublication(candidate),
    "invalid Standard.site publication",
  );
}

/**
 * Map the existing What's New fields to a Standard.site document:
 * title -> title, body -> description + plaintext, createdAt -> publishedAt,
 * updatedAt -> updatedAt, and version -> the documented version tag.
 */
export function buildStandardSiteDocument(
  input: BuildStandardSiteDocumentInput,
): StandardSiteDocumentRecord {
  const versionTag = standardSiteVersionTag(input.version);
  const tags = uniqueStrings([
    ...(input.tags ?? []).filter((tag) =>
      !tag.startsWith(STANDARD_SITE_VERSION_TAG_PREFIX)
    ),
    ...(versionTag ? [versionTag] : []),
  ]);
  const candidate: Record<string, unknown> = {
    $type: STANDARD_SITE_DOCUMENT_NSID,
    site: input.site,
    path: input.path,
    title: input.title,
    description: input.body,
    textContent: input.body,
    ...(tags.length > 0 ? { tags } : {}),
    ...(input.coverImage ? { coverImage: input.coverImage } : {}),
    publishedAt: timestampToIso(input.createdAt, "createdAt"),
    ...(input.updatedAt != null
      ? { updatedAt: timestampToIso(input.updatedAt, "updatedAt") }
      : {}),
  };
  return valueOrThrow(
    validateStandardSiteDocument(candidate),
    "invalid Standard.site document",
  );
}

export function validateStandardSitePublication(
  input: unknown,
): StandardSiteValidationResult<StandardSitePublicationRecord> {
  const value = asRecord(input);
  if (!value) return invalid("record must be an object");
  if (!validType(value.$type, STANDARD_SITE_PUBLICATION_NSID)) {
    return invalid(`$type must be ${STANDARD_SITE_PUBLICATION_NSID}`);
  }
  const url = normalizePublicationUrl(value.url);
  if (!url) return invalid("url must be a non-empty http(s) URL");
  const name = normalizedLimitedString(
    value.name,
    MAX_NAME_BYTES,
    MAX_NAME_GRAPHEMES,
  );
  if (!name) return invalid("name must be a non-empty Standard.site name");
  const description = optionalLimitedString(
    value.description,
    MAX_DESCRIPTION_BYTES,
    MAX_DESCRIPTION_GRAPHEMES,
  );
  if (!description.ok) return description;
  const icon = optionalImageBlob(value.icon);
  if (!icon.ok) return icon;

  let preferences: StandardSitePublicationPreferences | undefined;
  if (value.preferences !== undefined) {
    const raw = asRecord(value.preferences);
    if (!raw) return invalid("preferences must be an object");
    if (
      raw.showInDiscover !== undefined &&
      typeof raw.showInDiscover !== "boolean"
    ) {
      return invalid("preferences.showInDiscover must be a boolean");
    }
    preferences = raw.showInDiscover === undefined
      ? undefined
      : { showInDiscover: raw.showInDiscover };
  }

  return {
    ok: true,
    value: {
      $type: STANDARD_SITE_PUBLICATION_NSID,
      url,
      name,
      ...(description.value ? { description: description.value } : {}),
      ...(icon.value ? { icon: icon.value } : {}),
      ...(preferences ? { preferences } : {}),
    },
  };
}

export function parseStandardSitePublication(
  input: unknown,
): StandardSitePublicationRecord | null {
  const result = validateStandardSitePublication(input);
  return result.ok ? result.value : null;
}

export function validateStandardSiteDocument(
  input: unknown,
): StandardSiteValidationResult<StandardSiteDocumentRecord> {
  const value = asRecord(input);
  if (!value) return invalid("record must be an object");
  if (!validType(value.$type, STANDARD_SITE_DOCUMENT_NSID)) {
    return invalid(`$type must be ${STANDARD_SITE_DOCUMENT_NSID}`);
  }
  const site = normalizeDocumentSite(value.site);
  if (!site) {
    return invalid("site must be a publication AT URI or an http(s) URL");
  }
  const path = normalizeDocumentPath(value.path);
  if (!path) return invalid("path must be a non-empty relative URL path");
  const title = normalizedLimitedString(
    value.title,
    MAX_NAME_BYTES,
    MAX_NAME_GRAPHEMES,
  );
  if (!title) return invalid("title must be a non-empty Standard.site title");
  const publishedAt = normalizeDatetime(value.publishedAt);
  if (!publishedAt) return invalid("publishedAt must be a valid datetime");
  const updatedAt = value.updatedAt === undefined
    ? undefined
    : normalizeDatetime(value.updatedAt);
  if (value.updatedAt !== undefined && !updatedAt) {
    return invalid("updatedAt must be a valid datetime");
  }
  const description = optionalLimitedString(
    value.description,
    MAX_DESCRIPTION_BYTES,
    MAX_DESCRIPTION_GRAPHEMES,
  );
  if (!description.ok) return description;
  const textContent = optionalPlaintext(value.textContent);
  if (!textContent.ok) return textContent;
  const tags = optionalTags(value.tags);
  if (!tags.ok) return tags;
  const coverImage = optionalImageBlob(value.coverImage);
  if (!coverImage.ok) return coverImage;

  return {
    ok: true,
    value: {
      $type: STANDARD_SITE_DOCUMENT_NSID,
      site,
      path,
      title,
      ...(description.value ? { description: description.value } : {}),
      ...(textContent.value ? { textContent: textContent.value } : {}),
      ...(tags.value?.length ? { tags: tags.value } : {}),
      ...(coverImage.value ? { coverImage: coverImage.value } : {}),
      publishedAt,
      ...(updatedAt ? { updatedAt } : {}),
    },
  };
}

export function parseStandardSiteDocument(
  input: unknown,
): StandardSiteDocumentRecord | null {
  const result = validateStandardSiteDocument(input);
  return result.ok ? result.value : null;
}

function normalizePublicationUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function normalizeDocumentSite(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const site = value.trim();
  if (site.startsWith("at://")) {
    const match = site.match(
      /^at:\/\/(did:[^/?#\s]+)\/site\.standard\.publication\/([^/?#\s]+)$/,
    );
    if (!match || !DID_RE.test(match[1]) || !isAtprotoTid(match[2])) {
      return null;
    }
    return site;
  }
  return normalizePublicationUrl(site);
}

function normalizeDocumentPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  if (raw.startsWith("//") || raw.includes("\\") || hasControlCharacter(raw)) {
    return null;
  }
  const relative = raw.startsWith("/") ? raw : `/${raw}`;
  try {
    const url = new URL(relative, "https://standard-site.invalid/");
    if (url.origin !== "https://standard-site.invalid") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function timestampToIso(value: StandardSiteTimestamp, label: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid`);
  return date.toISOString();
}

function normalizeDatetime(value: unknown): string | null {
  if (typeof value !== "string" || !DATETIME_RE.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedLimitedString(
  value: unknown,
  maxBytes: number,
  maxGraphemes: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (new TextEncoder().encode(normalized).byteLength > maxBytes) return null;
  if ([...normalized].length > maxGraphemes) return null;
  return normalized;
}

function optionalLimitedString(
  value: unknown,
  maxBytes: number,
  maxGraphemes: number,
): StandardSiteValidationResult<string | undefined> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  const normalized = normalizedLimitedString(value, maxBytes, maxGraphemes);
  return normalized
    ? { ok: true, value: normalized }
    : invalid("string exceeds Standard.site limits");
}

function optionalPlaintext(
  value: unknown,
): StandardSiteValidationResult<string | undefined> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") return invalid("textContent must be a string");
  const normalized = value.trim();
  if (normalized.length > MAX_ATSTORE_TEXT_CONTENT) {
    return invalid(`textContent must be <=${MAX_ATSTORE_TEXT_CONTENT} chars`);
  }
  return { ok: true, value: normalized || undefined };
}

function optionalTags(
  value: unknown,
): StandardSiteValidationResult<string[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) return invalid("tags must be an array");
  const tags: string[] = [];
  for (const raw of value) {
    const tag = normalizedLimitedString(
      raw,
      MAX_TAG_BYTES,
      MAX_TAG_GRAPHEMES,
    );
    if (!tag) return invalid("tags contain an invalid item");
    if (!tags.includes(tag)) tags.push(tag);
  }
  return { ok: true, value: tags.length ? tags : undefined };
}

function optionalImageBlob(
  value: unknown,
): StandardSiteValidationResult<StandardSiteBlobRef | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const blob = asRecord(value);
  const ref = asRecord(blob?.ref);
  if (
    !blob || blob.$type !== "blob" || !ref ||
    typeof ref.$link !== "string" || !ref.$link ||
    typeof blob.mimeType !== "string" ||
    !blob.mimeType.startsWith("image/") ||
    !Number.isSafeInteger(blob.size) || Number(blob.size) < 0 ||
    Number(blob.size) > 1_000_000
  ) {
    return invalid("image must be a valid Standard.site blob <=1MB");
  }
  return {
    ok: true,
    value: {
      $type: "blob",
      ref: { $link: ref.$link },
      mimeType: blob.mimeType,
      size: Number(blob.size),
    },
  };
}

function validType(value: unknown, expected: string): boolean {
  return value === undefined || value === expected;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function invalid(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function valueOrThrow<T>(
  result: StandardSiteValidationResult<T>,
  label: string,
): T {
  if (result.ok) return result.value;
  throw new Error(`${label}: ${result.error}`);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) <= 0x1f);
}

function assertDidAndTid(did: string, rkey: string): void {
  if (!DID_RE.test(did)) throw new Error("did must be valid");
  if (!isAtprotoTid(rkey)) throw new Error("rkey must be an AT Protocol TID");
}
