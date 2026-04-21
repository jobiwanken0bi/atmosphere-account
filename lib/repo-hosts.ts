/**
 * Auto-detected source-repo hosts. A project's profile can publish any
 * number of `links` entries with kind="repo"; we pick the right icon +
 * label based on the URL host so the UI stays simple (no extra picker
 * the way Bluesky-clients have one).
 *
 * Currently recognised:
 *   - GitHub  (github.com)
 *   - Tangled (tangled.org / *.tngl.sh — the AT Protocol "social coding"
 *     platform: https://tangled.org/)
 *
 * Anything else falls back to a generic "code" host with the website-style
 * arrow glyph so the button still works for self-hosted Forgejo/Gitea/etc.
 *
 * Used by `lib/link-kinds.ts` when resolving a `repo`-kind link entry
 * into render-ready data for components/explore/ProfileLinks.tsx.
 */

export type RepoHostId = "github" | "tangled" | "other";

export interface RepoHost {
  id: RepoHostId;
  /** Display name used in the button label ("Source on Tangled"). */
  name: string;
  /** Bare hostname-ish label shown in the button subtitle. */
  domain: string;
  /**
   * Icon for the button. We use Google's S2 favicon CDN for known hosts
   * so we don't have to ship per-host artwork; if a host's favicon ever
   * misbehaves we can swap in a local asset (mirroring `bsky-clients`).
   */
  iconUrl: string | null;
}

const faviconFor = (domain: string, size = 64): string =>
  `https://www.google.com/s2/favicons?sz=${size}&domain=${
    encodeURIComponent(domain)
  }`;

const HOSTS: Record<Exclude<RepoHostId, "other">, RepoHost> = {
  github: {
    id: "github",
    name: "GitHub",
    domain: "github.com",
    iconUrl: faviconFor("github.com"),
  },
  tangled: {
    id: "tangled",
    name: "Tangled",
    domain: "tangled.org",
    iconUrl: faviconFor("tangled.org"),
  },
};

const FALLBACK: RepoHost = {
  id: "other",
  name: "Source",
  domain: "",
  iconUrl: null,
};

/**
 * Detect which known repo host (if any) a URL belongs to. Match is purely
 * by hostname suffix so subdomains (`*.tngl.sh`) and locale variants
 * (`gh.io`-style mirrors) both work.
 */
export function detectRepoHost(url: string | null | undefined): RepoHost {
  if (!url) return FALLBACK;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return FALLBACK;
  }
  if (host === "github.com" || host.endsWith(".github.com")) {
    return HOSTS.github;
  }
  // Tangled uses both tangled.org (web) and *.tngl.sh (handle-based subdomains
  // for Tangled Sites); accept either as the canonical host.
  if (
    host === "tangled.org" ||
    host.endsWith(".tangled.org") ||
    host === "tngl.sh" ||
    host.endsWith(".tngl.sh")
  ) {
    // Show whichever host the URL actually used so the subtitle stays honest.
    return { ...HOSTS.tangled, domain: host };
  }
  return { ...FALLBACK, domain: host };
}

/** Trim a URL down to host + path for the button subtitle. */
export function trimRepoUrlForDisplay(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}
