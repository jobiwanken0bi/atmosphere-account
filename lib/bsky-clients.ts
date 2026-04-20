/**
 * Curated list of Bluesky-compatible clients a registry profile can opt
 * into. Each entry is the *frontend* a project wants visitors to land on
 * when clicking the "Bluesky" button on its detail page — they're all
 * regular atproto/Bluesky web clients with the same `/profile/{handle}`
 * URL convention.
 *
 * Single source of truth used by:
 *   - the create / manage form picker (islands/CreateProfileForm.tsx)
 *   - the public profile detail page (components/explore/ProfileLinks.tsx)
 *   - lexicon validation (lib/lexicons.ts)
 *
 * Keep IDs short and stable (they're written to PDS records). To add a
 * new client, append here and it shows up everywhere automatically.
 */

export interface BskyClient {
  /** Stable lexicon-safe id (lowercase, persisted on PDS records). */
  id: string;
  /** Display name shown to users. */
  name: string;
  /** Bare hostname (used in UI subtitles + as the profile URL host). */
  domain: string;
  /**
   * URL for the small button-icon. By default we route through Google's
   * S2 favicon CDN so each client's real favicon comes through without
   * us having to ship per-client artwork. A few entries (e.g. witchsky)
   * override this with a locally-hosted asset.
   */
  iconUrl: string;
  /** Returns the profile URL for a given handle on this client. */
  profileUrl: (handle: string) => string;
}

const profileUrlAt = (host: string) => (handle: string): string =>
  `https://${host}/profile/${encodeURIComponent(handle)}`;

const faviconFor = (domain: string, size = 64): string =>
  `https://www.google.com/s2/favicons?sz=${size}&domain=${
    encodeURIComponent(domain)
  }`;

export const BSKY_CLIENTS: BskyClient[] = [
  {
    id: "bluesky",
    name: "Bluesky",
    domain: "bsky.app",
    iconUrl: faviconFor("bsky.app"),
    profileUrl: profileUrlAt("bsky.app"),
  },
  {
    id: "blacksky",
    name: "Blacksky",
    domain: "blacksky.community",
    iconUrl: faviconFor("blacksky.community"),
    profileUrl: profileUrlAt("blacksky.community"),
  },
  {
    id: "anisota",
    name: "Anisota",
    domain: "anisota.net",
    iconUrl: faviconFor("anisota.net"),
    profileUrl: profileUrlAt("anisota.net"),
  },
  {
    id: "deer",
    name: "Deer Social",
    domain: "deer.social",
    iconUrl: faviconFor("deer.social"),
    profileUrl: profileUrlAt("deer.social"),
  },
  {
    /**
     * Locally-hosted because witchsky.app's served favicon isn't a clean
     * mark — the user supplied a higher-fidelity icon to use instead.
     */
    id: "witchsky",
    name: "Witchsky",
    domain: "witchsky.app",
    iconUrl: "/clients/witchsky.png",
    profileUrl: profileUrlAt("witchsky.app"),
  },
];

export const BSKY_CLIENT_IDS = BSKY_CLIENTS.map((c) => c.id);
export type BskyClientId = typeof BSKY_CLIENT_IDS[number];
export const DEFAULT_BSKY_CLIENT_ID = "bluesky";

export function getBskyClient(id: string | null | undefined): BskyClient {
  return BSKY_CLIENTS.find((c) => c.id === id) ?? BSKY_CLIENTS[0];
}
