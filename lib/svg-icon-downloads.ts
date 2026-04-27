import type { ProfileRow } from "./registry.ts";

export type IconVariant = "color" | "bw";

export interface PublicSvgIconVariant {
  iconUrl: string;
  downloadFilename: string;
}

export interface PublicSvgIconDownload {
  did: string;
  handle: string;
  name: string;
  /** Color variant. `null` when the project has only published a B/W icon. */
  color: PublicSvgIconVariant | null;
  /** Optional black-and-white companion. `null` when not uploaded / approved. */
  bw: PublicSvgIconVariant | null;
  indexedAt: number;
}

function slugifyFilenamePart(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "icon";
}

function variantSuffix(variant: IconVariant): string {
  return variant === "bw" ? "-bw" : "";
}

export function svgIconDownloadFilename(
  profile: ProfileRow,
  variant: IconVariant,
): string {
  const label = profile.name.trim() || profile.handle;
  return `${slugifyFilenamePart(label)}${variantSuffix(variant)}.svg`;
}

function variantUrlPath(variant: IconVariant): string {
  return variant === "bw" ? "icon-bw" : "icon";
}

function buildVariant(
  profile: ProfileRow,
  variant: IconVariant,
  origin: string,
): PublicSvgIconVariant {
  const cid = variant === "bw" ? profile.iconBwCid : profile.iconCid;
  return {
    iconUrl: `${origin}/api/registry/${variantUrlPath(variant)}/${
      encodeURIComponent(profile.did)
    }?v=${encodeURIComponent(cid ?? "")}`,
    downloadFilename: svgIconDownloadFilename(profile, variant),
  };
}

/**
 * Public projection of the per-project icon downloads. A project may
 * publish either or both variants; the UI hides slots that are `null`.
 */
export function publicSvgIconDownload(
  profile: ProfileRow,
  origin: string,
): PublicSvgIconDownload {
  const hasColor = !!profile.iconCid && profile.iconStatus === "approved";
  const hasBw = !!profile.iconBwCid && profile.iconBwStatus === "approved";
  return {
    did: profile.did,
    handle: profile.handle,
    name: profile.name,
    color: hasColor ? buildVariant(profile, "color", origin) : null,
    bw: hasBw ? buildVariant(profile, "bw", origin) : null,
    indexedAt: profile.indexedAt,
  };
}

/**
 * Disambiguate the ZIP entry filename so two projects with the same
 * slug don't collide. Tries the slug, then -<handle>, then -<did
 * fragment>, then a numeric suffix.
 */
export function uniqueZipFilename(
  profile: ProfileRow,
  variant: IconVariant,
  used: Set<string>,
): string {
  const base = svgIconDownloadFilename(profile, variant).replace(/\.svg$/i, "");
  const didPart = profile.did.split(":").pop() ?? "icon";
  const candidates = [
    `${base}.svg`,
    `${base}-${slugifyFilenamePart(profile.handle)}.svg`,
    `${base}-${slugifyFilenamePart(didPart)}.svg`,
  ];

  for (const candidate of candidates) {
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }

  let i = 2;
  while (used.has(`${base}-${i}.svg`)) i++;
  const filename = `${base}-${i}.svg`;
  used.add(filename);
  return filename;
}
