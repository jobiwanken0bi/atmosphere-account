import type { AppListing } from "./app-directory.ts";
import type { AppDirectoryLink } from "./app-lexicons.ts";
import {
  type AppMetadataLinkKind,
  appMetadataLinkKind,
} from "./app-metadata-links.ts";
import { fetchPinnedPublicHttps } from "./pinned-public-https.ts";
import { isPrivateNetworkHostname } from "./security.ts";

const MAX_METADATA_BYTES = 64 * 1024;
const MAX_SCOPE_LENGTH = 16 * 1024;
const MAX_SCOPE_TOKENS = 64;
const POSITIVE_CACHE_MS = 30 * 60_000;
const NEGATIVE_CACHE_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 256;

export interface AppPublicMetadata {
  privacyUrl: string | null;
  termsUrl: string | null;
  scopes: string[];
  oauthMetadataUrl: string | null;
}

interface MetadataDocument {
  privacyUrl: string | null;
  termsUrl: string | null;
  scopes: string[];
  sourceUrl: string;
}

interface MetadataOptions {
  /** Test seam. Production uses IP-pinned public HTTPS requests. */
  publicFetch?: typeof fetch;
  now?: number;
}

const cache = new Map<
  string,
  { expiresAt: number; value: AppPublicMetadata | Promise<AppPublicMetadata> }
>();

export async function getAppPublicMetadata(
  app: Pick<AppListing, "primaryUrl" | "links">,
  options: MetadataOptions = {},
): Promise<AppPublicMetadata> {
  const explicitPrivacy = linkForKind(app.links, "privacy");
  const explicitTerms = linkForKind(app.links, "terms");
  const explicitMetadata = app.links
    .filter((link) => appMetadataLinkKind(link) === "oauth_metadata")
    .map((link) => safePublicHttpsUrl(link.uri))
    .filter((url): url is string => !!url);
  const primary = safePublicHttpsUrl(app.primaryUrl);
  const cacheKey = JSON.stringify([
    primary,
    explicitPrivacy,
    explicitTerms,
    explicitMetadata,
  ]);
  const now = options.now ?? Date.now();
  if (!options.publicFetch) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return await cached.value;
    if (cached) cache.delete(cacheKey);
  }

  const loading = loadMetadata({
    primary,
    explicitPrivacy,
    explicitTerms,
    explicitMetadata,
    publicFetch: options.publicFetch,
  });
  if (!options.publicFetch) {
    cache.set(cacheKey, {
      expiresAt: now + POSITIVE_CACHE_MS,
      value: loading,
    });
    trimCache();
  }
  const value = await loading;
  if (!options.publicFetch) {
    const positive = !!(
      value.privacyUrl || value.termsUrl || value.scopes.length
    );
    cache.set(cacheKey, {
      expiresAt: now + (positive ? POSITIVE_CACHE_MS : NEGATIVE_CACHE_MS),
      value,
    });
  }
  return value;
}

async function loadMetadata(input: {
  primary: string | null;
  explicitPrivacy: string | null;
  explicitTerms: string | null;
  explicitMetadata: string[];
  publicFetch?: typeof fetch;
}): Promise<AppPublicMetadata> {
  const metadataCandidates = [...input.explicitMetadata];
  if (input.primary) {
    metadataCandidates.push(
      new URL("/oauth-client-metadata.json", input.primary).href,
      new URL("/oauth/client-metadata.json", input.primary).href,
    );
  }
  const uniqueMetadata = [...new Set(metadataCandidates)];
  const [documents, privacyProbe, termsProbe] = await Promise.all([
    Promise.all(
      uniqueMetadata.map((url) =>
        fetchMetadataDocument(url, input.publicFetch)
      ),
    ),
    input.explicitPrivacy || !input.primary
      ? Promise.resolve(null)
      : probePublicPage(
        new URL("/privacy", input.primary).href,
        input.publicFetch,
      ),
    input.explicitTerms || !input.primary
      ? Promise.resolve(null)
      : probePublicPage(
        new URL("/terms", input.primary).href,
        input.publicFetch,
      ),
  ]);
  const document = documents.find((candidate) => !!candidate) ?? null;
  return {
    privacyUrl: input.explicitPrivacy ?? document?.privacyUrl ?? privacyProbe,
    termsUrl: input.explicitTerms ?? document?.termsUrl ?? termsProbe,
    scopes: document?.scopes ?? [],
    oauthMetadataUrl: document?.sourceUrl ?? null,
  };
}

async function fetchMetadataDocument(
  url: string,
  publicFetch?: typeof fetch,
): Promise<MetadataDocument | null> {
  try {
    const response = await publicRequest(url, "GET", publicFetch);
    if (!response.ok || response.status !== 200) return null;
    const text = await response.text();
    if (!text || text.length > MAX_METADATA_BYTES) return null;
    const value = JSON.parse(text) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const clientId = safePublicHttpsUrl(value.client_id);
    if (clientId && canonicalUrl(clientId) !== canonicalUrl(url)) return null;
    return {
      privacyUrl: safePublicHttpsUrl(value.policy_uri),
      termsUrl: safePublicHttpsUrl(value.tos_uri),
      scopes: parseScopes(value.scope),
      sourceUrl: url,
    };
  } catch {
    return null;
  }
}

async function probePublicPage(
  url: string,
  publicFetch?: typeof fetch,
): Promise<string | null> {
  try {
    const response = await publicRequest(url, "HEAD", publicFetch);
    return response.ok && response.status >= 200 && response.status < 300
      ? url
      : null;
  } catch {
    return null;
  }
}

async function publicRequest(
  url: string,
  method: "GET" | "HEAD",
  publicFetch?: typeof fetch,
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: {
      accept: method === "GET" ? "application/json" : "text/html",
      "user-agent": "AtmosphereAccount-AppMetadata/1.0",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(3_000),
  };
  if (publicFetch) return await publicFetch(url, init);
  return await fetchPinnedPublicHttps(url, init, {
    maxBodyBytes: method === "GET" ? MAX_METADATA_BYTES : 1024,
    timeoutMs: 3_000,
  });
}

function linkForKind(
  links: AppDirectoryLink[],
  kind: Extract<AppMetadataLinkKind, "privacy" | "terms">,
): string | null {
  for (const link of links) {
    if (appMetadataLinkKind(link) !== kind) continue;
    const url = safePublicHttpsUrl(link.uri);
    if (url) return url;
  }
  return null;
}

function parseScopes(value: unknown): string[] {
  if (typeof value !== "string" || value.length > MAX_SCOPE_LENGTH) return [];
  return [
    ...new Set(
      value.trim().split(/\s+/).filter((token) =>
        token.length > 0 && token.length <= 1024
      ),
    ),
  ].slice(0, MAX_SCOPE_TOKENS);
}

function safePublicHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.username || url.password ||
      isPrivateNetworkHostname(url.hostname)
    ) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

function trimCache(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) return;
    cache.delete(oldest);
  }
}

export function scopeDescription(token: string): string {
  if (token === "atproto") return "Identify your AT Protocol account.";
  if (token === "account:email") {
    return "Read the email address exposed by your account host.";
  }
  if (token.startsWith("transition:")) {
    return "Use a transitional permission with broader legacy access.";
  }
  if (token.startsWith("include:")) {
    return `Use the ${
      readableScopeName(token.slice("include:".length))
    } permission bundle.`;
  }
  if (
    token.split("?", 1)[0] ===
      "repo:com.atmosphereaccount.registry.update"
  ) {
    return "Access legacy Atmosphere What’s New records for compatibility.";
  }
  if (token.startsWith("repo:")) {
    return `Access ${scopeTarget(token, "repo:")} records in your account.`;
  }
  if (token.startsWith("rpc:")) {
    return `Call the ${scopeTarget(token, "rpc:")} service API.`;
  }
  if (token.startsWith("blob:")) {
    return "Upload files or media to your account.";
  }
  return "Request this permission when you connect your account.";
}

function scopeTarget(token: string, prefix: string): string {
  return token.slice(prefix.length).split("?")[0] || "listed";
}

function readableScopeName(value: string): string {
  const nsid = value.split("?")[0];
  return nsid.split(".").at(-1)?.replace(/([a-z0-9])([A-Z])/g, "$1 $2") ||
    "listed";
}
