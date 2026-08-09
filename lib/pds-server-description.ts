import { normalizeServiceEndpoint } from "./identity.ts";
import {
  isPrivateNetworkHostname,
  readResponseTextWithLimit,
} from "./security.ts";

export interface PdsServerDescription {
  did: string | null;
  availableUserDomains: string[];
  inviteCodeRequired: boolean | null;
  phoneVerificationRequired: boolean | null;
  privacyPolicyUrl: string | null;
  termsOfServiceUrl: string | null;
  contactEmail: string | null;
  checkedAt: number;
}

/**
 * Apply narrowly scoped corrections when a provider's public describeServer
 * response does not match its actual signup flow. The AT Protocol lexicon says
 * phoneVerificationRequired means every new account must supply a phone token;
 * Bluesky currently advertises true even though its signup flow does not.
 */
export function pdsServerDescriptionForAccountHost(
  accountHost: string,
  description: PdsServerDescription | null,
): PdsServerDescription | null {
  if (!description) return null;
  if (
    accountHost.trim().toLowerCase() === "bsky.network" &&
    description.phoneVerificationRequired === true
  ) {
    return { ...description, phoneVerificationRequired: false };
  }
  return description;
}

const DESCRIBE_SERVER_PATH = "/xrpc/com.atproto.server.describeServer";
const DESCRIBE_SERVER_TIMEOUT_MS = 2500;
const DESCRIBE_SERVER_MAX_BYTES = 32_000;
const DESCRIBE_SERVER_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_DESCRIBE_SERVER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DESCRIBE_SERVER_CACHE_ENTRIES = 500;
const MAX_AVAILABLE_USER_DOMAINS = 100;

const cache = new Map<
  string,
  { expiresAt: number; value: PdsServerDescription | null }
>();

function now(): number {
  return Date.now();
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringOrNull(value: unknown, maxLength = 2_048): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maxLength && !hasControlCharacters(text)
    ? text
    : null;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function didOrNull(value: unknown): string | null {
  const did = stringOrNull(value);
  return did && /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(did) ? did : null;
}

function publicUrlOrNull(value: unknown): string | null {
  const raw = stringOrNull(value, 2_048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" || url.username || url.password ||
      isPrivateNetworkHostname(url.hostname)
    ) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function availableDomainOrNull(value: unknown): string | null {
  const raw = stringOrNull(value, 255)?.replace(/^@/, "").replace(/^\./, "")
    .toLowerCase();
  if (!raw || raw.length > 253) return null;
  const labels = raw.split(".");
  if (labels.length < 2) return null;
  const valid = labels.every((label) =>
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
  return valid ? raw : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parsePdsServerDescription(
  value: unknown,
  checkedAt = now(),
): PdsServerDescription | null {
  const record = recordOrNull(value);
  if (!record) return null;

  const rawDomains = Array.isArray(record.availableUserDomains)
    ? record.availableUserDomains.slice(0, MAX_AVAILABLE_USER_DOMAINS)
    : [];
  const availableUserDomains = [
    ...new Set(
      rawDomains.map(availableDomainOrNull).filter((domain) => domain !== null),
    ),
  ] as string[];
  const links = recordOrNull(record.links);
  const contact = recordOrNull(record.contact);

  return {
    did: didOrNull(record.did),
    availableUserDomains,
    inviteCodeRequired: boolOrNull(record.inviteCodeRequired),
    phoneVerificationRequired: boolOrNull(record.phoneVerificationRequired),
    privacyPolicyUrl: publicUrlOrNull(links?.privacyPolicy),
    termsOfServiceUrl: publicUrlOrNull(links?.termsOfService),
    contactEmail: stringOrNull(contact?.email, 254),
    checkedAt,
  };
}

export async function fetchPdsServerDescription(
  serviceEndpoint: string | null | undefined,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    cacheTtlMs?: number;
    checkedAt?: number;
  } = {},
): Promise<PdsServerDescription | null> {
  if (!serviceEndpoint?.trim()) return null;
  let normalized: string;
  try {
    normalized = new URL(normalizeServiceEndpoint(serviceEndpoint)).origin;
  } catch {
    return null;
  }

  const requestedCheckedAt = options.checkedAt ?? now();
  const ts = Number.isFinite(requestedCheckedAt) && requestedCheckedAt >= 0
    ? Math.floor(requestedCheckedAt)
    : now();
  const requestedCacheTtl = options.cacheTtlMs ??
    DESCRIBE_SERVER_CACHE_TTL_MS;
  const cacheTtlMs = Number.isFinite(requestedCacheTtl)
    ? Math.min(
      MAX_DESCRIBE_SERVER_CACHE_TTL_MS,
      Math.max(0, Math.floor(requestedCacheTtl)),
    )
    : DESCRIBE_SERVER_CACHE_TTL_MS;
  const requestedTimeout = options.timeoutMs ?? DESCRIBE_SERVER_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(30_000, Math.max(500, Math.floor(requestedTimeout)))
    : DESCRIBE_SERVER_TIMEOUT_MS;
  const cached = cache.get(normalized);
  if (cacheTtlMs > 0 && cached && cached.expiresAt > ts) return cached.value;

  const url = new URL(DESCRIBE_SERVER_PATH, normalized);
  const fetchImpl = options.fetchImpl ?? fetch;
  let value: PdsServerDescription | null = null;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
    } else if (!isJsonMediaType(response.headers.get("content-type"))) {
      await response.body?.cancel().catch(() => {});
    } else {
      const text = await readResponseTextWithLimit(
        response,
        DESCRIBE_SERVER_MAX_BYTES,
      );
      if (text.ok) {
        value = parsePdsServerDescription(JSON.parse(text.text), ts);
      }
    }
  } catch {
    value = null;
  }

  trimDescriptionCache(ts);
  cache.delete(normalized);
  cache.set(normalized, { value, expiresAt: ts + cacheTtlMs });
  return value;
}

function isJsonMediaType(value: string | null): boolean {
  const mediaType = (value ?? "").split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function trimDescriptionCache(ts: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= ts) cache.delete(key);
  }
  while (cache.size >= MAX_DESCRIBE_SERVER_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}
