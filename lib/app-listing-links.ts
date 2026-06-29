import type { AppListing } from "./app-directory.ts";
import type { AppDirectoryLink } from "./app-lexicons.ts";
import {
  BSKY_CLIENTS,
  type BskyClient,
  getProfileMicroblogViewer,
} from "./bsky-clients.ts";

export type AppActionLinkKind =
  | "website"
  | "bluesky"
  | "ios"
  | "android"
  | "external";

export interface AppActionLink extends AppDirectoryLink {
  kind: AppActionLinkKind;
  label: string;
  iconUrl?: string | null;
}

type LinkSource = Pick<AppListing, "links" | "primaryUrl" | "productDid">;

export interface AppActionLinkOptions {
  microblogViewerClientId?: string | null;
}

export function appActionLinks(
  app: LinkSource,
  options: AppActionLinkOptions = {},
): AppActionLink[] {
  const out: AppActionLink[] = [];
  const seen = new Set<string>();
  const microblogViewer = options.microblogViewerClientId
    ? getProfileMicroblogViewer(options.microblogViewerClientId)
    : null;

  for (const link of app.links) {
    addActionLink(out, seen, link, {
      fallbackAccount: app.productDid,
      microblogViewer,
    });
  }

  if (app.primaryUrl && !hasEquivalentUrl(out, app.primaryUrl)) {
    addActionLink(
      out,
      seen,
      {
        uri: app.primaryUrl,
        label: "Website",
        role: "website",
      },
      { fallbackAccount: app.productDid, microblogViewer },
    );
  }

  if (app.productDid && !out.some((link) => link.kind === "bluesky")) {
    const viewer = microblogViewer?.id === "bluesky" ? null : microblogViewer;
    const blueskyLink: AppActionLink = {
      uri: viewer ? viewer.profileUrl(app.productDid) : bskyProfileUrl(
        app.productDid,
      ),
      label: viewer?.name ?? "Bluesky",
      role: "bluesky",
      kind: "bluesky",
      iconUrl: viewer?.iconUrl ?? null,
    };
    const insertAfter = out.findIndex((link) => link.kind === "website");
    if (insertAfter >= 0) {
      out.splice(insertAfter + 1, 0, blueskyLink);
    } else {
      out.unshift(blueskyLink);
    }
  }

  return out;
}

function bskyProfileUrl(account: string): string {
  return `https://bsky.app/profile/${
    encodeURIComponent(account.trim()).replaceAll("%3A", ":")
  }`;
}

function addActionLink(
  out: AppActionLink[],
  seen: Set<string>,
  link: AppDirectoryLink,
  options: {
    fallbackAccount: string | null;
    microblogViewer: BskyClient | null;
  },
): void {
  const key = canonicalActionUrl(link.uri);
  if (!key || seen.has(key)) return;
  const kind = appActionLinkKind(link);
  seen.add(key);
  const viewer = kind === "bluesky" && options.microblogViewer?.id !== "bluesky"
    ? options.microblogViewer
    : null;
  const account = viewer
    ? blueskyProfileIdentifier(link.uri) ?? options.fallbackAccount
    : null;
  out.push({
    ...link,
    uri: viewer && account ? viewer.profileUrl(account) : link.uri,
    kind,
    label: viewer?.name ?? appActionLinkLabel(link, kind),
    iconUrl: viewer?.iconUrl ?? null,
  });
}

function hasEquivalentUrl(links: AppActionLink[], uri: string): boolean {
  const target = canonicalActionUrl(uri);
  return !!target &&
    links.some((link) => canonicalActionUrl(link.uri) === target);
}

export function appActionLinkKind(
  link: Pick<AppDirectoryLink, "uri" | "label" | "role">,
): AppActionLinkKind {
  const url = parseUrl(link.uri);
  const host = url?.hostname.replace(/^www\./, "").toLowerCase() ?? "";
  const path = url?.pathname.toLowerCase() ?? "";
  const text = `${link.role ?? ""} ${link.label ?? ""}`.toLowerCase();

  if (
    text.includes("bluesky") || text.includes("bsky") ||
    (host === "bsky.app" && path.startsWith("/profile"))
  ) {
    return "bluesky";
  }
  if (
    text.includes("appstore") || text.includes("app store") ||
    text.includes("ios") || host === "apps.apple.com"
  ) {
    return "ios";
  }
  if (
    text.includes("playstore") || text.includes("play store") ||
    text.includes("google play") || text.includes("android") ||
    host === "play.google.com"
  ) {
    return "android";
  }
  if (text.includes("website") || text === "site" || text.includes("web")) {
    return "website";
  }
  return "external";
}

function appActionLinkLabel(
  link: Pick<AppDirectoryLink, "label" | "role">,
  kind: AppActionLinkKind,
): string {
  if (kind === "bluesky") return "Bluesky";
  if (kind === "ios") return "App Store";
  if (kind === "android") return "Play Store";
  if (kind === "website") return "Explore";
  return link.label?.trim() || roleLabel(link.role) || "Open";
}

function roleLabel(role: string | undefined): string | null {
  if (!role) return null;
  return role
    .split(/[#/]/)
    .at(-1)
    ?.replace(/^linkRole/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim() || null;
}

function canonicalActionUrl(value: string): string | null {
  const url = parseUrl(value);
  if (!url) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || lower === "ref" || lower === "ref_src") {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.toString().replace(/\/$/, "");
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function blueskyProfileIdentifier(value: string): string | null {
  const url = parseUrl(value);
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const isKnownViewer = BSKY_CLIENTS.some((client) =>
    client.domain.toLowerCase() === host
  );
  if (!isKnownViewer) return null;
  const match = url.pathname.match(/^\/profile\/([^/?#]+)/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return match[1].trim() || null;
  }
}
