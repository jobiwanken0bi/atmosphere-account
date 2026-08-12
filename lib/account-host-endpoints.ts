/**
 * Explicit directory-host to PDS endpoint bindings compiled into the service.
 *
 * Most directory hosts are the PDS hostname itself. A small number of curated
 * umbrella entries intentionally use a different canonical directory domain.
 * Those exceptions remain compiled so mutable database fields cannot introduce
 * a new cross-domain service endpoint.
 */
import { isPrivateNetworkHostname } from "./security.ts";

const COMPILED_ACCOUNT_HOST_SERVICE_ENDPOINTS = new Map<string, string>([
  ["bsky.network", "https://bsky.social"],
]);

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Return the canonical directory hostname used for proofs that must be made by
 * the host itself. This deliberately does not consult the compiled umbrella
 * mappings above: a contact address served by another origin must never prove
 * control of the directory hostname.
 */
export function normalizeAccountHostContactHost(host: string): string | null {
  const normalized = normalizeHostname(host);
  if (!normalized || normalized.length > 253) return null;
  if (isPrivateNetworkHostname(normalized)) return null;
  // Directory hosts are DNS names, never IP literals (including public ones).
  if (
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":")
  ) {
    return null;
  }
  const labels = normalized.split(".");
  if (labels.length < 2) return null;
  if (/^[0-9]/.test(labels[labels.length - 1])) return null;
  if (
    labels.some((label) =>
      label.length < 1 || label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  ) return null;
  return normalized;
}

/** Exact HTTPS origin from which host-bound contact metadata may be read. */
export function accountHostContactEndpoint(host: string): string | null {
  const normalized = normalizeAccountHostContactHost(host);
  return normalized ? `https://${normalized}` : null;
}

/**
 * Check an endpoint only against the host's exact HTTPS origin. Kept as a
 * small public helper for callers that need to reject mutable/cross-origin
 * metadata; compiled umbrella endpoints are intentionally not accepted.
 */
export function accountHostContactEndpointIsBound(
  host: string,
  endpoint: string,
): boolean {
  const expected = accountHostContactEndpoint(host);
  if (!expected) return false;
  try {
    const url = new URL(endpoint);
    return url.origin === expected &&
      (url.pathname === "/" || url.pathname === "") &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function compiledAccountHostServiceEndpoint(
  host: string,
): string | null {
  return COMPILED_ACCOUNT_HOST_SERVICE_ENDPOINTS.get(
    normalizeHostname(host),
  ) ?? null;
}
