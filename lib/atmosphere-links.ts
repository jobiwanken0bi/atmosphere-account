/**
 * Atmosphere link metadata + per-LinkEntry resolution.
 *
 * Two halves:
 *
 *   1. The catalog of "Atmosphere" services a profile can opt in to —
 *      Bluesky-style profile buttons (one per client), Tangled, Supper.
 *      Each has its own icon + default URL template (derived from the
 *      project's current handle). New atmosphere services slot in here
 *      without touching the lexicon or the form.
 *
 *   2. `resolveLink(entry, handle, labels)` — turns a stored `LinkEntry`
 *      into render-ready `{title, subtitle, iconUrl, glyph, href}` data
 *      so `ProfileLinks.tsx` can iterate `profile.links` without caring
 *      about per-kind branching.
 *
 * Single source of truth used by:
 *   - the create / manage form (islands/CreateProfileForm.tsx)
 *   - the public profile detail page (components/explore/ProfileLinks.tsx)
 *   - lexicon validation (lib/lexicons.ts via clientId / kind constants)
 */
import { BSKY_CLIENTS, getBskyClient } from "./bsky-clients.ts";
import type { LinkEntry } from "./lexicons.ts";

const faviconFor = (domain: string, size = 64): string =>
  `https://www.google.com/s2/favicons?sz=${size}&domain=${
    encodeURIComponent(domain)
  }`;

/* -------------------------------------------------------------------------- *
 * Atmosphere service catalog                                                 *
 * -------------------------------------------------------------------------- */

export type AtmosphereServiceId = "bsky" | "tangled" | "supper";

export interface AtmosphereService {
  /** Lexicon `kind` value. */
  id: AtmosphereServiceId;
  /** Display name shown in the form toggle row + the public button. */
  name: string;
  /** Short description shown under the name in the form toggle row. */
  description: string;
  /**
   * Whether the service is currently enabled in the form's toggle list.
   * Hidden services still validate as `kind` values so older records
   * remain readable.
   */
  visible: boolean;
  /**
   * Whether this service should accept a custom URL override on the
   * profile. `bsky` derives URL solely from clientId; `tangled` /
   * `supper` accept an override (e.g. point Tangled at a specific repo
   * page rather than the default `@handle` profile).
   */
  allowUrlOverride: boolean;
  /** Default URL when no override is provided. */
  defaultUrl: (handle: string) => string;
  /** Icon for the toggle / button. Falls back to a glyph if null. */
  iconUrl: string | null;
}

/** Default Tangled domain for the user-profile URL pattern. */
const TANGLED_DOMAIN = "tangled.sh";
/** Default Supper domain. */
const SUPPER_DOMAIN = "supper.support";

export const ATMOSPHERE_SERVICES: AtmosphereService[] = [
  {
    id: "bsky",
    name: "Bluesky",
    description: "Decentralised social network",
    visible: true,
    allowUrlOverride: false,
    /**
     * Bsky URLs are always resolved from the chosen client's
     * `profileUrl(handle)` — this default is only used as a last-resort
     * fallback when a client lookup fails.
     */
    defaultUrl: (handle: string) => `https://bsky.app/profile/${handle}`,
    iconUrl: faviconFor("bsky.app"),
  },
  {
    id: "tangled",
    name: "Tangled",
    description: "Social coding platform",
    visible: true,
    allowUrlOverride: true,
    defaultUrl: (handle: string) => `https://${TANGLED_DOMAIN}/@${handle}`,
    iconUrl: faviconFor(TANGLED_DOMAIN),
  },
  {
    /**
     * Hidden until supper.support is live — kept in the catalog so older
     * records still validate / render, and so flipping `visible: true`
     * here is the only change needed when the service launches.
     */
    id: "supper",
    name: "Supper",
    description: "AT Protocol native support page",
    visible: false,
    allowUrlOverride: true,
    defaultUrl: (handle: string) => `https://${SUPPER_DOMAIN}/${handle}`,
    iconUrl: faviconFor(SUPPER_DOMAIN),
  },
];

export function getAtmosphereService(
  id: string | null | undefined,
): AtmosphereService | null {
  return ATMOSPHERE_SERVICES.find((s) => s.id === id) ?? null;
}

/** Visible services in the order the form should render them. */
export function visibleAtmosphereServices(): AtmosphereService[] {
  return ATMOSPHERE_SERVICES.filter((s) => s.visible);
}

/* -------------------------------------------------------------------------- *
 * LinkEntry resolution                                                       *
 * -------------------------------------------------------------------------- */

/**
 * The labels used by the resolver. Mirrors the i18n catalog so callers
 * can pass `t.linkKinds` straight in.
 */
export interface LinkKindLabels {
  bsky: string;
  tangled: string;
  supper: string;
  website: string;
  /** Title used when a custom link entry doesn't supply its own label. */
  custom: string;
}

export interface ResolvedLink {
  /** Display title for the button. */
  title: string;
  /** Subtitle (host + path of the URL). */
  subtitle: string;
  /** Icon URL, when available. */
  iconUrl: string | null;
  /** Inline glyph fallback. */
  glyph: string;
  /** The final href the user navigates to. */
  href: string;
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
 * Resolve a stored LinkEntry into a render-ready bundle.
 *
 *   - `bsky` looks up the chosen client (defaults to the first client if
 *     unknown so legacy records still render) and uses its profileUrl.
 *   - `tangled` / `supper` use their `url` override when present, else
 *     derive from the handle.
 *   - `website` uses the URL as-is.
 *   - `other` uses URL + label, falling back to a generic glyph.
 *   - Unknown kinds render as a generic external link if a URL exists.
 */
export function resolveLink(
  entry: LinkEntry,
  handle: string,
  labels: LinkKindLabels,
): ResolvedLink | null {
  const kind = entry.kind;

  if (kind === "bsky") {
    const client = getBskyClient(entry.clientId);
    const href = client.profileUrl(handle);
    return {
      title: client.name,
      subtitle: trimUrlForDisplay(href),
      iconUrl: client.iconUrl,
      glyph: "B",
      href,
    };
  }

  if (kind === "tangled" || kind === "supper") {
    const svc = getAtmosphereService(kind)!;
    const href = entry.url || svc.defaultUrl(handle);
    return {
      title: svc.name,
      subtitle: trimUrlForDisplay(href),
      iconUrl: svc.iconUrl,
      glyph: svc.name.slice(0, 1),
      href,
    };
  }

  if (kind === "website") {
    if (!entry.url) return null;
    return {
      title: entry.label || labels.website,
      subtitle: trimUrlForDisplay(entry.url),
      iconUrl: null,
      glyph: "↗",
      href: entry.url,
    };
  }

  if (kind === "other") {
    if (!entry.url) return null;
    return {
      title: entry.label || labels.custom,
      subtitle: trimUrlForDisplay(entry.url),
      iconUrl: null,
      glyph: "↗",
      href: entry.url,
    };
  }

  // Unknown future kind: render as a generic external link if it has a
  // URL, otherwise drop it. Keeps the lexicon forward-compatible.
  if (entry.url) {
    return {
      title: entry.label || labels.custom,
      subtitle: trimUrlForDisplay(entry.url),
      iconUrl: null,
      glyph: "↗",
      href: entry.url,
    };
  }
  return null;
}

/** Re-export the underlying client list so the form's picker can iterate it. */
export { BSKY_CLIENTS };
