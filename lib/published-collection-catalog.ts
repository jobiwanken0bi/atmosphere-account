import {
  collectionFallbackLabel,
  isCollectionNsid,
} from "./collection-nsid.ts";
import type { CollectionSuggestion } from "./collection-catalog.ts";
import { readResponseTextWithLimit } from "./security.ts";

const LEXICON_GARDEN_ORIGIN = "https://lexicon.garden";
const AUTOCOMPLETE_PATH = "/api/autocomplete-nsid";
const BROWSE_PATH = "/xrpc/garden.lexicon.browse";
const FETCH_TIMEOUT_MS = 3_500;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_RESULTS = 20;
const CACHE_TTL_MS = 10 * 60_000;
const ERROR_CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 250;

export interface PublishedCollectionSearchResult {
  suggestions: CollectionSuggestion[];
  unavailable: boolean;
}

interface CacheEntry {
  expiresAt: number;
  result: PublishedCollectionSearchResult;
}

const cache = new Map<string, CacheEntry>();

/**
 * Normalize the public typeahead input. Collection discovery is intentionally
 * limited to NSID-like fragments so this endpoint cannot become a general
 * third-party search proxy.
 */
export function normalizeCollectionSearchQuery(value: string): string | null {
  const query = value.trim();
  if (query.length < 2 || query.length > 256) return null;
  return /^[A-Za-z0-9.-]+$/.test(query) ? query : null;
}

function publishedSuggestion(
  id: string,
  catalogUrl?: string,
): CollectionSuggestion {
  return {
    id,
    label: collectionFallbackLabel(id),
    description: null,
    common: false,
    detected: false,
    writesCount: 0,
    readsCount: 0,
    published: true,
    ...(catalogUrl ? { catalogUrl } : {}),
  };
}

function safeCatalogUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/lexicon/")) {
    return undefined;
  }
  try {
    const url = new URL(value, LEXICON_GARDEN_ORIGIN);
    if (url.origin !== LEXICON_GARDEN_ORIGIN) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function parseLexiconGardenAutocomplete(
  value: unknown,
  limit = MAX_RESULTS,
): CollectionSuggestion[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const items = (value as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(items)) return null;

  const suggestions: CollectionSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (row.type !== "nsid" || typeof row.label !== "string") continue;
    const id = row.label.trim();
    const dedupeKey = id;
    if (!isCollectionNsid(id) || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    suggestions.push(publishedSuggestion(id, safeCatalogUrl(row.url)));
    if (suggestions.length >= Math.max(0, limit)) break;
  }
  return suggestions;
}

export function parseLexiconGardenBrowse(
  value: unknown,
  limit = 100,
): CollectionSuggestion[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const items = (value as { lexicons?: unknown }).lexicons;
  if (!Array.isArray(items)) return null;

  const suggestions: CollectionSuggestion[] = [];
  const seen = new Set<string>();
  for (const value of items) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    const dedupeKey = id;
    if (!isCollectionNsid(id) || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    suggestions.push(publishedSuggestion(id));
    if (suggestions.length >= Math.max(0, limit)) break;
  }
  return suggestions;
}

/**
 * Lexicon Garden's documented browse endpoint accepts complete NSID segments,
 * not a partial final segment. Dropping the segment being typed gives the
 * fallback a useful parent prefix.
 */
export function collectionBrowsePrefix(query: string): string | null {
  const normalized = normalizeCollectionSearchQuery(query);
  if (!normalized) return null;
  const withoutTrailingDots = normalized.replace(/\.+$/, "");
  if (!withoutTrailingDots) return null;
  if (normalized.endsWith(".")) return withoutTrailingDots;
  const segments = withoutTrailingDots.split(".");
  return segments.length > 1 ? segments.slice(0, -1).join(".") : segments[0];
}

async function boundedJson(
  url: URL,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetcher(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });
  if (!response.ok) throw new Error(`Catalog returned HTTP ${response.status}`);
  const bounded = await readResponseTextWithLimit(response, MAX_RESPONSE_BYTES);
  if (!bounded.ok) throw new Error(`Catalog ${bounded.error}`);
  return JSON.parse(bounded.text);
}

export async function queryLexiconGarden(
  query: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PublishedCollectionSearchResult> {
  const normalized = normalizeCollectionSearchQuery(query);
  if (!normalized) return { suggestions: [], unavailable: false };

  const autocompleteUrl = new URL(AUTOCOMPLETE_PATH, LEXICON_GARDEN_ORIGIN);
  autocompleteUrl.searchParams.set("q", normalized);
  autocompleteUrl.searchParams.set("type", "record");
  try {
    const value = await boundedJson(autocompleteUrl, fetcher, signal);
    const suggestions = parseLexiconGardenAutocomplete(value);
    if (suggestions) return { suggestions, unavailable: false };
    throw new Error("Catalog returned an invalid response");
  } catch (autocompleteError) {
    if (signal?.aborted) return { suggestions: [], unavailable: true };
    const prefix = collectionBrowsePrefix(normalized);
    if (!prefix) return { suggestions: [], unavailable: true };
    const browseUrl = new URL(BROWSE_PATH, LEXICON_GARDEN_ORIGIN);
    browseUrl.searchParams.set("prefix", prefix);
    browseUrl.searchParams.set("limit", "100");
    browseUrl.searchParams.set("lexiconType", "record");
    try {
      const value = await boundedJson(browseUrl, fetcher, signal);
      const suggestions = parseLexiconGardenBrowse(value);
      if (suggestions) {
        const needle = normalized.toLowerCase();
        return {
          suggestions: suggestions.filter((item) =>
            item.id.toLowerCase().includes(needle) ||
            item.label.toLowerCase().includes(needle)
          ).slice(0, MAX_RESULTS),
          unavailable: false,
        };
      }
    } catch (browseError) {
      console.warn("[collection-catalog] published search unavailable:", {
        autocompleteError,
        browseError,
      });
    }
    return { suggestions: [], unavailable: true };
  }
}

function trimCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export async function searchPublishedCollections(
  query: string,
  options: {
    fetcher?: typeof fetch;
    now?: number;
    signal?: AbortSignal;
  } = {},
): Promise<PublishedCollectionSearchResult> {
  const normalized = normalizeCollectionSearchQuery(query);
  if (!normalized) return { suggestions: [], unavailable: false };
  const key = normalized;
  const now = options.now ?? Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;

  const result = await queryLexiconGarden(
    normalized,
    options.fetcher ?? fetch,
    options.signal,
  );
  if (options.signal?.aborted) return result;
  trimCache(now);
  cache.set(key, {
    expiresAt: now + (result.unavailable ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS),
    result,
  });
  return result;
}
