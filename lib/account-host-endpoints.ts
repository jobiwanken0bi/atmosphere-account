/**
 * Explicit directory-host to PDS endpoint bindings compiled into the service.
 *
 * Most directory hosts are the PDS hostname itself. A small number of curated
 * umbrella entries intentionally use a different canonical directory domain.
 * Those exceptions must be exact origins: mutable database fields cannot add a
 * new cross-domain contact-email authority.
 */
const COMPILED_ACCOUNT_HOST_SERVICE_ENDPOINTS = new Map<string, string>([
  ["bsky.network", "https://bsky.social"],
]);

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function compiledAccountHostServiceEndpoint(
  host: string,
): string | null {
  return COMPILED_ACCOUNT_HOST_SERVICE_ENDPOINTS.get(
    normalizeHostname(host),
  ) ?? null;
}

export function accountHostContactEndpointIsBound(
  host: string,
  endpoint: string,
): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  const normalizedHost = normalizeHostname(host);
  if (normalizeHostname(url.hostname) === normalizedHost) return true;

  const compiledEndpoint = compiledAccountHostServiceEndpoint(normalizedHost);
  if (!compiledEndpoint) return false;
  const compiledUrl = new URL(compiledEndpoint);
  return url.origin.toLowerCase() === compiledUrl.origin.toLowerCase();
}
