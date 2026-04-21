/**
 * Display metadata for `LinkEntry.kind`. The lexicon stores kinds as an
 * open string with a `knownValues` hint, so we keep this list aligned
 * with the lexicon's `knownValues` and fall back to the "other" entry
 * for anything we don't recognise.
 *
 * Icons:
 *   - Known web hosts (mastodon, matrix, discord) use the Google S2
 *     favicon CDN so we don't ship per-host artwork.
 *   - Generic kinds (website, donate, docs, contact, other) render with
 *     a small inline glyph defined in the UI layer.
 *
 * Single source of truth used by:
 *   - the public profile detail page (components/explore/ProfileLinks.tsx)
 *   - the create / manage form's links editor (islands/CreateProfileForm.tsx)
 */
import { detectRepoHost, type RepoHost } from "./repo-hosts.ts";
import type { LinkEntry } from "./lexicons.ts";

export type LinkKindId =
  | "website"
  | "repo"
  | "donate"
  | "docs"
  | "mastodon"
  | "matrix"
  | "discord"
  | "contact"
  | "other";

export interface LinkKindDescriptor {
  id: LinkKindId;
  /**
   * Inline glyph (CSS string) for kinds without a remote favicon. When
   * `iconUrl` is non-null the glyph is unused.
   */
  glyph: string;
  /** Favicon-style image URL, when applicable. */
  iconUrl: string | null;
}

const faviconFor = (domain: string, size = 64): string =>
  `https://www.google.com/s2/favicons?sz=${size}&domain=${
    encodeURIComponent(domain)
  }`;

const KINDS: Record<LinkKindId, LinkKindDescriptor> = {
  website: { id: "website", glyph: "↗", iconUrl: null },
  // `repo` resolves to a per-host descriptor at render time (GitHub /
  // Tangled / generic) via detectRepoHost — this entry is only used for
  // the editor's kind picker.
  repo: { id: "repo", glyph: "</>", iconUrl: null },
  donate: { id: "donate", glyph: "♥", iconUrl: null },
  docs: { id: "docs", glyph: "📖", iconUrl: null },
  mastodon: {
    id: "mastodon",
    glyph: "@",
    iconUrl: faviconFor("joinmastodon.org"),
  },
  matrix: {
    id: "matrix",
    glyph: "[m]",
    iconUrl: faviconFor("matrix.org"),
  },
  discord: {
    id: "discord",
    glyph: "💬",
    iconUrl: faviconFor("discord.com"),
  },
  contact: { id: "contact", glyph: "✉", iconUrl: null },
  other: { id: "other", glyph: "↗", iconUrl: null },
};

/** Resolved render data for a single LinkEntry. */
export interface ResolvedLink {
  /** Display title for the button ("Website", "Source on GitHub", …). */
  title: string;
  /** Subtitle (host + path of the URL). */
  subtitle: string;
  /** Icon URL, when available. */
  iconUrl: string | null;
  /** Inline glyph fallback. */
  glyph: string;
  /** The original href. */
  url: string;
}

function trimUrlForDisplay(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

/**
 * Translation surface that the resolver needs. Mirrors the shape used in
 * the i18n catalog so callers can pass `t.linkKinds` straight in.
 */
export interface LinkKindLabels {
  website: string;
  repo: string;
  /** Prefix used for repo kinds — e.g. "Source on GitHub". */
  repoOnPrefix: string;
  /** Generic repo label when host can't be detected. */
  repoGeneric: string;
  donate: string;
  docs: string;
  mastodon: string;
  matrix: string;
  discord: string;
  contact: string;
  other: string;
}

/**
 * Turn a raw LinkEntry into a {title, subtitle, icon, glyph} bundle the
 * UI can render directly. Repo kinds defer to detectRepoHost() so the
 * GitHub/Tangled branding survives.
 */
export function resolveLink(
  entry: LinkEntry,
  labels: LinkKindLabels,
): ResolvedLink {
  const subtitle = trimUrlForDisplay(entry.url);
  const kind = entry.kind as LinkKindId;

  if (kind === "repo") {
    const host: RepoHost = detectRepoHost(entry.url);
    const title = host.id === "other"
      ? labels.repoGeneric
      : `${labels.repoOnPrefix} ${host.name}`;
    return {
      title: entry.label || title,
      subtitle,
      iconUrl: host.iconUrl,
      glyph: KINDS.repo.glyph,
      url: entry.url,
    };
  }

  if (kind === "other") {
    return {
      title: entry.label || labels.other,
      subtitle,
      iconUrl: null,
      glyph: KINDS.other.glyph,
      url: entry.url,
    };
  }

  const desc = KINDS[kind] ?? KINDS.other;
  const title = entry.label || (labels[kind] as string | undefined) ||
    labels.other;
  return {
    title,
    subtitle,
    iconUrl: desc.iconUrl,
    glyph: desc.glyph,
    url: entry.url,
  };
}

/** Ordered list of kind ids for the form's `<select>` dropdown. */
export const LINK_KIND_ORDER: LinkKindId[] = [
  "website",
  "repo",
  "donate",
  "docs",
  "mastodon",
  "matrix",
  "discord",
  "contact",
  "other",
];
