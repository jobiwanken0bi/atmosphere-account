import { type AccountHost, type AccountHostLookup } from "./account-hosts.ts";
import { isPrivateNetworkHostname } from "./security.ts";

export interface HostAccountRouteState {
  host: string;
  displayName: string;
  accountManagementUrl: string | null;
  serviceEndpoint: string | null;
  directoryUrl: string;
  supportUrl: string | null;
  manifestUrl: string | null;
  source:
    | "explicit_account_management_url"
    | "legacy_dashboard_url"
    | "unknown";
}

export function buildHostAccountRoute(input: {
  host: AccountHost | null;
  lookup?: AccountHostLookup | null;
}): HostAccountRouteState | null {
  const host = input.host?.host ?? input.lookup?.host ?? null;
  if (!host) return null;

  const serviceEndpoint = input.host?.serviceEndpoint ??
    input.lookup?.endpoint ??
    null;
  const explicitAccountManagementUrl = safePublicHostUrl(
    input.host?.accountManagementUrl,
  );
  const legacyDashboardUrl = safePublicHostUrl(input.host?.dashboardUrl);
  const accountManagementUrl = explicitAccountManagementUrl ??
    legacyDashboardUrl;
  const source = explicitAccountManagementUrl
    ? "explicit_account_management_url"
    : legacyDashboardUrl
    ? "legacy_dashboard_url"
    : "unknown";

  return {
    host,
    displayName: input.host?.displayName ?? input.lookup?.displayName ?? host,
    accountManagementUrl,
    serviceEndpoint,
    directoryUrl: `/hosts/${encodeURIComponent(host)}`,
    supportUrl: safePublicHostUrl(input.host?.supportUrl),
    manifestUrl: safePublicHostUrl(input.host?.capabilityManifestUrl),
    source,
  };
}

export function safePublicHostUrl(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (isPrivateNetworkHostname(url.hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
