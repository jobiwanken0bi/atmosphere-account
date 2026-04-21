/**
 * Map a raw PDS URL → a friendly "account provider" name shown on the
 * public profile footer.
 *
 * The PDS host is usually a per-shard fungus name (e.g.
 * `shimeji.us-east.host.bsky.network`) which isn't very useful in UI.
 * We collapse known umbrella providers to their canonical brand and
 * fall back to the bare hostname for anything else.
 *
 * Add new providers by extending `KNOWN_PROVIDERS` — keep the patterns
 * specific enough that we don't accidentally rebrand somebody's
 * self-hosted PDS.
 */

interface ProviderMatcher {
  /** Predicate: does this hostname belong to the provider? */
  match: (host: string) => boolean;
  /** Friendly display name. */
  name: string;
}

const KNOWN_PROVIDERS: ProviderMatcher[] = [
  {
    name: "Bluesky",
    match: (host) =>
      host === "bsky.network" ||
      host === "bsky.social" ||
      host.endsWith(".bsky.network"),
  },
];

export function accountProviderName(pdsUrl: string | null | undefined): string {
  if (!pdsUrl) return "";
  let host: string;
  try {
    host = new URL(pdsUrl).host;
  } catch {
    return pdsUrl;
  }
  for (const p of KNOWN_PROVIDERS) {
    if (p.match(host)) return p.name;
  }
  return host;
}
