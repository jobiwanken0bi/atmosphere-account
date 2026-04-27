import type { ProfileRow } from "./registry.ts";

export interface PublicSvgIconDownload {
  did: string;
  handle: string;
  name: string;
  iconUrl: string;
  downloadFilename: string;
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

export function svgIconDownloadFilename(profile: ProfileRow): string {
  const label = profile.name.trim() || profile.handle;
  return `${slugifyFilenamePart(label)}.svg`;
}

export function publicSvgIconDownload(
  profile: ProfileRow,
  origin: string,
): PublicSvgIconDownload {
  return {
    did: profile.did,
    handle: profile.handle,
    name: profile.name,
    iconUrl: `${origin}/api/registry/icon/${encodeURIComponent(profile.did)}`,
    downloadFilename: svgIconDownloadFilename(profile),
    indexedAt: profile.indexedAt,
  };
}

export function uniqueZipFilename(
  profile: ProfileRow,
  used: Set<string>,
): string {
  const base = svgIconDownloadFilename(profile).replace(/\.svg$/i, "");
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
