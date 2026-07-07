/**
 * Account host lookup and directory helpers.
 *
 * Public UI should show a friendly host name ("Bluesky") before a raw
 * endpoint ("shimeji.us-east.host.bsky.network"). The DB stores durable
 * host records for the Hosts page; the seed list keeps known umbrella hosts
 * recognizable even before an observation row exists.
 */
import { type DbClient, withDb } from "./db.ts";

export type HostSignupStatus =
  | "open"
  | "invite_required"
  | "closed"
  | "unknown";
export type HostVerificationStatus = "verified" | "claimed" | "observed";
export type HostSource = "seeded" | "manual" | "observed";

export interface AccountHost {
  host: string;
  displayName: string;
  description: string;
  dataLocation: string | null;
  inferredLocation: string | null;
  inferredLocationSource: string | null;
  inferredLocationCheckedAt: number | null;
  inferredLocationEvidenceJson: string | null;
  homepageUrl: string | null;
  serviceEndpoint: string | null;
  accountManagementUrl: string | null;
  dashboardUrl: string | null;
  capabilityManifestUrl: string | null;
  capabilitiesJson: string | null;
  supportUrl: string | null;
  profileHandle: string | null;
  profileDid: string | null;
  bskyProfileVisible: boolean;
  avatarUrl: string | null;
  claimHandle: string | null;
  claimDid: string | null;
  signupStatus: HostSignupStatus;
  verificationStatus: HostVerificationStatus;
  source: HostSource;
  matchPatterns: string[];
  serviceRecordUri: string | null;
  serviceRecordCid: string | null;
  serviceObservedAt: number | null;
  profileCheckedAt: number | null;
  observedAccountCount: number;
  observedActiveAccountCount: number;
  lastIndexedAccountAt: number | null;
  lastCheckedAt: number | null;
  lastObservedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AccountHostLookup {
  host: string;
  displayName: string;
  endpoint: string;
  verificationStatus: HostVerificationStatus;
}

type DbValue = string | number | null;
const SEEDED_HOSTS_SYNC_TTL_MS = 5 * 60 * 1000;
const MAX_PUBLIC_HOSTS = 200;

let seededHostsSyncedAt = 0;
let seededHostsSyncPromise: Promise<void> | null = null;

interface SeedHost {
  host: string;
  displayName: string;
  description: string;
  dataLocation?: string;
  homepageUrl: string;
  serviceEndpoint?: string;
  accountManagementUrl?: string;
  dashboardUrl?: string;
  capabilityManifestUrl?: string;
  capabilitiesJson?: string;
  supportUrl?: string;
  profileHandle?: string;
  bskyProfileVisible?: boolean;
  claimHandle?: string;
  signupStatus: HostSignupStatus;
  verificationStatus: HostVerificationStatus;
  source: HostSource;
  matchPatterns: string[];
}

export interface AccountHostClaim {
  host: string;
  claimantDid: string;
  claimantHandle: string;
  method: "oauth_atproto_account";
  claimedAt: number;
  verifiedAt: number;
  updatedAt: number;
}

export interface AccountHostClaimAuthority {
  handle: string;
  did: string | null;
}

export interface AccountHostDashboardSettingsInput {
  serviceEndpoint?: string | null;
  accountManagementUrl?: string | null;
  dashboardUrl?: string | null;
  capabilityManifestUrl?: string | null;
  capabilitiesJson?: string | null;
  supportUrl?: string | null;
  serviceRecordUri?: string | null;
  serviceRecordCid?: string | null;
}

export interface AccountHostProfileSettingsInput {
  displayName: string;
  description?: string | null;
  dataLocation?: string | null;
  inferredLocation?: string | null;
  inferredLocationSource?: string | null;
  inferredLocationCheckedAt?: number | null;
  inferredLocationEvidenceJson?: string | null;
  homepageUrl?: string | null;
  signupStatus?: HostSignupStatus | null;
  profileHandle?: string | null;
  bskyProfileVisible?: boolean | null;
  avatarUrl?: string | null;
}

export interface AccountHostRegistrationInput {
  host: string;
  displayName: string;
  description?: string | null;
  dataLocation?: string | null;
  inferredLocation?: string | null;
  inferredLocationSource?: string | null;
  inferredLocationCheckedAt?: number | null;
  inferredLocationEvidenceJson?: string | null;
  homepageUrl?: string | null;
  serviceEndpoint?: string | null;
  accountManagementUrl?: string | null;
  supportUrl?: string | null;
  avatarUrl?: string | null;
  signupStatus?: HostSignupStatus | null;
  profileHandle?: string | null;
  bskyProfileVisible?: boolean | null;
  serviceRecordUri?: string | null;
  serviceRecordCid?: string | null;
}

export type AccountHostClaimResult =
  | { ok: true; host: AccountHost; claim: AccountHostClaim }
  | {
    ok: false;
    reason:
      | "host_not_found"
      | "not_claimable"
      | "not_authorized"
      | "already_claimed";
    host?: AccountHost;
    authority?: AccountHostClaimAuthority | null;
    claim?: AccountHostClaim | null;
  };

export type AccountHostRegistrationResult =
  | { ok: true; host: AccountHost; claim: AccountHostClaim }
  | {
    ok: false;
    reason:
      | "invalid_host"
      | "invalid_display_name"
      | "invalid_homepage_url"
      | "invalid_service_endpoint"
      | "invalid_account_management_url"
      | "invalid_support_url"
      | "invalid_profile_handle"
      | "already_claimed"
      | "not_authorized";
    message: string;
    host?: AccountHost | null;
    claim?: AccountHostClaim | null;
  };

export type AccountHostProfileSettingsResult =
  | { ok: true; host: AccountHost }
  | {
    ok: false;
    reason:
      | "invalid_display_name"
      | "invalid_homepage_url"
      | "invalid_profile_handle"
      | "invalid_avatar_url";
    message: string;
  };

const BSKY_PROFILE =
  "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile";
const HOST_PROFILE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const HOST_PROFILE_MISS_RETRY_MS = 6 * 60 * 60 * 1000;
const HOST_PROFILE_REFRESH_BATCH_SIZE = 8;

const SEEDED_HOSTS: SeedHost[] = [
  {
    host: "bsky.network",
    displayName: "Bluesky",
    description:
      "A large general-purpose account host for people using Bluesky and other Atmosphere apps.",
    homepageUrl: "https://bsky.app",
    serviceEndpoint: "https://bsky.social",
    accountManagementUrl: "https://bsky.app/settings",
    profileHandle: "bsky.app",
    claimHandle: "bsky.app",
    signupStatus: "open",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["bsky.network", "bsky.social", "*.bsky.network"],
  },
  {
    host: "selfhosted.social",
    displayName: "Self Hosted",
    description:
      "An independent account host for people who want a community-run home for their Atmosphere account.",
    homepageUrl: "https://selfhosted.social",
    profileHandle: "selfhosted.social",
    claimHandle: "selfhosted.social",
    signupStatus: "open",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["selfhosted.social", "*.selfhosted.social"],
  },
  {
    host: "eurosky.social",
    displayName: "Eurosky",
    description:
      "An independent account host for people who want another friendly home for their Atmosphere account.",
    dataLocation: "Europe",
    homepageUrl: "https://eurosky.social",
    profileHandle: "eurosky.social",
    claimHandle: "eurosky.social",
    signupStatus: "open",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["eurosky.social", "*.eurosky.social"],
  },
  {
    host: "blacksky.community",
    displayName: "Blacksky",
    description:
      "A community Atmosphere domain listed while account-host details are confirmed.",
    homepageUrl: "https://blacksky.community",
    profileHandle: "blackskyweb.xyz",
    claimHandle: "blackskyweb.xyz",
    signupStatus: "unknown",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["blacksky.community", "*.blacksky.community"],
  },
  {
    host: "sprk.so",
    displayName: "Spark",
    description:
      "A Spark Atmosphere domain listed while account-host details are confirmed.",
    homepageUrl: "https://sprk.so",
    profileHandle: "sprk.so",
    claimHandle: "sprk.so",
    signupStatus: "unknown",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["sprk.so", "*.sprk.so"],
  },
  {
    host: "tangled.org",
    displayName: "Tangled",
    description:
      "A Tangled Atmosphere domain with a public signup page for new accounts.",
    homepageUrl: "https://tangled.org/signup",
    profileHandle: "tangled.org",
    claimHandle: "tangled.org",
    signupStatus: "open",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["tangled.org", "*.tangled.org", "tangled.sh"],
  },
  {
    host: "pckt.cafe",
    displayName: "Pckt",
    description:
      "A Pckt Atmosphere domain listed while account-host details are confirmed.",
    homepageUrl: "https://pckt.cafe",
    profileHandle: "pckt.blog",
    claimHandle: "pckt.blog",
    signupStatus: "unknown",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["pckt.cafe", "*.pckt.cafe"],
  },
  {
    host: "margin.cafe",
    displayName: "Margin",
    description:
      "A Margin Atmosphere domain listed while account-host details are confirmed.",
    homepageUrl: "https://margin.at/login",
    profileHandle: "margin.at",
    claimHandle: "margin.at",
    signupStatus: "open",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["margin.cafe", "*.margin.cafe"],
  },
  {
    host: "npmx.social",
    displayName: "NPMX",
    description:
      "An NPMX Atmosphere domain listed while account-host details are confirmed.",
    homepageUrl: "https://npmx.dev/pds",
    profileHandle: "npmx.dev",
    claimHandle: "npmx.dev",
    signupStatus: "open",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["npmx.social", "*.npmx.social"],
  },
];

const LEGACY_SEEDED_HOSTS: Array<{ from: string; to: string }> = [
  { from: "tangled.sh", to: "tangled.org" },
];

function now(): number {
  return Date.now();
}

function normalizeEndpoint(pdsUrl: string | null | undefined): URL | null {
  if (!pdsUrl) return null;
  try {
    return new URL(pdsUrl);
  } catch {
    return null;
  }
}

function endpointHost(pdsUrl: string | null | undefined): string {
  const url = normalizeEndpoint(pdsUrl);
  return url?.host.toLowerCase() ?? (pdsUrl ?? "");
}

function endpointHostname(pdsUrl: string | null | undefined): string {
  const url = normalizeEndpoint(pdsUrl);
  return url?.hostname.toLowerCase() ?? (pdsUrl ?? "");
}

function patternMatches(pattern: string, hostname: string): boolean {
  const clean = pattern.toLowerCase();
  if (clean.startsWith("*.")) {
    const suffix = clean.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === clean;
}

function seedForEndpoint(pdsUrl: string | null | undefined): SeedHost | null {
  const hostname = endpointHostname(pdsUrl);
  if (!hostname) return null;
  return SEEDED_HOSTS.find((seed) =>
    seed.matchPatterns.some((pattern) => patternMatches(pattern, hostname))
  ) ?? null;
}

function verificationRank(status: HostVerificationStatus): number {
  switch (status) {
    case "verified":
      return 0;
    case "claimed":
      return 1;
    default:
      return 2;
  }
}

function signupRank(status: HostSignupStatus): number {
  switch (status) {
    case "open":
      return 0;
    case "invite_required":
      return 1;
    case "closed":
      return 2;
    default:
      return 3;
  }
}

function seedToAccountHost(seed: SeedHost, ts = now()): AccountHost {
  return {
    host: seed.host,
    displayName: seed.displayName,
    description: seed.description,
    dataLocation: seed.dataLocation ?? null,
    inferredLocation: null,
    inferredLocationSource: null,
    inferredLocationCheckedAt: null,
    inferredLocationEvidenceJson: null,
    homepageUrl: seed.homepageUrl ?? null,
    serviceEndpoint: seed.serviceEndpoint ?? null,
    accountManagementUrl: seed.accountManagementUrl ?? null,
    dashboardUrl: seed.dashboardUrl ?? null,
    capabilityManifestUrl: seed.capabilityManifestUrl ?? null,
    capabilitiesJson: seed.capabilitiesJson ?? null,
    supportUrl: seed.supportUrl ?? null,
    profileHandle: seed.profileHandle ?? null,
    profileDid: null,
    bskyProfileVisible: seed.bskyProfileVisible ?? true,
    avatarUrl: null,
    claimHandle: seed.claimHandle ?? seed.profileHandle ?? seed.host,
    claimDid: null,
    signupStatus: seed.signupStatus,
    verificationStatus: seed.verificationStatus,
    source: seed.source,
    matchPatterns: seed.matchPatterns,
    serviceRecordUri: null,
    serviceRecordCid: null,
    serviceObservedAt: null,
    profileCheckedAt: null,
    observedAccountCount: 0,
    observedActiveAccountCount: 0,
    lastIndexedAccountAt: null,
    lastCheckedAt: null,
    lastObservedAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

function hostMatchesPublicQuery(host: AccountHost, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    host.displayName,
    host.host,
    host.description,
    host.profileHandle,
    host.dataLocation,
  ].some((value) => value?.toLowerCase().includes(q));
}

export function listSeededAccountHostFallback(
  opts: { query?: string } = {},
): AccountHost[] {
  const ts = now();
  const query = opts.query?.trim() ?? "";
  return SEEDED_HOSTS
    .map((seed) => seedToAccountHost(seed, ts))
    .filter((host) => hostMatchesPublicQuery(host, query))
    .sort((a, b) =>
      verificationRank(a.verificationStatus) -
        verificationRank(b.verificationStatus) ||
      signupRank(a.signupStatus) - signupRank(b.signupStatus) ||
      a.displayName.localeCompare(b.displayName)
    )
    .slice(0, MAX_PUBLIC_HOSTS);
}

function parseHostRow(row: Record<string, unknown>): AccountHost {
  let matchPatterns: string[] = [];
  try {
    const parsed = JSON.parse(String(row.match_patterns ?? "[]"));
    matchPatterns = Array.isArray(parsed)
      ? parsed.filter((v) => typeof v === "string")
      : [];
  } catch {
    matchPatterns = [];
  }
  return {
    host: String(row.host),
    displayName: String(row.display_name),
    description: String(row.description ?? ""),
    dataLocation: row.data_location ? String(row.data_location) : null,
    inferredLocation: row.inferred_location
      ? String(row.inferred_location)
      : null,
    inferredLocationSource: row.inferred_location_source
      ? String(row.inferred_location_source)
      : null,
    inferredLocationCheckedAt: row.inferred_location_checked_at == null
      ? null
      : Number(row.inferred_location_checked_at),
    inferredLocationEvidenceJson: row.inferred_location_evidence_json
      ? String(row.inferred_location_evidence_json)
      : null,
    homepageUrl: row.homepage_url ? String(row.homepage_url) : null,
    serviceEndpoint: row.service_endpoint ? String(row.service_endpoint) : null,
    accountManagementUrl: row.account_management_url
      ? String(row.account_management_url)
      : null,
    dashboardUrl: row.dashboard_url ? String(row.dashboard_url) : null,
    capabilityManifestUrl: row.capability_manifest_url
      ? String(row.capability_manifest_url)
      : null,
    capabilitiesJson: row.capabilities_json
      ? String(row.capabilities_json)
      : null,
    supportUrl: row.support_url ? String(row.support_url) : null,
    profileHandle: row.profile_handle ? String(row.profile_handle) : null,
    profileDid: row.profile_did ? String(row.profile_did) : null,
    bskyProfileVisible: row.bsky_profile_visible == null
      ? true
      : Number(row.bsky_profile_visible) !== 0,
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    claimHandle: row.claim_handle ? String(row.claim_handle) : null,
    claimDid: row.claim_did ? String(row.claim_did) : null,
    signupStatus: normalizeSignupStatus(row.signup_status),
    verificationStatus: normalizeVerificationStatus(row.verification_status),
    source: normalizeSource(row.source),
    matchPatterns,
    serviceRecordUri: row.service_record_uri
      ? String(row.service_record_uri)
      : null,
    serviceRecordCid: row.service_record_cid
      ? String(row.service_record_cid)
      : null,
    serviceObservedAt: row.service_observed_at == null
      ? null
      : Number(row.service_observed_at),
    profileCheckedAt: row.profile_checked_at == null
      ? null
      : Number(row.profile_checked_at),
    observedAccountCount: row.observed_account_count == null
      ? 0
      : Number(row.observed_account_count),
    observedActiveAccountCount: row.observed_active_account_count == null
      ? 0
      : Number(row.observed_active_account_count),
    lastIndexedAccountAt: row.last_indexed_account_at == null
      ? null
      : Number(row.last_indexed_account_at),
    lastCheckedAt: row.last_checked_at == null
      ? null
      : Number(row.last_checked_at),
    lastObservedAt: row.last_observed_at == null
      ? null
      : Number(row.last_observed_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function normalizeSignupStatus(value: unknown): HostSignupStatus {
  return value === "open" || value === "invite_required" ||
      value === "closed" || value === "unknown"
    ? value
    : "unknown";
}

function normalizeVerificationStatus(value: unknown): HostVerificationStatus {
  return value === "verified" || value === "claimed" || value === "observed"
    ? value
    : "observed";
}

function normalizeSource(value: unknown): HostSource {
  return value === "seeded" || value === "manual" || value === "observed"
    ? value
    : "observed";
}

interface HostProfile {
  did: string;
  handle: string;
  avatarUrl: string | null;
}

type HostProfileResult =
  | { status: "found"; profile: HostProfile }
  | { status: "miss" }
  | { status: "error" };

async function fetchHostProfile(handle: string): Promise<HostProfile | null> {
  const url = new URL(BSKY_PROFILE);
  url.searchParams.set("actor", handle);
  const res = await fetch(url.toString(), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(3500),
  });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`host profile HTTP ${res.status}`);
  const json = await res.json() as Record<string, unknown>;
  const did = typeof json.did === "string" ? json.did : "";
  const resolvedHandle = typeof json.handle === "string" ? json.handle : "";
  const avatarUrl = typeof json.avatar === "string" ? json.avatar : null;
  if (!did || !resolvedHandle) return null;
  return { did, handle: resolvedHandle, avatarUrl };
}

function hostNeedsProfileRefresh(host: AccountHost, ts: number): boolean {
  if (!profileHandleForHost(host)) return false;
  const checkedAt = host.profileCheckedAt ?? 0;
  const ttl = host.avatarUrl
    ? HOST_PROFILE_REFRESH_MS
    : HOST_PROFILE_MISS_RETRY_MS;
  return checkedAt <= 0 || ts - checkedAt > ttl;
}

function profileHandleForHost(host: AccountHost): string | null {
  const handle = (host.profileHandle ?? host.host).trim().toLowerCase();
  if (!handle || handle.includes(":") || !handle.includes(".")) return null;
  return handle;
}

function normalizeHandle(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^@/, "").toLowerCase();
}

function normalizeHostInput(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  if (/^https?:\/\//.test(raw)) {
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  host = host.replace(/\.$/, "");
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(host)
  ) {
    return null;
  }
  if (
    host === "localhost" || host.endsWith(".localhost") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
  ) {
    return null;
  }
  return host;
}

function normalizePublicHttpsUrl(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizePublicServiceEndpoint(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeClaimProfileHandle(
  value: string | null | undefined,
): string | null {
  const handle = normalizeHandle(value);
  if (
    !handle ||
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(handle)
  ) {
    return null;
  }
  return handle;
}

function normalizeDataLocation(
  value: string | null | undefined,
): string | null {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 120) : null;
}

function textOrNull(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function claimHandleForHost(host: AccountHost): string | null {
  const handle = normalizeHandle(host.claimHandle ?? host.profileHandle);
  if (!handle || handle.includes(":") || !handle.includes(".")) return null;
  return handle;
}

function parseHostClaimRow(row: Record<string, unknown>): AccountHostClaim {
  return {
    host: String(row.host),
    claimantDid: String(row.claimant_did),
    claimantHandle: String(row.claimant_handle),
    method: "oauth_atproto_account",
    claimedAt: Number(row.claimed_at),
    verifiedAt: Number(row.verified_at),
    updatedAt: Number(row.updated_at),
  };
}

async function fetchHostProfileRefreshes(
  hosts: AccountHost[],
): Promise<{
  ts: number;
  results: Array<{ host: AccountHost; result: HostProfileResult }>;
}> {
  const ts = now();
  const candidates = hosts
    .filter((host) => hostNeedsProfileRefresh(host, ts))
    .slice(0, HOST_PROFILE_REFRESH_BATCH_SIZE);
  if (candidates.length === 0) return { ts, results: [] };

  const results: Array<{ host: AccountHost; result: HostProfileResult }> =
    await Promise.all(candidates.map(async (host) => {
      try {
        const handle = profileHandleForHost(host);
        const profile = handle ? await fetchHostProfile(handle) : null;
        return {
          host,
          result: profile
            ? ({ status: "found", profile } as const)
            : ({ status: "miss" } as const),
        };
      } catch {
        return { host, result: { status: "error" } as const };
      }
    }));

  return { ts, results };
}

async function persistHostProfileRefreshes(
  c: DbClient,
  ts: number,
  results: Array<{ host: AccountHost; result: HostProfileResult }>,
): Promise<Map<string, Partial<AccountHost>>> {
  const refreshed = new Map<string, Partial<AccountHost>>();
  for (const { host, result } of results) {
    if (result.status === "found") {
      const { profile } = result;
      await c.execute({
        sql: `UPDATE account_host
          SET profile_handle = ?, profile_did = ?, avatar_url = ?,
              profile_checked_at = ?, updated_at = ?
          WHERE host = ?`,
        args: [
          profile.handle,
          profile.did,
          profile.avatarUrl,
          ts,
          ts,
          host.host,
        ],
      });
      refreshed.set(host.host, {
        profileHandle: profile.handle,
        profileDid: profile.did,
        avatarUrl: profile.avatarUrl,
        profileCheckedAt: ts,
        updatedAt: ts,
      });
    } else {
      // Treat transient lookup errors like misses for refresh/backoff
      // purposes. Otherwise one bad host handle can trigger external
      // profile fetches on every /hosts request.
      await c.execute({
        sql: `UPDATE account_host
          SET profile_checked_at = ?, updated_at = ?
          WHERE host = ?`,
        args: [ts, ts, host.host],
      });
      refreshed.set(host.host, {
        profileCheckedAt: ts,
        updatedAt: ts,
      });
    }
  }
  return refreshed;
}

async function ensureSeededHosts(c: DbClient): Promise<void> {
  const ts = now();
  if (ts - seededHostsSyncedAt < SEEDED_HOSTS_SYNC_TTL_MS) return;
  if (seededHostsSyncPromise) {
    await seededHostsSyncPromise;
    return;
  }
  seededHostsSyncPromise = syncSeededHosts(c, ts)
    .then(() => {
      seededHostsSyncedAt = now();
    })
    .finally(() => {
      seededHostsSyncPromise = null;
    });
  await seededHostsSyncPromise;
}

async function syncSeededHosts(c: DbClient, ts: number): Promise<void> {
  for (const legacy of LEGACY_SEEDED_HOSTS) {
    await c.execute({
      sql: `UPDATE account_host
        SET host = ?, updated_at = ?
        WHERE host = ?
          AND source = 'seeded'
          AND NOT EXISTS (
            SELECT 1 FROM account_host WHERE host = ?
          )`,
      args: [legacy.to, ts, legacy.from, legacy.to],
    });
    await c.execute({
      sql: `DELETE FROM account_host
        WHERE host = ?
          AND source = 'seeded'
          AND EXISTS (
            SELECT 1 FROM account_host WHERE host = ?
          )`,
      args: [legacy.from, legacy.to],
    });
  }
  for (const seed of SEEDED_HOSTS) {
    const claimHandle = seed.claimHandle ?? seed.profileHandle ?? seed.host;
    await c.execute({
      sql: `INSERT INTO account_host (
          host, display_name, description, data_location, homepage_url,
          service_endpoint, account_management_url, dashboard_url,
          capability_manifest_url, capabilities_json, support_url,
          profile_handle, bsky_profile_visible, claim_handle, signup_status, verification_status,
          source, match_patterns,
          last_checked_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET
          display_name = excluded.display_name,
          description = excluded.description,
          data_location = COALESCE(excluded.data_location, account_host.data_location),
          homepage_url = excluded.homepage_url,
          service_endpoint = COALESCE(account_host.service_endpoint, excluded.service_endpoint),
          account_management_url = CASE
            WHEN excluded.account_management_url IS NOT NULL
            THEN excluded.account_management_url
            ELSE account_host.account_management_url
          END,
          dashboard_url = COALESCE(account_host.dashboard_url, excluded.dashboard_url),
          capability_manifest_url = COALESCE(account_host.capability_manifest_url, excluded.capability_manifest_url),
          capabilities_json = COALESCE(account_host.capabilities_json, excluded.capabilities_json),
          support_url = COALESCE(account_host.support_url, excluded.support_url),
          profile_did = CASE
            WHEN COALESCE(account_host.profile_handle, '') <> excluded.profile_handle
            THEN NULL
            ELSE account_host.profile_did
          END,
          avatar_url = CASE
            WHEN COALESCE(account_host.profile_handle, '') <> excluded.profile_handle
            THEN NULL
            ELSE account_host.avatar_url
          END,
          profile_checked_at = CASE
            WHEN COALESCE(account_host.profile_handle, '') <> excluded.profile_handle
            THEN NULL
            WHEN account_host.avatar_url IS NULL
              AND account_host.profile_handle = excluded.profile_handle
            THEN NULL
            ELSE account_host.profile_checked_at
          END,
          profile_handle = excluded.profile_handle,
          bsky_profile_visible = excluded.bsky_profile_visible,
          claim_did = CASE
            WHEN COALESCE(account_host.claim_handle, '') <> excluded.claim_handle
            THEN NULL
            ELSE account_host.claim_did
          END,
          claim_handle = excluded.claim_handle,
          signup_status = excluded.signup_status,
          verification_status = CASE
            WHEN account_host.verification_status = 'claimed'
            THEN 'claimed'
            ELSE excluded.verification_status
          END,
          source = excluded.source,
          match_patterns = excluded.match_patterns,
          updated_at = excluded.updated_at`,
      args: [
        seed.host,
        seed.displayName,
        seed.description,
        normalizeDataLocation(seed.dataLocation),
        seed.homepageUrl,
        seed.serviceEndpoint ?? null,
        seed.accountManagementUrl ?? null,
        seed.dashboardUrl ?? null,
        seed.capabilityManifestUrl ?? null,
        seed.capabilitiesJson ?? null,
        seed.supportUrl ?? null,
        seed.profileHandle ?? seed.host,
        seed.bskyProfileVisible === false ? 0 : 1,
        claimHandle,
        seed.signupStatus,
        seed.verificationStatus,
        seed.source,
        JSON.stringify(seed.matchPatterns),
        ts,
        ts,
        ts,
      ],
    });
  }
}

export async function getAccountHostClaim(
  host: string,
): Promise<AccountHostClaim | null> {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return null;
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `SELECT * FROM account_host_claim WHERE host = ? LIMIT 1`,
      args: [normalized],
    });
    if (r.rows.length === 0) return null;
    return parseHostClaimRow(r.rows[0] as Record<string, unknown>);
  });
}

export async function hasManagedAccountHost(did: string): Promise<boolean> {
  const normalized = did.trim();
  if (!normalized) return false;
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        SELECT 1
        FROM account_host
        WHERE profile_did = ? OR claim_did = ?
        UNION
        SELECT 1
        FROM account_host_claim
        WHERE claimant_did = ?
        LIMIT 1
      `,
      args: [normalized, normalized, normalized],
    });
    return r.rows.length > 0;
  });
}

export async function listManagedAccountHosts(
  did: string,
): Promise<AccountHost[]> {
  const normalized = did.trim();
  if (!normalized) return [];
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        SELECT h.*
        FROM account_host h
        WHERE h.profile_did = ?
           OR h.claim_did = ?
           OR EXISTS (
             SELECT 1
             FROM account_host_claim c
             WHERE c.host = h.host AND c.claimant_did = ?
           )
        ORDER BY lower(h.display_name), h.host
        LIMIT 20
      `,
      args: [normalized, normalized, normalized],
    });
    return r.rows.map((row) => parseHostRow(row as Record<string, unknown>));
  });
}

export async function resolveAccountHostClaimAuthority(
  host: AccountHost,
): Promise<AccountHostClaimAuthority | null> {
  const handle = claimHandleForHost(host);
  if (!handle) return null;
  const profileHandle = normalizeHandle(host.profileHandle);
  const cachedDid = host.claimDid ??
    (profileHandle === handle ? host.profileDid : null);
  if (cachedDid) {
    return {
      handle: host.claimHandle ?? host.profileHandle ?? handle,
      did: cachedDid,
    };
  }
  const profile = await fetchHostProfile(handle).catch(() => null);
  if (!profile) return { handle, did: null };
  await withDb(async (c) => {
    await c.execute({
      sql: `UPDATE account_host
        SET claim_handle = ?, claim_did = ?, updated_at = ?
        WHERE host = ?`,
      args: [profile.handle, profile.did, now(), host.host],
    });
  });
  return { handle: profile.handle, did: profile.did };
}

export function accountHostClaimAuthorityMatchesUser(
  authority: AccountHostClaimAuthority,
  user: { did: string; handle: string },
): boolean {
  if (authority.did) return authority.did === user.did;
  return normalizeHandle(authority.handle) === normalizeHandle(user.handle);
}

export async function claimAccountHost(
  host: string,
  user: { did: string; handle: string },
): Promise<AccountHostClaimResult> {
  const row = await getAccountHost(host);
  if (!row) return { ok: false, reason: "host_not_found" };
  const authority = await resolveAccountHostClaimAuthority(row);
  if (!authority) {
    return { ok: false, reason: "not_claimable", host: row, authority };
  }
  const existingClaim = await getAccountHostClaim(row.host);
  if (existingClaim && existingClaim.claimantDid !== user.did) {
    return {
      ok: false,
      reason: "already_claimed",
      host: row,
      authority,
      claim: existingClaim,
    };
  }
  if (!accountHostClaimAuthorityMatchesUser(authority, user)) {
    return {
      ok: false,
      reason: "not_authorized",
      host: row,
      authority,
      claim: existingClaim,
    };
  }
  const ts = now();
  const claim: AccountHostClaim = {
    host: row.host,
    claimantDid: user.did,
    claimantHandle: user.handle,
    method: "oauth_atproto_account",
    claimedAt: existingClaim?.claimedAt ?? ts,
    verifiedAt: ts,
    updatedAt: ts,
  };
  await withDb(async (c) => {
    await c.execute({
      sql: `INSERT INTO account_host_claim (
          host, claimant_did, claimant_handle, method,
          claimed_at, verified_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET
          claimant_did = excluded.claimant_did,
          claimant_handle = excluded.claimant_handle,
          method = excluded.method,
          verified_at = excluded.verified_at,
          updated_at = excluded.updated_at`,
      args: [
        claim.host,
        claim.claimantDid,
        claim.claimantHandle,
        claim.method,
        claim.claimedAt,
        claim.verifiedAt,
        claim.updatedAt,
      ],
    });
    await c.execute({
      sql: `UPDATE account_host
        SET claim_handle = ?,
            claim_did = ?,
            verification_status = CASE
              WHEN verification_status = 'verified' THEN 'verified'
              ELSE 'claimed'
            END,
            updated_at = ?
        WHERE host = ?`,
      args: [authority.handle, authority.did ?? user.did, ts, row.host],
    });
  });
  const updatedHost = await getAccountHost(row.host) ?? row;
  return { ok: true, host: updatedHost, claim };
}

export async function registerAccountHost(
  input: AccountHostRegistrationInput,
  user: { did: string; handle: string },
): Promise<AccountHostRegistrationResult> {
  const host = normalizeHostInput(input.host);
  if (!host) {
    return {
      ok: false,
      reason: "invalid_host",
      message: "Enter a public host address like pckt.cafe.",
    };
  }

  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80) {
    return {
      ok: false,
      reason: "invalid_display_name",
      message: "Enter a host name under 80 characters.",
    };
  }

  const homepageUrl = input.homepageUrl?.trim()
    ? normalizePublicHttpsUrl(input.homepageUrl)
    : null;
  if (input.homepageUrl?.trim() && !homepageUrl) {
    return {
      ok: false,
      reason: "invalid_homepage_url",
      message: "Use an HTTPS URL for the host website or signup page.",
    };
  }
  const serviceEndpoint = input.serviceEndpoint?.trim()
    ? normalizePublicServiceEndpoint(input.serviceEndpoint)
    : null;
  if (input.serviceEndpoint?.trim() && !serviceEndpoint) {
    return {
      ok: false,
      reason: "invalid_service_endpoint",
      message: "Use an HTTPS origin for the host PDS service endpoint.",
    };
  }
  const accountManagementUrl = input.accountManagementUrl?.trim()
    ? normalizePublicHttpsUrl(input.accountManagementUrl)
    : null;
  if (input.accountManagementUrl?.trim() && !accountManagementUrl) {
    return {
      ok: false,
      reason: "invalid_account_management_url",
      message: "Use an HTTPS URL for the host account management page.",
    };
  }
  const supportUrl = input.supportUrl?.trim()
    ? normalizePublicHttpsUrl(input.supportUrl)
    : null;
  if (input.supportUrl?.trim() && !supportUrl) {
    return {
      ok: false,
      reason: "invalid_support_url",
      message: "Use an HTTPS URL for the host support page.",
    };
  }

  const profileHandle = input.profileHandle?.trim()
    ? normalizeClaimProfileHandle(input.profileHandle)
    : normalizeClaimProfileHandle(user.handle);
  if (!profileHandle) {
    return {
      ok: false,
      reason: "invalid_profile_handle",
      message: "Use a valid AT Protocol handle for the host account.",
    };
  }

  if (normalizeHandle(profileHandle) !== normalizeHandle(user.handle)) {
    return {
      ok: false,
      reason: "not_authorized",
      message: "Sign in as the host account you want attached to this listing.",
    };
  }

  const signupStatus = normalizeSignupStatus(input.signupStatus);
  const description = (input.description ?? "").trim().slice(0, 600);
  const dataLocation = normalizeDataLocation(input.dataLocation);
  const inferredLocation = normalizeDataLocation(input.inferredLocation);
  const inferredLocationSource = textOrNull(input.inferredLocationSource)
    ?.slice(0, 120) ?? null;
  const inferredLocationCheckedAt = input.inferredLocationCheckedAt &&
      Number.isFinite(input.inferredLocationCheckedAt)
    ? Math.max(0, Math.floor(input.inferredLocationCheckedAt))
    : null;
  const inferredLocationEvidenceJson =
    textOrNull(input.inferredLocationEvidenceJson)?.slice(0, 4000) ?? null;
  const avatarUrl = normalizePublicImageUrl(input.avatarUrl);
  const bskyProfileVisible = input.bskyProfileVisible !== false;
  const existing = await getAccountHost(host);
  const existingClaim = existing
    ? await getAccountHostClaim(existing.host).catch(() => null)
    : null;
  if (existingClaim && existingClaim.claimantDid !== user.did) {
    return {
      ok: false,
      reason: "already_claimed",
      message:
        `This host is already managed by @${existingClaim.claimantHandle}.`,
      host: existing,
      claim: existingClaim,
    };
  }
  if (existing) {
    const authority = await resolveAccountHostClaimAuthority(existing).catch(
      () => null,
    );
    if (
      authority &&
      !accountHostClaimAuthorityMatchesUser(authority, user) &&
      !existingClaim
    ) {
      return {
        ok: false,
        reason: "not_authorized",
        message:
          `This host is tied to @${authority.handle}. Sign in as that account to claim it.`,
        host: existing,
      };
    }
  }

  const ts = now();
  await withDb(async (c) => {
    await ensureSeededHosts(c);
    await c.execute({
      sql: `INSERT INTO account_host (
          host, display_name, description, data_location,
          inferred_location, inferred_location_source,
          inferred_location_checked_at, inferred_location_evidence_json,
          homepage_url,
          service_endpoint, account_management_url,
          profile_handle, profile_did, bsky_profile_visible, avatar_url, claim_handle, claim_did,
          support_url, service_record_uri, service_record_cid, service_observed_at,
          signup_status, verification_status, source, match_patterns,
          last_checked_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'observed', 'manual', ?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET
          display_name = excluded.display_name,
          description = excluded.description,
          data_location = COALESCE(excluded.data_location, account_host.data_location),
          inferred_location = COALESCE(excluded.inferred_location, account_host.inferred_location),
          inferred_location_source = COALESCE(excluded.inferred_location_source, account_host.inferred_location_source),
          inferred_location_checked_at = COALESCE(excluded.inferred_location_checked_at, account_host.inferred_location_checked_at),
          inferred_location_evidence_json = COALESCE(excluded.inferred_location_evidence_json, account_host.inferred_location_evidence_json),
          homepage_url = COALESCE(excluded.homepage_url, account_host.homepage_url),
          service_endpoint = COALESCE(excluded.service_endpoint, account_host.service_endpoint),
          account_management_url = CASE
            WHEN excluded.account_management_url IS NOT NULL
            THEN excluded.account_management_url
            ELSE account_host.account_management_url
          END,
          profile_handle = excluded.profile_handle,
          profile_did = COALESCE(excluded.profile_did, account_host.profile_did),
          bsky_profile_visible = excluded.bsky_profile_visible,
          avatar_url = COALESCE(excluded.avatar_url, account_host.avatar_url),
          claim_handle = excluded.claim_handle,
          claim_did = excluded.claim_did,
          support_url = COALESCE(excluded.support_url, account_host.support_url),
          service_record_uri = COALESCE(excluded.service_record_uri, account_host.service_record_uri),
          service_record_cid = COALESCE(excluded.service_record_cid, account_host.service_record_cid),
          service_observed_at = COALESCE(excluded.service_observed_at, account_host.service_observed_at),
          signup_status = excluded.signup_status,
          source = CASE
            WHEN account_host.source = 'seeded' THEN 'seeded'
            ELSE 'manual'
          END,
          match_patterns = CASE
            WHEN account_host.match_patterns = '[]' THEN excluded.match_patterns
            ELSE account_host.match_patterns
          END,
          updated_at = excluded.updated_at`,
      args: [
        host,
        displayName,
        description || `${displayName} account host.`,
        dataLocation,
        inferredLocation,
        inferredLocationSource,
        inferredLocationCheckedAt,
        inferredLocationEvidenceJson,
        homepageUrl,
        serviceEndpoint,
        accountManagementUrl,
        profileHandle,
        user.did,
        bskyProfileVisible ? 1 : 0,
        avatarUrl,
        profileHandle,
        user.did,
        supportUrl,
        input.serviceRecordUri ?? null,
        input.serviceRecordCid ?? null,
        input.serviceRecordUri ? ts : null,
        signupStatus,
        JSON.stringify([host]),
        ts,
        ts,
        ts,
      ],
    });
  });

  const claimResult = await claimAccountHost(host, user);
  if (!claimResult.ok) {
    return {
      ok: false,
      reason: claimResult.reason === "already_claimed"
        ? "already_claimed"
        : "not_authorized",
      message: claimResult.reason === "already_claimed"
        ? "This host was registered, but it is already claimed by another account."
        : "This host was registered, but the signed-in account could not claim it.",
      host: claimResult.host,
      claim: claimResult.claim,
    };
  }
  return claimResult;
}

export async function updateAccountHostProfileSettings(
  host: string,
  input: AccountHostProfileSettingsInput,
): Promise<AccountHostProfileSettingsResult> {
  const normalized = host.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80) {
    return {
      ok: false,
      reason: "invalid_display_name",
      message: "Enter a host name under 80 characters.",
    };
  }

  const homepageUrl = input.homepageUrl?.trim()
    ? normalizePublicHttpsUrl(input.homepageUrl)
    : null;
  if (input.homepageUrl?.trim() && !homepageUrl) {
    return {
      ok: false,
      reason: "invalid_homepage_url",
      message: "Use an HTTPS URL for the host website or signup page.",
    };
  }

  const profileHandle = input.profileHandle?.trim()
    ? normalizeClaimProfileHandle(input.profileHandle)
    : null;
  if (input.profileHandle?.trim() && !profileHandle) {
    return {
      ok: false,
      reason: "invalid_profile_handle",
      message: "Use a valid AT Protocol handle for the host profile.",
    };
  }

  const avatarUrl = input.avatarUrl === undefined
    ? undefined
    : normalizePublicImageUrl(input.avatarUrl);
  if (input.avatarUrl && !avatarUrl) {
    return {
      ok: false,
      reason: "invalid_avatar_url",
      message:
        "Use a public HTTP(S) or Atmosphere blob URL for the host avatar.",
    };
  }

  const existing = await getAccountHost(normalized);
  const existingProfileHandle = normalizeHandle(existing?.profileHandle);
  const nextProfileHandle = normalizeHandle(profileHandle);
  const profileChanged = existingProfileHandle !== nextProfileHandle;
  const ts = now();
  await withDb(async (c) => {
    await ensureSeededHosts(c);
    await c.execute({
      sql: `UPDATE account_host
        SET display_name = ?,
            description = ?,
            data_location = ?,
            homepage_url = ?,
            signup_status = ?,
            profile_handle = ?,
            bsky_profile_visible = ?,
            profile_did = CASE WHEN ? THEN NULL ELSE profile_did END,
            avatar_url = CASE
              WHEN ? THEN ?
              WHEN ? THEN NULL
              ELSE avatar_url
            END,
            profile_checked_at = CASE WHEN ? THEN NULL ELSE profile_checked_at END,
            updated_at = ?
        WHERE host = ?`,
      args: [
        displayName,
        (input.description ?? "").trim().slice(0, 600),
        normalizeDataLocation(input.dataLocation),
        homepageUrl,
        normalizeSignupStatus(input.signupStatus),
        profileHandle,
        input.bskyProfileVisible === false ? 0 : 1,
        profileChanged ? 1 : 0,
        avatarUrl !== undefined ? 1 : 0,
        avatarUrl ?? null,
        profileChanged ? 1 : 0,
        profileChanged ? 1 : 0,
        ts,
        normalized,
      ],
    });
  });

  const updated = await getAccountHost(normalized);
  return updated ? { ok: true, host: updated } : {
    ok: false,
    reason: "invalid_display_name",
    message: "Host not found.",
  };
}

function normalizePublicImageUrl(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith("/api/atproto/blob?")) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

export async function updateAccountHostDashboardSettings(
  host: string,
  input: AccountHostDashboardSettingsInput,
): Promise<AccountHost | null> {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return null;
  await withDb(async (c) => {
    await ensureSeededHosts(c);
    await c.execute({
      sql: `UPDATE account_host
        SET service_endpoint = ?,
            account_management_url = ?,
            dashboard_url = ?,
            capability_manifest_url = ?,
            capabilities_json = ?,
            support_url = ?,
            service_record_uri = COALESCE(?, service_record_uri),
            service_record_cid = COALESCE(?, service_record_cid),
            service_observed_at = CASE WHEN ? IS NOT NULL THEN ? ELSE service_observed_at END,
            updated_at = ?
        WHERE host = ?`,
      args: [
        input.serviceEndpoint ?? null,
        input.accountManagementUrl ?? null,
        input.dashboardUrl ?? null,
        input.capabilityManifestUrl ?? null,
        input.capabilitiesJson ?? null,
        input.supportUrl ?? null,
        input.serviceRecordUri ?? null,
        input.serviceRecordCid ?? null,
        input.serviceRecordUri ?? null,
        now(),
        now(),
        normalized,
      ],
    });
  });
  return await getAccountHost(normalized);
}

export function accountHostName(pdsUrl: string | null | undefined): string {
  const seed = seedForEndpoint(pdsUrl);
  if (seed) return seed.displayName;
  return endpointHost(pdsUrl);
}

export function accountHostKeyForEndpoint(
  pdsUrl: string | null | undefined,
): string {
  const seed = seedForEndpoint(pdsUrl);
  return seed?.host ?? endpointHost(pdsUrl);
}

export async function lookupAccountHost(
  pdsUrl: string | null | undefined,
): Promise<AccountHostLookup | null> {
  const host = endpointHost(pdsUrl);
  if (!host) return null;
  const seed = seedForEndpoint(pdsUrl);
  if (seed) {
    await withDb(async (c) => {
      await ensureSeededHosts(c);
    });
    return {
      host: seed.host,
      displayName: seed.displayName,
      endpoint: pdsUrl ?? host,
      verificationStatus: seed.verificationStatus,
    };
  }
  return await withDb(async (c) => {
    await ensureSeededHosts(c);
    const r = await c.execute({
      sql: `SELECT * FROM account_host WHERE host = ? LIMIT 1`,
      args: [host],
    });
    if (r.rows.length === 0) {
      return {
        host,
        displayName: host,
        endpoint: pdsUrl ?? host,
        verificationStatus: "observed" as const,
      };
    }
    const row = parseHostRow(r.rows[0] as Record<string, unknown>);
    return {
      host: row.host,
      displayName: row.displayName,
      endpoint: pdsUrl ?? host,
      verificationStatus: row.verificationStatus,
    };
  });
}

export async function observeAccountHost(
  pdsUrl: string | null | undefined,
): Promise<void> {
  const host = endpointHost(pdsUrl);
  if (!host) return;
  const seed = seedForEndpoint(pdsUrl);
  await withDb(async (c) => {
    await ensureSeededHosts(c);
    const ts = now();
    if (seed) {
      const serviceEndpoint = normalizePublicServiceEndpoint(pdsUrl) ??
        seed.serviceEndpoint ?? null;
      const accountManagementUrl = seed.accountManagementUrl ?? null;
      await c.execute({
        sql: `UPDATE account_host
            SET service_endpoint = COALESCE(service_endpoint, ?),
                account_management_url = CASE
                  WHEN ? IS NOT NULL THEN ?
                  ELSE account_management_url
                END,
                service_observed_at = COALESCE(service_observed_at, ?),
                last_observed_at = ?,
                updated_at = ?
            WHERE host = ?`,
        args: [
          serviceEndpoint,
          accountManagementUrl,
          accountManagementUrl,
          serviceEndpoint ? ts : null,
          ts,
          ts,
          seed.host,
        ],
      });
      return;
    }
    const origin = normalizeEndpoint(pdsUrl)?.origin ?? `https://${host}`;
    const serviceEndpoint = normalizePublicServiceEndpoint(origin);
    await c.execute({
      sql: `INSERT INTO account_host (
          host, display_name, description, homepage_url,
          service_endpoint, account_management_url, profile_handle,
          signup_status, verification_status, source, match_patterns,
          service_observed_at, last_observed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', 'observed', 'observed', ?, ?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET
          service_endpoint = COALESCE(account_host.service_endpoint, excluded.service_endpoint),
          account_management_url = COALESCE(account_host.account_management_url, excluded.account_management_url),
          service_observed_at = COALESCE(account_host.service_observed_at, excluded.service_observed_at),
          last_observed_at = excluded.last_observed_at,
          updated_at = excluded.updated_at`,
      args: [
        host,
        host,
        "An account host observed from public account activity.",
        origin,
        serviceEndpoint,
        null,
        host,
        JSON.stringify([host]),
        serviceEndpoint ? ts : null,
        ts,
        ts,
        ts,
      ],
    });
  });
}

export async function listAccountHosts(
  opts: {
    query?: string;
    verificationStatus?: HostVerificationStatus | "all";
    signupStatus?: HostSignupStatus | "all";
  } = {},
): Promise<AccountHost[]> {
  return await withDb(async (c) => {
    await ensureSeededHosts(c);
    const filters: string[] = [];
    const args: DbValue[] = [];
    const query = opts.query?.trim();
    if (query) {
      filters.push(
        `(display_name LIKE ? OR host LIKE ? OR description LIKE ?)`,
      );
      const like = `%${query}%`;
      args.push(like, like, like);
    }
    if (opts.verificationStatus && opts.verificationStatus !== "all") {
      filters.push(`verification_status = ?`);
      args.push(opts.verificationStatus);
    }
    if (opts.signupStatus && opts.signupStatus !== "all") {
      filters.push(`signup_status = ?`);
      args.push(opts.signupStatus);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const r = await c.execute({
      sql: `SELECT * FROM account_host ${where}
        ORDER BY
          CASE verification_status
            WHEN 'verified' THEN 0
            WHEN 'claimed' THEN 1
            ELSE 2
          END,
          CASE signup_status
            WHEN 'open' THEN 0
            WHEN 'invite_required' THEN 1
            WHEN 'closed' THEN 2
            ELSE 3
          END,
          lower(display_name) ASC
        LIMIT ?`,
      args: [...args, MAX_PUBLIC_HOSTS],
    });
    return r.rows.map((row) => parseHostRow(row as Record<string, unknown>));
  });
}

export async function getAccountHost(
  host: string,
): Promise<AccountHost | null> {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return null;
  return await withDb(async (c) => {
    await ensureSeededHosts(c);
    const r = await c.execute({
      sql: `SELECT * FROM account_host WHERE host = ? LIMIT 1`,
      args: [normalized],
    });
    if (r.rows.length === 0) return null;
    return parseHostRow(r.rows[0] as Record<string, unknown>);
  });
}

export async function hydrateAccountHostProfiles(
  hosts: AccountHost[],
): Promise<AccountHost[]> {
  const { ts, results } = await fetchHostProfileRefreshes(hosts);
  if (results.length === 0) return hosts;
  const refreshed = await withDb(async (c) => {
    return await persistHostProfileRefreshes(c, ts, results);
  });
  return hosts.map((host) => ({
    ...host,
    ...(refreshed.get(host.host) ?? {}),
  }));
}

export async function warmAccountHostProfiles(
  hosts: AccountHost[],
): Promise<void> {
  await hydrateAccountHostProfiles(hosts);
}
