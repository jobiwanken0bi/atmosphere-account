import {
  type AccountHost,
  type AccountHostLookup,
  accountManagementUrlForEndpoint,
} from "./account-hosts.ts";

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
    | "service_endpoint"
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
  const derivedAccountUrl = accountManagementUrlForEndpoint(serviceEndpoint);
  const accountManagementUrl = input.host?.accountManagementUrl ??
    derivedAccountUrl ??
    input.host?.dashboardUrl ??
    null;
  const source = input.host?.accountManagementUrl
    ? "explicit_account_management_url"
    : derivedAccountUrl
    ? "service_endpoint"
    : input.host?.dashboardUrl
    ? "legacy_dashboard_url"
    : "unknown";

  return {
    host,
    displayName: input.host?.displayName ?? input.lookup?.displayName ?? host,
    accountManagementUrl,
    serviceEndpoint,
    directoryUrl: `/hosts/${encodeURIComponent(host)}`,
    supportUrl: input.host?.supportUrl ?? null,
    manifestUrl: input.host?.capabilityManifestUrl ?? null,
    source,
  };
}
