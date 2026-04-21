/**
 * Hand-written TypeScript types and runtime validators for the
 * com.atmosphereaccount.registry.* lexicons. Keeping these hand-written
 * (rather than running @atproto/lex-cli) avoids a Node-only build step
 * and keeps the surface area small and Deno-native.
 *
 * Source of truth: lexicons/com/atmosphereaccount/registry/*.json
 */

export const PROFILE_NSID = "com.atmosphereaccount.registry.profile";
export const FEATURED_NSID = "com.atmosphereaccount.registry.featured";
export const LICENSE_NSID = "com.atmosphereaccount.registry.license";

export const REGISTRY_NSIDS = [
  PROFILE_NSID,
  FEATURED_NSID,
  LICENSE_NSID,
] as const;

export const CATEGORIES = [
  "app",
  "accountProvider",
  "moderator",
  "infrastructure",
  "developerTool",
] as const;
export type Category = typeof CATEGORIES[number];

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
] as const;
export type AppSubcategory = typeof APP_SUBCATEGORIES[number];

export const FEATURED_BADGES = ["verified", "official"] as const;
export type FeaturedBadge = typeof FEATURED_BADGES[number];

/**
 * Recognised link kinds. The lexicon stores `kind` as an open string with
 * `knownValues`, so adding new kinds later is a non-breaking change — old
 * records with unknown kinds just render with the "other" fallback icon.
 */
export const LINK_KINDS = [
  "website",
  "repo",
  "donate",
  "docs",
  "mastodon",
  "matrix",
  "discord",
  "contact",
  "other",
] as const;
export type LinkKind = typeof LINK_KINDS[number];

export interface LinkEntry {
  kind: string;
  url: string;
  /** Optional display override; required for kind="other". */
  label?: string;
}

export const LICENSE_TYPES = [
  "openSource",
  "sourceAvailable",
  "proprietary",
] as const;
export type LicenseType = typeof LICENSE_TYPES[number];

export interface BlobRef {
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
}

export interface ProfileRecord {
  $type?: typeof PROFILE_NSID;
  name: string;
  description: string;
  avatar?: BlobRef;
  /** All categories that apply to the project (1-4). The first item is the
   *  primary category used for sort/grouping in lists. */
  categories: string[];
  subcategories?: string[];
  /** Outbound links shown on the public profile (website, repo, donate, …). */
  links?: LinkEntry[];
  /** Preferred Bluesky client (bluesky | blacksky | anisota | deer | witchsky). */
  bskyClient?: string;
  createdAt: string;
}

export interface LicenseRecord {
  $type?: typeof LICENSE_NSID;
  type: string;
  spdxId?: string;
  licenseUrl?: string;
  notes?: string;
  createdAt: string;
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

import { BSKY_CLIENT_IDS } from "./bsky-clients.ts";

const DID_RE = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;

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

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

/**
 * Normalise + validate a links[] array. Drops empties, dedupes by URL,
 * caps at 12 to match the lexicon, and enforces the "other requires
 * label" rule. Unknown kinds are accepted (lexicon `knownValues` is a
 * hint, not a constraint).
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
  const seen = new Set<string>();
  const out: LinkEntry[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "links: items must be objects" };
    }
    const e = raw as Record<string, unknown>;
    if (!isStr(e.kind, 32)) {
      return { ok: false, error: "links[].kind: string required" };
    }
    if (!isUrl(e.url)) {
      return { ok: false, error: "links[].url: must be http(s) URL" };
    }
    const url = (e.url as string).trim();
    if (seen.has(url)) continue;
    seen.add(url);
    const entry: LinkEntry = { kind: e.kind as string, url };
    if (e.label !== undefined) {
      if (!isStr(e.label, 64)) {
        return { ok: false, error: "links[].label: string <=64" };
      }
      const label = (e.label as string).trim();
      if (label) entry.label = label;
    }
    if (entry.kind === "other" && !entry.label) {
      return {
        ok: false,
        error: 'links[]: kind="other" requires a label',
      };
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

  if (
    !isStr(v.name) || (v.name as string).length < 1 ||
    (v.name as string).length > 60
  ) {
    return { ok: false, error: "name: 1..60 chars required" };
  }
  if (
    !isStr(v.description) || (v.description as string).length < 1 ||
    (v.description as string).length > 500
  ) {
    return { ok: false, error: "description: 1..500 chars required" };
  }
  // categories[]: required, deduped, every entry must be a known CATEGORY.
  // The first entry is treated as the primary category by the UI.
  let normalizedCategories: string[];
  {
    if (!Array.isArray(v.categories) || v.categories.length === 0) {
      return { ok: false, error: "categories: non-empty array required" };
    }
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
  if (!isStr(v.createdAt)) {
    return { ok: false, error: "createdAt required (ISO 8601)" };
  }
  if (v.avatar !== undefined && !isBlob(v.avatar)) {
    return { ok: false, error: "avatar: invalid blob ref" };
  }
  const linksRes = normalizeLinks(v.links);
  if (!linksRes.ok) return { ok: false, error: linksRes.error };
  if (
    v.bskyClient !== undefined &&
    (!isStr(v.bskyClient) ||
      !(BSKY_CLIENT_IDS as readonly string[]).includes(v.bskyClient as string))
  ) {
    return {
      ok: false,
      error: `bskyClient: must be one of ${BSKY_CLIENT_IDS.join(", ")}`,
    };
  }
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
      name: v.name as string,
      description: v.description as string,
      avatar: v.avatar as BlobRef | undefined,
      categories: normalizedCategories,
      subcategories: v.subcategories as string[] | undefined,
      links: linksRes.value.length > 0 ? linksRes.value : undefined,
      bskyClient: v.bskyClient as string | undefined,
      createdAt: v.createdAt as string,
    },
  };
}

export function validateLicense(
  input: unknown,
): ValidationResult<LicenseRecord> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "record must be an object" };
  }
  const v = input as Record<string, unknown>;
  if (
    !isStr(v.type) ||
    !(LICENSE_TYPES as readonly string[]).includes(v.type as string)
  ) {
    return {
      ok: false,
      error: `type: must be one of ${LICENSE_TYPES.join(", ")}`,
    };
  }
  if (!isStr(v.createdAt)) {
    return { ok: false, error: "createdAt required (ISO 8601)" };
  }
  if (v.spdxId !== undefined && !isStr(v.spdxId, 64)) {
    return { ok: false, error: "spdxId: string <=64" };
  }
  if (v.licenseUrl !== undefined && !isUrl(v.licenseUrl)) {
    return { ok: false, error: "licenseUrl: must be http(s) URL" };
  }
  if (v.notes !== undefined && !isStr(v.notes, 280)) {
    return { ok: false, error: "notes: string <=280" };
  }
  return {
    ok: true,
    value: {
      $type: LICENSE_NSID,
      type: v.type as string,
      spdxId: v.spdxId as string | undefined,
      licenseUrl: v.licenseUrl as string | undefined,
      notes: v.notes as string | undefined,
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
    [FEATURED_NSID]: "featured.json",
    [LICENSE_NSID]: "license.json",
  };
  const filename = fileMap[nsid];
  const url = new URL(
    `../lexicons/com/atmosphereaccount/registry/${filename}`,
    import.meta.url,
  );
  try {
    const text = await Deno.readTextFile(url);
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}
