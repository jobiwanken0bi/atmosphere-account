import type { AppListing } from "./app-directory.ts";
import type { AppDirectoryLink } from "./app-lexicons.ts";

export type AppActionLinkKind =
  | "website"
  | "bluesky"
  | "ios"
  | "android"
  | "external";

export interface AppActionLink extends AppDirectoryLink {
  kind: AppActionLinkKind;
  label: string;
}

type LinkSource = Pick<AppListing, "links" | "primaryUrl" | "productDid">;

export function appActionLinks(app: LinkSource): AppActionLink[] {
  const out: AppActionLink[] = [];
  const seen = new Set<string>();

  for (const link of app.links) {
    addActionLink(out, seen, link);
  }

  if (app.primaryUrl && !hasEquivalentUrl(out, app.primaryUrl)) {
    addActionLink(out, seen, {
      uri: app.primaryUrl,
      label: "Website",
      role: "website",
    });
  }

  if (app.productDid && !out.some((link) => link.kind === "bluesky")) {
    const blueskyLink: AppActionLink = {
      uri: bskyProfileUrl(app.productDid),
      label: "Bluesky",
      role: "bluesky",
      kind: "bluesky",
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
): void {
  const key = canonicalActionUrl(link.uri);
  if (!key || seen.has(key)) return;
  const kind = appActionLinkKind(link);
  seen.add(key);
  out.push({
    ...link,
    kind,
    label: appActionLinkLabel(link, kind),
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
