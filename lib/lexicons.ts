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

export const REGISTRY_NSIDS = [PROFILE_NSID, FEATURED_NSID] as const;

export const CATEGORIES = [
  "app",
  "accountProvider",
  "moderator",
  "infrastructure",
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
  category: Category | string;
  subcategories?: string[];
  website?: string;
  /** Preferred Bluesky client (bluesky | blacksky | anisota | deer | witchsky). */
  bskyClient?: string;
  tags?: string[];
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
  if (
    !isStr(v.category) ||
    !(CATEGORIES as readonly string[]).includes(v.category as string)
  ) {
    return {
      ok: false,
      error: `category must be one of ${CATEGORIES.join(", ")}`,
    };
  }
  if (!isStr(v.createdAt)) {
    return { ok: false, error: "createdAt required (ISO 8601)" };
  }
  if (v.avatar !== undefined && !isBlob(v.avatar)) {
    return { ok: false, error: "avatar: invalid blob ref" };
  }
  if (v.website !== undefined && !isUrl(v.website)) {
    return { ok: false, error: "website: must be http(s) URL" };
  }
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
  if (v.tags !== undefined) {
    if (!Array.isArray(v.tags) || v.tags.length > 10) {
      return { ok: false, error: "tags: array of <=10 strings" };
    }
    for (const s of v.tags) {
      if (!isStr(s, 32)) {
        return { ok: false, error: "tags: items must be strings <=32" };
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
      category: v.category as string,
      subcategories: v.subcategories as string[] | undefined,
      website: v.website as string | undefined,
      bskyClient: v.bskyClient as string | undefined,
      tags: v.tags as string[] | undefined,
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
