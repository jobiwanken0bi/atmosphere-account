/**
 * Public JSON projection for registry read APIs (`/api/registry/profile/*`,
 * `/api/registry/search`, `/api/registry/featured`).
 *
 * Strips AppView-only moderation and verification workflow fields
 * (takedown columns, per-icon review, icon-access request metadata, etc.)
 * so anonymous API consumers never see internal operational data.
 *
 * Includes a boolean `verified` when the project has the same public
 * “verified” badge as Explore (`icon_access_status === 'granted'`), without
 * exposing emails, timestamps, or admin DIDs.
 */
import type { LinkEntry, ScreenshotEntry } from "./lexicons.ts";
import type { ProfileRow } from "./registry.ts";
import { bskyCdnAvatarUrl } from "./avatar.ts";

export interface PublicProfileJson {
  did: string;
  handle: string;
  name: string;
  description: string;
  mainLink: string | null;
  iosLink: string | null;
  androidLink: string | null;
  categories: string[];
  subcategories: string[];
  links: LinkEntry[];
  screenshots: ScreenshotEntry[];
  /** Fully-qualified URLs for lazily loaded detail-page screenshots. */
  screenshotUrls: string[];
  avatarCid: string | null;
  avatarMime: string | null;
  /** Fully-qualified URL for the profile avatar image, or null. */
  avatarUrl: string | null;
  /**
   * True when the project shows the public verified badge on Explore
   * (admin-approved verification). No other verification metadata is exposed.
   */
  verified: boolean;
  /**
   * Developer-facing SVG icon URL when the icon is approved and the project
   * is verified; otherwise null. Raw `iconCid` / review state are not exposed.
   */
  iconUrl: string | null;
  pdsUrl: string;
  recordCid: string;
  recordRev: string;
  createdAt: number;
  indexedAt: number;
  /** Present when this profile appears in the featured join (search / featured lists). */
  featured?: ProfileRow["featured"];
}

export function toPublicProfileJson(
  profile: ProfileRow,
  origin: string,
): PublicProfileJson {
  const avatarUrl = profile.avatarCid
    ? bskyCdnAvatarUrl(profile.did, profile.avatarCid)
    : null;
  const verified = profile.iconAccessStatus === "granted";
  const iconUrl = profile.iconCid &&
      profile.iconStatus === "approved" &&
      profile.iconAccessStatus === "granted"
    ? `${origin}/api/registry/icon/${encodeURIComponent(profile.did)}`
    : null;
  const screenshotUrls = profile.screenshots.map((_, i) =>
    `${origin}/api/registry/screenshot/${encodeURIComponent(profile.did)}/${i}`
  );

  const out: PublicProfileJson = {
    did: profile.did,
    handle: profile.handle,
    name: profile.name,
    description: profile.description,
    mainLink: profile.mainLink,
    iosLink: profile.iosLink,
    androidLink: profile.androidLink,
    categories: profile.categories,
    subcategories: profile.subcategories,
    // `website` was the former Landing Page button. The current public
    // API exposes the primary web destination via `mainLink` instead.
    links: profile.links.filter((entry) => entry.kind !== "website"),
    screenshots: profile.screenshots,
    screenshotUrls,
    avatarCid: profile.avatarCid,
    avatarMime: profile.avatarMime,
    avatarUrl,
    verified,
    iconUrl,
    pdsUrl: profile.pdsUrl,
    recordCid: profile.recordCid,
    recordRev: profile.recordRev,
    createdAt: profile.createdAt,
    indexedAt: profile.indexedAt,
  };
  if (profile.featured !== undefined) {
    out.featured = profile.featured;
  }
  return out;
}
