import { type AccountHost, type AccountHostLookup } from "./account-hosts.ts";
import { safePublicHostUrl } from "./host-account-routing.ts";
import {
  isPrivateNetworkHostname,
  readResponseTextWithLimit,
} from "./security.ts";

export const HOST_DASHBOARD_SPEC_VERSION = "atmosphere.hostDashboard.v0.1";
const HOST_DASHBOARD_WELL_KNOWN = "/.well-known/atmosphere-host-dashboard.json";
const MAX_HOST_DASHBOARD_MANIFEST_BYTES = 64_000;

export type HostDashboardCapabilityKey =
  | "accountOverview"
  | "connectedApps"
  | "devices"
  | "password"
  | "accountDeletion"
  | "rotationKeys"
  | "repoExport"
  | "blobExport"
  | "backupStatus"
  | "restore"
  | "migration"
  | "support";

export type HostDashboardCapabilityState =
  | "supported"
  | "host_owned"
  | "planned"
  | "unknown";

export interface HostDashboardCapability {
  key: HostDashboardCapabilityKey;
  label: string;
  description: string;
  state: HostDashboardCapabilityState;
  href: string | null;
}

export interface HostDashboardState {
  version: typeof HOST_DASHBOARD_SPEC_VERSION;
  host: string;
  displayName: string;
  accountManagementUrl: string | null;
  dashboardUrl: string | null;
  manifestUrl: string | null;
  supportUrl: string | null;
  supportedCount: number;
  capabilities: HostDashboardCapability[];
}

export interface HostDashboardManifest {
  version: typeof HOST_DASHBOARD_SPEC_VERSION;
  host: string;
  displayName?: string;
  dashboardUrl?: string;
  supportUrl?: string;
  capabilities?: Partial<
    Record<
      HostDashboardCapabilityKey,
      {
        state?: HostDashboardCapabilityState;
        href?: string;
        description?: string;
      }
    >
  >;
}

export interface HostDashboardValidationIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface HostDashboardValidationResult {
  ok: boolean;
  manifest: HostDashboardManifest | null;
  issues: HostDashboardValidationIssue[];
}

export interface HostDashboardFetchResult
  extends HostDashboardValidationResult {
  url: string;
  status: number | null;
}

type CapabilityOverrides = HostDashboardManifest["capabilities"];

export const HOST_DASHBOARD_CAPABILITY_DEFINITIONS: Array<
  Omit<HostDashboardCapability, "state" | "href">
> = [
  {
    key: "accountOverview",
    label: "Account overview",
    description: "Profile, handle, DID, and account host summary.",
  },
  {
    key: "connectedApps",
    label: "Connected apps",
    description: "OAuth grants and app permissions managed by the host.",
  },
  {
    key: "devices",
    label: "Devices",
    description: "Active sessions, devices, and saved sign-in keys.",
  },
  {
    key: "password",
    label: "Password",
    description: "Password changes, reset, and account authentication methods.",
  },
  {
    key: "accountDeletion",
    label: "Account lifecycle",
    description: "Deactivate or delete account workflows owned by the host.",
  },
  {
    key: "rotationKeys",
    label: "Rotation keys",
    description: "Key status, recovery education, and rotation workflows.",
  },
  {
    key: "repoExport",
    label: "Repo export",
    description: "Signed repository export for backup or migration.",
  },
  {
    key: "blobExport",
    label: "Blob export",
    description: "Media/blob export and coverage checks.",
  },
  {
    key: "backupStatus",
    label: "Backup status",
    description: "Host-owned backup health and restore readiness.",
  },
  {
    key: "restore",
    label: "Restore",
    description: "Host-owned account restore workflows.",
  },
  {
    key: "migration",
    label: "Migration",
    description: "Move readiness and destination-host handoff.",
  },
  {
    key: "support",
    label: "Support",
    description: "Host help, terms, privacy, and contact routes.",
  },
];

export const HOST_DASHBOARD_CAPABILITY_KEYS =
  HOST_DASHBOARD_CAPABILITY_DEFINITIONS.map((definition) => definition.key);

const DEFAULT_STATES: Record<
  HostDashboardCapabilityKey,
  HostDashboardCapabilityState
> = {
  accountOverview: "host_owned",
  connectedApps: "host_owned",
  devices: "host_owned",
  password: "host_owned",
  accountDeletion: "host_owned",
  rotationKeys: "host_owned",
  repoExport: "planned",
  blobExport: "planned",
  backupStatus: "planned",
  restore: "planned",
  migration: "planned",
  support: "host_owned",
};

export function buildHostDashboardState(input: {
  host: AccountHost | null;
  lookup?: AccountHostLookup | null;
}): HostDashboardState | null {
  const hostName = input.host?.host ?? input.lookup?.host ?? null;
  if (!hostName) return null;
  const displayName = input.host?.displayName ?? input.lookup?.displayName ??
    hostName;
  const accountManagementUrl = safePublicHostUrl(
    input.host?.accountManagementUrl,
  ) ?? safePublicHostUrl(input.host?.dashboardUrl);
  const dashboardUrl = accountManagementUrl;
  const supportUrl = safePublicHostUrl(input.host?.supportUrl) ??
    safePublicHostUrl(input.host?.homepageUrl);
  const manifestUrl = input.host?.capabilityManifestUrl ??
    defaultManifestUrl(
      input.host?.serviceEndpoint ?? input.lookup?.endpoint ??
        input.host?.dashboardUrl ??
        hostName,
    );
  const overrides = parseCapabilityOverrides(input.host?.capabilitiesJson);
  const capabilities = HOST_DASHBOARD_CAPABILITY_DEFINITIONS.map(
    (definition) => {
      const override = overrides?.[definition.key];
      const state = override?.state ?? DEFAULT_STATES[definition.key];
      return {
        ...definition,
        description: override?.description ?? definition.description,
        state,
        href: override?.href ?? defaultCapabilityHref(
          definition.key,
          state,
          dashboardUrl,
          supportUrl,
        ),
      };
    },
  );
  return {
    version: HOST_DASHBOARD_SPEC_VERSION,
    host: hostName,
    displayName,
    accountManagementUrl,
    dashboardUrl,
    manifestUrl,
    supportUrl,
    supportedCount:
      capabilities.filter((capability) => capability.state === "supported")
        .length,
    capabilities,
  };
}

export function parseHostDashboardManifest(
  value: unknown,
): HostDashboardManifest | null {
  const validation = validateHostDashboardManifest(value);
  return validation.ok ? validation.manifest : null;
}

export function validateHostDashboardManifest(
  value: unknown,
  opts: { expectedHost?: string } = {},
): HostDashboardValidationResult {
  const issues: HostDashboardValidationIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      manifest: null,
      issues: [
        {
          severity: "error",
          path: "$",
          message: "Manifest must be a JSON object.",
        },
      ],
    };
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (
      ![
        "version",
        "host",
        "displayName",
        "dashboardUrl",
        "supportUrl",
        "capabilities",
      ].includes(key)
    ) {
      issues.push({
        severity: "warning",
        path: `$.${key}`,
        message: "Unknown top-level property will be ignored by Atmosphere.",
      });
    }
  }

  if (record.version !== HOST_DASHBOARD_SPEC_VERSION) {
    issues.push({
      severity: "error",
      path: "$.version",
      message: `Expected ${HOST_DASHBOARD_SPEC_VERSION}.`,
    });
  }

  const host = normalizeManifestHost(record.host);
  if (!host) {
    issues.push({
      severity: "error",
      path: "$.host",
      message: "Host must be a hostname such as example.social.",
    });
  }

  const expectedHost = opts.expectedHost
    ? normalizeManifestHost(opts.expectedHost)
    : null;
  if (host && expectedHost && host !== expectedHost) {
    issues.push({
      severity: "error",
      path: "$.host",
      message:
        `Manifest host ${host} does not match expected host ${expectedHost}.`,
    });
  }

  const dashboardUrl = validateOptionalUrl(
    record.dashboardUrl,
    "$.dashboardUrl",
    issues,
  );
  const supportUrl = validateOptionalUrl(
    record.supportUrl,
    "$.supportUrl",
    issues,
  );
  const capabilities = validateCapabilities(record.capabilities, issues);
  const displayName = typeof record.displayName === "string" &&
      record.displayName.trim()
    ? record.displayName.trim()
    : undefined;

  if (
    record.displayName !== undefined &&
    typeof record.displayName !== "string"
  ) {
    issues.push({
      severity: "error",
      path: "$.displayName",
      message: "Display name must be a string.",
    });
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  return {
    ok: !hasErrors,
    manifest: !hasErrors && host
      ? {
        version: HOST_DASHBOARD_SPEC_VERSION,
        host,
        displayName,
        dashboardUrl,
        supportUrl,
        capabilities,
      }
      : null,
    issues,
  };
}

export function hostDashboardManifestUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "https:") return null;
  if (isPrivateNetworkHostname(url.hostname)) return null;
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  if (path && path !== "") return url.toString();
  return new URL(HOST_DASHBOARD_WELL_KNOWN, url.origin).toString();
}

export async function fetchHostDashboardManifest(
  input: string,
  opts: {
    expectedHost?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<HostDashboardFetchResult> {
  const url = hostDashboardManifestUrl(input);
  if (!url) {
    return {
      ok: false,
      manifest: null,
      issues: [{
        severity: "error",
        path: "$",
        message: "Host dashboard manifest URL is invalid.",
      }],
      url: input,
      status: null,
    };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
  } catch (err) {
    return {
      ok: false,
      manifest: null,
      issues: [{
        severity: "error",
        path: "$",
        message: `Could not fetch manifest: ${
          err instanceof Error ? err.message : String(err)
        }`,
      }],
      url,
      status: null,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      manifest: null,
      issues: [{
        severity: "error",
        path: "$",
        message: `Manifest request returned HTTP ${res.status}.`,
      }],
      url,
      status: res.status,
    };
  }

  const body = await readResponseTextWithLimit(
    res,
    MAX_HOST_DASHBOARD_MANIFEST_BYTES,
  );
  if (!body.ok) {
    return {
      ok: false,
      manifest: null,
      issues: [{
        severity: "error",
        path: "$",
        message: `Manifest response is too large or unreadable: ${body.error}.`,
      }],
      url,
      status: res.status,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch (err) {
    return {
      ok: false,
      manifest: null,
      issues: [{
        severity: "error",
        path: "$",
        message: `Manifest is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      }],
      url,
      status: res.status,
    };
  }

  const validation = validateHostDashboardManifest(json, {
    expectedHost: opts.expectedHost ?? hostFromManifestInput(input) ??
      undefined,
  });
  return { ...validation, url, status: res.status };
}

export function hostDashboardCapabilityStatusLabel(
  state: HostDashboardCapabilityState,
): string {
  switch (state) {
    case "supported":
      return "Supported";
    case "host_owned":
      return "Host-owned";
    case "planned":
      return "Planned";
    default:
      return "Unknown";
  }
}

function parseCapabilityOverrides(
  value: string | null | undefined,
): CapabilityOverrides {
  if (!value) return undefined;
  try {
    return parseCapabilityRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function parseCapabilityRecord(value: unknown): CapabilityOverrides {
  if (!value || typeof value !== "object") return undefined;
  const out: NonNullable<CapabilityOverrides> = {};
  for (const definition of HOST_DASHBOARD_CAPABILITY_DEFINITIONS) {
    const raw = (value as Record<string, unknown>)[definition.key];
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const state = parseCapabilityState(item.state);
    const href = safeUrlString(item.href);
    const description = typeof item.description === "string"
      ? item.description
      : undefined;
    out[definition.key] = { state, href, description };
  }
  return out;
}

function parseCapabilityState(
  value: unknown,
): HostDashboardCapabilityState | undefined {
  return value === "supported" || value === "host_owned" ||
      value === "planned" || value === "unknown"
    ? value
    : undefined;
}

function defaultManifestUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return null;
  }
  return new URL(HOST_DASHBOARD_WELL_KNOWN, url.origin).toString();
}

function defaultCapabilityHref(
  key: HostDashboardCapabilityKey,
  state: HostDashboardCapabilityState,
  dashboardUrl: string | null,
  supportUrl: string | null,
): string | null {
  if (state === "planned" || state === "unknown") return null;
  if (key === "support") return supportUrl;
  return dashboardUrl;
}

function safeUrlString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function validateCapabilities(
  value: unknown,
  issues: HostDashboardValidationIssue[],
): CapabilityOverrides {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push({
      severity: "error",
      path: "$.capabilities",
      message: "Capabilities must be an object keyed by capability name.",
    });
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const out: NonNullable<CapabilityOverrides> = {};
  const known = new Set(HOST_DASHBOARD_CAPABILITY_KEYS);
  for (const key of Object.keys(record)) {
    if (!known.has(key as HostDashboardCapabilityKey)) {
      issues.push({
        severity: "warning",
        path: `$.capabilities.${key}`,
        message: "Unknown capability key will be ignored by Atmosphere.",
      });
      continue;
    }
    const raw = record[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push({
        severity: "error",
        path: `$.capabilities.${key}`,
        message: "Capability value must be an object.",
      });
      continue;
    }
    const item = raw as Record<string, unknown>;
    const state = parseCapabilityState(item.state);
    if (item.state !== undefined && !state) {
      issues.push({
        severity: "error",
        path: `$.capabilities.${key}.state`,
        message:
          "Capability state must be supported, host_owned, planned, or unknown.",
      });
    }
    const href = validateOptionalUrl(
      item.href,
      `$.capabilities.${key}.href`,
      issues,
    );
    const description = typeof item.description === "string" &&
        item.description.trim()
      ? item.description.trim()
      : undefined;
    if (
      item.description !== undefined &&
      typeof item.description !== "string"
    ) {
      issues.push({
        severity: "error",
        path: `$.capabilities.${key}.description`,
        message: "Capability description must be a string.",
      });
    }
    out[key as HostDashboardCapabilityKey] = { state, href, description };
  }
  return out;
}

function validateOptionalUrl(
  value: unknown,
  path: string,
  issues: HostDashboardValidationIssue[],
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const url = safeUrlString(value);
  if (!url) {
    issues.push({
      severity: "error",
      path,
      message: "URL must be absolute HTTP(S), with no username or password.",
    });
  }
  return url;
}

function normalizeManifestHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.includes("/") || trimmed.includes(":")) return null;
  if (!trimmed.includes(".")) return null;
  return trimmed;
}

function hostFromManifestInput(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    return null;
  }
  return url.hostname.toLowerCase();
}
