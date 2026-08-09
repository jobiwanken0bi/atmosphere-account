/**
 * Explicit directory-host to PDS endpoint bindings compiled into the service.
 *
 * Most directory hosts are the PDS hostname itself. A small number of curated
 * umbrella entries intentionally use a different canonical directory domain.
 * Those exceptions remain compiled so mutable database fields cannot introduce
 * a new cross-domain service endpoint.
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
