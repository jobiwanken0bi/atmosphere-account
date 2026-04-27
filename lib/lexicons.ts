/**
 * Hand-written TypeScript types and runtime validators for the
 * com.atmosphereaccount.registry.* lexicons. Keeping these hand-written
 * (rather than running @atproto/lex-cli) avoids a Node-only build step
 * and keeps the surface area small and Deno-native.
 *
 * Source of truth: lexicons/com/atmosphereaccount/registry/*.json
 */

export const PROFILE_NSID = "com.atmosphereaccount.registry.profile";
export const REVIEW_NSID = "com.atmosphereaccount.registry.review";
export const UPDATE_NSID = "com.atmosphereaccount.registry.update";
export const FEATURED_NSID = "com.atmosphereaccount.registry.featured";
/**
 * Permission-set lexicon NSID requested via the OAuth `include:` scope.
 * The set itself only references the profile collection + image blobs;
 * see `lexicons/com/atmosphereaccount/registry/fullPermissions.json`.
 */
export const PERMISSION_SET_NSID =
  "com.atmosphereaccount.registry.fullPermissions";

export const REGISTRY_NSIDS = [
  PROFILE_NSID,
  REVIEW_NSID,
  UPDATE_NSID,
  FEATURED_NSID,
  PERMISSION_SET_NSID,
] as const;

export const PROFILE_TYPES = ["project", "user"] as const;
export type ProfileType = typeof PROFILE_TYPES[number];

export const CATEGORIES = [
  "app",
  "accountProvider",
  "moderator",
  "infrastructure",
  "developerTool",
] as const;
export type Category = typeof CATEGORIES[number];
export const PUBLIC_CATEGORIES = [
  "app",
  "accountProvider",
] as const satisfies readonly Category[];

export const APP_SUBCATEGORIES = [
  "microblog",
  "photo",
  "video",
  "blogging",
  "music",
  "events",
  "clients",
  "tools",
  "social",
  "reading",
  "productivity",
  "research",
  "science",
  "reviews",
  "gaming",
  "community",
  "food",
  "location",
  "liveStreaming",
  "niche",
  "content",
  "art",
] as const;
export type AppSubcategory = typeof APP_SUBCATEGORIES[number];

export const FEATURED_BADGES = ["verified", "official"] as const;
export type FeaturedBadge = typeof FEATURED_BADGES[number];

/**
 * Recognised link kinds. The lexicon stores `kind` as an open string with
 * `knownValues`, so adding more atmosphere services or custom kinds later
 * is a non-breaking change.
 *
 *   bsky     — a Bluesky-style profile button. Requires `clientId`; URL is
 *              derived from clientId + the user's current handle.
 *   tangled  — a Tangled profile button. URL defaults to tangled.org/<handle>
 *              but the user may override (`url`) to point at a project repo.
 *   supper   — a Supper (supper.support/@handle) button. URL is derived;
 *              `url` override is allowed.
 *   website  — a plain external website button. Requires `url`.
 *   other    — a custom button with a user-provided `label` + `url`.
 */
export const LINK_KINDS = [
  "bsky",
  "tangled",
  "supper",
  "website",
  "other",
] as const;
export type LinkKind = typeof LINK_KINDS[number];

/**
 * Atmosphere kinds derive their URL from the user's handle. They may
 * still carry an explicit `url` override (tangled / supper). `bsky`
 * additionally requires `clientId` to pick which web client to send
 * visitors to.
 */
export const ATMOSPHERE_LINK_KINDS = ["bsky", "tangled", "supper"] as const;
export type AtmosphereLinkKind = typeof ATMOSPHERE_LINK_KINDS[number];

export interface LinkEntry {
  kind: string;
  /** Required for kind="website" / "other"; optional for atmosphere kinds. */
  url?: string;
  /** Required for kind="bsky". Identifies the Bluesky-compatible client. */
  clientId?: string;
  /** Required for kind="other"; ignored for atmosphere kinds. */
  label?: string;
}

export interface BlobRef {
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
}

export interface ScreenshotEntry {
  image: BlobRef;
}

export interface ProfileRecord {
  $type?: typeof PROFILE_NSID;
  profileType?: ProfileType;
  name: string;
  description: string;
  /**
   * Primary web destination URL for the project. Rendered as the Web
   * button inside the public profile card when present.
   */
  mainLink?: string;
  /** Optional App Store URL for projects with an iOS app. */
  iosLink?: string;
  /** Optional Google Play / Android distribution URL for projects with an Android app. */
  androidLink?: string;
  avatar?: BlobRef;
  /**
   * Optional vector icon (SVG) intended for developer use — sign-in
   * badges, app showcases, programmatic listings. Not displayed on the
   * public profile. Must be `image/svg+xml`; we sanitise on upload.
   */
  icon?: BlobRef;
  /** Optional detail-page screenshots. Stored as PDS blobs and lazy-loaded
   *  only on the profile detail page. */
  screenshots?: ScreenshotEntry[];
  /** All categories that apply to the project (1-4). The first item is the
   *  primary category used for sort/grouping in lists. */
  categories?: string[];
  subcategories?: string[];
  /**
   * Outbound buttons shown on the public profile after the Web / iOS /
   * Android app links (Atmosphere link toggles and any custom links).
   * Legacy `website` entries are still valid for older records, but the
   * current form no longer emits them.
   */
  links?: LinkEntry[];
  createdAt: string;
}

export interface ReviewRecord {
  $type?: typeof REVIEW_NSID;
  subject: string;
  subjectUri?: string;
  rating: 1 | 2 | 3 | 4 | 5;
  body?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface UpdateRecord {
  $type?: typeof UPDATE_NSID;
  title: string;
  body: string;
  version?: string;
  tangledCommitUrl?: string;
  tangledRepoUrl?: string;
  source?: "manual" | "tangled" | string;
  createdAt: string;
  updatedAt?: string;
}

export interface FeaturedEntry {
  did: string;
  badges?: FeaturedBadge[] | string[];
  position?: number;
}

export interface FeaturedRecord {
  $type?: typeof FEATURED_NSID;
  entries: FeaturedEntry[];
}

const DID_RE = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;
const AT_URI_RE =
  /^at:\/\/did:[a-z]+:[a-zA-Z0-9._:%-]+\/[a-zA-Z0-9.:-]+\/[a-zA-Z0-9._~:-]+$/;

function isStr(v: unknown, max?: number): v is string {
  if (typeof v !== "string") return false;
  if (max !== undefined && v.length > max) return false;
  return true;
}

function isUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isBlob(v: unknown): v is BlobRef {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  if (b.$type !== "blob") return false;
  const ref = b.ref as Record<string, unknown> | undefined;
  if (!ref || typeof ref.$link !== "string") return false;
  if (typeof b.mimeType !== "string") return false;
  if (typeof b.size !== "number") return false;
  return true;
}

function validateScreenshots(
  input: unknown,
): { ok: true; value: ScreenshotEntry[] } | { ok: false; error: string } {
  if (input === undefined) return { ok: true, value: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: "screenshots: must be an array" };
  }
  if (input.length > 4) {
    return { ok: false, error: "screenshots: at most 4" };
  }
  const out: ScreenshotEntry[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "screenshots: items must be objects" };
    }
    const image = (raw as Record<string, unknown>).image;
    if (!isBlob(image)) {
      return { ok: false, error: "screenshots[].image: invalid blob ref" };
    }
    if (
      image.mimeType !== "image/png" &&
      image.mimeType !== "image/jpeg" &&
      image.mimeType !== "image/webp"
    ) {
      return {
        ok: false,
        error: "screenshots[].image: must be png, jpeg, or webp",
      };
    }
    if (image.size > 5_000_000) {
      return { ok: false, error: "screenshots[].image: max 5MB" };
    }
    if (seen.has(image.ref.$link)) continue;
    seen.add(image.ref.$link);
    out.push({ image });
  }
  return { ok: true, value: out };
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

/**
 * Normalise + validate a links[] array.
 *   - Drops obviously empty entries.
 *   - Caps at 12 to match the lexicon.
 *   - Enforces per-kind constraints: clientId required for "bsky",
 *     url required for "website" / "other" / unknown kinds, label
 *     required for "other".
 *   - Dedupes bsky entries by clientId; dedupes URL-bearing entries
 *     by URL. Atmosphere kinds without a URL are kept as-is (their
 *     identity is `kind` for tangled/supper, or `kind+clientId` for
 *     bsky).
 */
function normalizeLinks(input: unknown): {
  ok: true;
  value: LinkEntry[];
} | { ok: false; error: string } {
  if (input === undefined) return { ok: true, value: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: "links: must be an array" };
  }
  if (input.length > 12) return { ok: false, error: "links: at most 12" };

  const seenUrls = new Set<string>();
  const seenBskyClients = new Set<string>();
  const seenAtmosphereKinds = new Set<string>(); // tangled / supper without url
  const out: LinkEntry[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "links: items must be objects" };
    }
    const e = raw as Record<string, unknown>;

    if (!isStr(e.kind, 32)) {
      return { ok: false, error: "links[].kind: string required" };
    }
    const kind = (e.kind as string).trim();
    if (!kind) {
      return { ok: false, error: "links[].kind: non-empty string required" };
    }

    const entry: LinkEntry = { kind };

    // url: required for website/other (and unknown kinds); optional for
    // atmosphere kinds.
    const isAtmosphere = (ATMOSPHERE_LINK_KINDS as readonly string[])
      .includes(kind);
    if (e.url !== undefined && e.url !== null && e.url !== "") {
      if (!isUrl(e.url)) {
        return {
          ok: false,
          error: `links[].url (${kind}): must be http(s) URL`,
        };
      }
      entry.url = (e.url as string).trim();
    } else if (!isAtmosphere) {
      return {
        ok: false,
        error: `links[]: kind="${kind}" requires a url`,
      };
    }

    // clientId: required for bsky, ignored otherwise.
    if (kind === "bsky") {
      if (!isStr(e.clientId, 64) || !(e.clientId as string).trim()) {
        return {
          ok: false,
          error: 'links[]: kind="bsky" requires clientId',
        };
      }
      entry.clientId = (e.clientId as string).trim();
    }

    // label: required for other, optional otherwise.
    if (e.label !== undefined && e.label !== null && e.label !== "") {
      if (!isStr(e.label, 64)) {
        return { ok: false, error: "links[].label: string <=64" };
      }
      entry.label = (e.label as string).trim();
    }
    if (kind === "other" && !entry.label) {
      return {
        ok: false,
        error: 'links[]: kind="other" requires a label',
      };
    }

    // Dedupe.
    if (kind === "bsky") {
      const key = `bsky:${entry.clientId}`;
      if (seenBskyClients.has(key)) continue;
      seenBskyClients.add(key);
    } else if (entry.url) {
      if (seenUrls.has(entry.url)) continue;
      seenUrls.add(entry.url);
    } else if (isAtmosphere) {
      if (seenAtmosphereKinds.has(kind)) continue;
      seenAtmosphereKinds.add(kind);
    }

    out.push(entry);
  }

  return { ok: true, value: out };
}

export function validateProfile(
  input: unknown,
): ValidationResult<ProfileRecord> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "record must be an object" };
  }
  const v = input as Record<string, unknown>;
  const profileType: ProfileType = v.profileType === "user"
    ? "user"
    : "project";

  if (
    !isStr(v.name) || (v.name as string).length < 1 ||
    (v.name as string).length > 60
  ) {
    return { ok: false, error: "name: 1..60 chars required" };
  }
  const normalizedDescription = typeof v.description === "string"
    ? v.description.trim()
    : "";
  if (normalizedDescription.length > 500) {
    return { ok: false, error: "description: must be <=500 chars" };
  }
  // mainLink: optional, but if present must parse as an http(s) URL <=512
  // chars. The registry UI / API require at least one primary destination
  // among mainLink, iosLink, and androidLink on new writes.
  let normalizedMainLink: string | undefined;
  if (v.mainLink !== undefined && v.mainLink !== null && v.mainLink !== "") {
    if (!isStr(v.mainLink, 512) || !isUrl(v.mainLink)) {
      return { ok: false, error: "mainLink: must be an http(s) URL <=512" };
    }
    normalizedMainLink = (v.mainLink as string).trim();
  }
  let normalizedIosLink: string | undefined;
  if (v.iosLink !== undefined && v.iosLink !== null && v.iosLink !== "") {
    if (!isStr(v.iosLink, 512) || !isUrl(v.iosLink)) {
      return { ok: false, error: "iosLink: must be an http(s) URL <=512" };
    }
    normalizedIosLink = (v.iosLink as string).trim();
  }
  let normalizedAndroidLink: string | undefined;
  if (
    v.androidLink !== undefined && v.androidLink !== null &&
    v.androidLink !== ""
  ) {
    if (!isStr(v.androidLink, 512) || !isUrl(v.androidLink)) {
      return {
        ok: false,
        error: "androidLink: must be an http(s) URL <=512",
      };
    }
    normalizedAndroidLink = (v.androidLink as string).trim();
  }
  // categories[]: required for projects, optional for user profiles.
  // The first entry is treated as the primary category by the UI.
  let normalizedCategories: string[] | undefined;
  {
    if (!Array.isArray(v.categories) || v.categories.length === 0) {
      if (profileType === "project") {
        return { ok: false, error: "categories: non-empty array required" };
      }
      normalizedCategories = undefined;
    } else {
      if (v.categories.length > 4) {
        return { ok: false, error: "categories: at most 4" };
      }
      const seen = new Set<string>();
      const out: string[] = [];
      for (const c of v.categories) {
        if (!isStr(c) || !(CATEGORIES as readonly string[]).includes(c)) {
          return {
            ok: false,
            error: `categories: items must be one of ${CATEGORIES.join(", ")}`,
          };
        }
        if (!seen.has(c)) {
          seen.add(c);
          out.push(c);
        }
      }
      normalizedCategories = out;
    }
  }
  if (!isStr(v.createdAt)) {
    return { ok: false, error: "createdAt required (ISO 8601)" };
  }
  if (v.avatar !== undefined && !isBlob(v.avatar)) {
    return { ok: false, error: "avatar: invalid blob ref" };
  }
  if (v.icon !== undefined) {
    if (!isBlob(v.icon)) {
      return { ok: false, error: "icon: invalid blob ref" };
    }
    if ((v.icon as BlobRef).mimeType !== "image/svg+xml") {
      return { ok: false, error: "icon: must be image/svg+xml" };
    }
  }
  const screenshotsRes = validateScreenshots(v.screenshots);
  if (!screenshotsRes.ok) return { ok: false, error: screenshotsRes.error };
  const linksRes = normalizeLinks(v.links);
  if (!linksRes.ok) return { ok: false, error: linksRes.error };
  if (v.subcategories !== undefined) {
    if (!Array.isArray(v.subcategories) || v.subcategories.length > 10) {
      return { ok: false, error: "subcategories: array of <=10 strings" };
    }
    for (const s of v.subcategories) {
      if (!isStr(s, 32)) {
        return {
          ok: false,
          error: "subcategories: items must be strings <=32",
        };
      }
    }
  }

  return {
    ok: true,
    value: {
      $type: PROFILE_NSID,
      profileType,
      name: v.name as string,
      description: normalizedDescription,
      mainLink: normalizedMainLink,
      iosLink: normalizedIosLink,
      androidLink: normalizedAndroidLink,
      avatar: v.avatar as BlobRef | undefined,
      icon: v.icon as BlobRef | undefined,
      screenshots: screenshotsRes.value.length > 0
        ? screenshotsRes.value
        : undefined,
      categories: normalizedCategories,
      subcategories: v.subcategories as string[] | undefined,
      links: linksRes.value.length > 0 ? linksRes.value : undefined,
      createdAt: v.createdAt as string,
    },
  };
}

export function validateFeatured(
  input: unknown,
): ValidationResult<FeaturedRecord> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "record must be an object" };
  }
  const v = input as Record<string, unknown>;
  if (!Array.isArray(v.entries)) {
    return { ok: false, error: "entries: must be an array" };
  }
  const entries: FeaturedEntry[] = [];
  for (const raw of v.entries) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "entry must be an object" };
    }
    const e = raw as Record<string, unknown>;
    if (typeof e.did !== "string" || !DID_RE.test(e.did)) {
      return { ok: false, error: "entry.did: invalid DID" };
    }
    if (e.badges !== undefined) {
      if (!Array.isArray(e.badges)) {
        return { ok: false, error: "entry.badges: array" };
      }
      for (const b of e.badges) {
        if (typeof b !== "string") {
          return { ok: false, error: "entry.badges items must be strings" };
        }
      }
    }
    if (
      e.position !== undefined &&
      (typeof e.position !== "number" || e.position < 0)
    ) {
      return { ok: false, error: "entry.position: non-negative integer" };
    }
    entries.push({
      did: e.did,
      badges: e.badges as string[] | undefined,
      position: e.position as number | undefined,
    });
  }
  return {
    ok: true,
    value: { $type: FEATURED_NSID, entries },
  };
}

export function validateReview(
  input: unknown,
): ValidationResult<ReviewRecord> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "record must be an object" };
  }
  const v = input as Record<string, unknown>;
  if (typeof v.subject !== "string" || !DID_RE.test(v.subject)) {
    return { ok: false, error: "subject: invalid DID" };
  }
  if (
    v.subjectUri !== undefined &&
    (typeof v.subjectUri !== "string" || !AT_URI_RE.test(v.subjectUri) ||
      v.subjectUri.length > 512)
  ) {
    return { ok: false, error: "subjectUri: invalid AT URI" };
  }
  if (
    typeof v.rating !== "number" || !Number.isInteger(v.rating) ||
    v.rating < 1 || v.rating > 5
  ) {
    return { ok: false, error: "rating: integer 1..5 required" };
  }
  const body = typeof v.body === "string" ? v.body.trim() : "";
  if (body.length > 300) {
    return { ok: false, error: "body: must be <=300 chars" };
  }
  if (!isStr(v.createdAt, 64)) {
    return { ok: false, error: "createdAt required (ISO 8601)" };
  }
  if (v.updatedAt !== undefined && !isStr(v.updatedAt, 64)) {
    return { ok: false, error: "updatedAt: string <=64" };
  }
  return {
    ok: true,
    value: {
      $type: REVIEW_NSID,
      subject: v.subject,
      subjectUri: typeof v.subjectUri === "string" ? v.subjectUri : undefined,
      rating: v.rating as 1 | 2 | 3 | 4 | 5,
      body: body || undefined,
      createdAt: v.createdAt as string,
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : undefined,
    },
  };
}

export function validateUpdate(
  input: unknown,
): ValidationResult<UpdateRecord> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "record must be an object" };
  }
  const v = input as Record<string, unknown>;
  const title = typeof v.title === "string" ? v.title.trim() : "";
  if (!title || title.length > 80) {
    return { ok: false, error: "title: 1..80 chars required" };
  }
  const body = typeof v.body === "string" ? v.body.trim() : "";
  if (!body || body.length > 1000) {
    return { ok: false, error: "body: 1..1000 chars required" };
  }
  const version = typeof v.version === "string" ? v.version.trim() : "";
  if (version.length > 32) {
    return { ok: false, error: "version: must be <=32 chars" };
  }
  let tangledCommitUrl: string | undefined;
  if (
    v.tangledCommitUrl !== undefined && v.tangledCommitUrl !== null &&
    v.tangledCommitUrl !== ""
  ) {
    if (!isStr(v.tangledCommitUrl, 512) || !isUrl(v.tangledCommitUrl)) {
      return {
        ok: false,
        error: "tangledCommitUrl: must be an http(s) URL <=512",
      };
    }
    tangledCommitUrl = (v.tangledCommitUrl as string).trim();
  }
  let tangledRepoUrl: string | undefined;
  if (
    v.tangledRepoUrl !== undefined && v.tangledRepoUrl !== null &&
    v.tangledRepoUrl !== ""
  ) {
    if (!isStr(v.tangledRepoUrl, 512) || !isUrl(v.tangledRepoUrl)) {
      return {
        ok: false,
        error: "tangledRepoUrl: must be an http(s) URL <=512",
      };
    }
    tangledRepoUrl = (v.tangledRepoUrl as string).trim();
  }
  const source = typeof v.source === "string" && v.source.trim()
    ? v.source.trim().slice(0, 32)
    : "manual";
  if (!isStr(v.createdAt, 64)) {
    return { ok: false, error: "createdAt required (ISO 8601)" };
  }
  if (v.updatedAt !== undefined && !isStr(v.updatedAt, 64)) {
    return { ok: false, error: "updatedAt: string <=64" };
  }
  return {
    ok: true,
    value: {
      $type: UPDATE_NSID,
      title,
      body,
      version: version || undefined,
      tangledCommitUrl,
      tangledRepoUrl,
      source,
      createdAt: v.createdAt as string,
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : undefined,
    },
  };
}

/**
 * The literal JSON for each lexicon (loaded at module init). Used by the
 * `/.well-known/atproto-lexicon/<NSID>` route to publish the schemas, and
 * by tooling that wants to introspect them.
 */
export async function loadLexiconJson(nsid: string): Promise<unknown | null> {
  if (!REGISTRY_NSIDS.includes(nsid as typeof REGISTRY_NSIDS[number])) {
    return null;
  }
  const fileMap: Record<string, string> = {
    [PROFILE_NSID]: "profile.json",
    [REVIEW_NSID]: "review.json",
    [UPDATE_NSID]: "update.json",
    [FEATURED_NSID]: "featured.json",
    [PERMISSION_SET_NSID]: "fullPermissions.json",
  };
  const filename = fileMap[nsid];
  try {
    const text = await Deno.readTextFile(
      `lexicons/com/atmosphereaccount/registry/${filename}`,
    );
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}
