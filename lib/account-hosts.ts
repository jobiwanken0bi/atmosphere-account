/**
 * Account host lookup and directory helpers.
 *
 * Public UI should show a friendly host name ("Bluesky") before a raw
 * endpoint ("shimeji.us-east.host.bsky.network"). The DB stores durable
 * host records for the Hosts page; the seed list keeps known umbrella hosts
 * recognizable even before an observation row exists.
 */
import { type DbClient, withDb, withDbTransaction } from "./db.ts";
import { compiledAccountHostServiceEndpoint } from "./account-host-endpoints.ts";
import {
  hostClaimProofMessage,
  hostSelfServiceClaimPolicy,
  verifyAtprotoHostClaimDomainProof,
  verifyHostClaimDomainProof,
} from "./host-claim-proof.ts";
import {
  consumeHostDnsChallenge,
  hashHostDnsChallengeToken,
  type HostDnsChallengeVerificationFailureReason,
  inspectHostDnsChallenge,
  type PreparedHostDnsChallengeResult,
  prepareHostDnsChallenge,
} from "./host-claim-dns.ts";
import {
  consumeHostContactEmailChallenge,
  hashHostContactEmailToken,
  type HostContactEmailVerificationFailureReason,
  type PreparedHostContactEmailVerificationResult,
  prepareHostContactEmailChallenge,
} from "./host-claim-email.ts";
import type { ResolvedHostOwnerTransferContext } from "./host-owner-transfer-intent.ts";
import {
  isDid,
  isHandle,
  resolveIdentity as resolveAtprotoIdentity,
} from "./identity.ts";
import {
  isJsonMediaType,
  isPrivateNetworkUrl,
  readResponseTextWithLimit,
} from "./security.ts";
import { sha256B64u } from "./jose.ts";

export type HostSignupStatus =
  | "open"
  | "invite_required"
  | "closed"
  | "unknown";
export type HostVerificationStatus = "verified" | "claimed" | "observed";
export type HostSource = "seeded" | "manual" | "observed";
export type HostPublicIntentStatus = "unknown" | "detected" | "not_detected";
export type HostPublicIntentSource =
  | "pds_open_signup"
  | "pds_managed_invites";
export type AccountHostAvailability =
  | "relay_active"
  | "reachable"
  | "grace"
  | "unavailable";

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
  signupUrl: string | null;
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
  publicIntentStatus: HostPublicIntentStatus;
  publicIntentSource: HostPublicIntentSource | null;
  publicIntentCheckedAt: number | null;
  publicIntentAttemptedAt: number | null;
  publicIntentEvidenceJson: string | null;
  /**
   * Explicit operator choice for the public directory. `null` preserves the
   * legacy behaviour for claims created before this setting existed.
   */
  operatorListingOptIn?: boolean | null;
  operatorListingOptedAt?: number | null;
  profileCheckedAt: number | null;
  observedAccountCount: number;
  observedActiveAccountCount: number;
  lastActiveAt: number | null;
  lastIndexedAccountAt: number | null;
  lastCheckedAt: number | null;
  lastObservedAt: number | null;
  createdAt: number;
  updatedAt: number;
  conformanceStatus?: "passed" | "failed" | null;
  conformanceCheckedAt?: number | null;
  conformanceExpiresAt?: number | null;
}

export const DEFAULT_ACCOUNT_HOST_SORT = "recommended" as const;
export const PUBLIC_ACCOUNT_HOST_ACTIVITY_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const PUBLIC_ACCOUNT_HOST_CLAIM_GRACE_MS = 72 * 60 * 60 * 1000;
export const PUBLIC_ACCOUNT_HOST_INTENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type AccountHostSort =
  | typeof DEFAULT_ACCOUNT_HOST_SORT
  | "accounts"
  | "name"
  | "recent";

export interface AccountHostDirectoryOptions {
  query?: string;
  includeLinkedApps?: boolean;
  verificationStatus?: HostVerificationStatus | "all";
  signupStatus?: HostSignupStatus | "all";
  signupStatuses?: HostSignupStatus[];
  hasSignupUrl?: boolean;
  trustedOnly?: boolean;
  publicOnly?: boolean;
  now?: number;
  sort?: AccountHostSort;
  page?: number;
  pageSize?: number;
}

export interface AccountHostDirectoryResult {
  hosts: AccountHost[];
  /** Explicit or inferred host-to-app matches keyed by account-host domain. */
  linkedApps?: Record<string, AccountHostLinkedApp[]>;
  /** Rolling-deploy compatibility with the original one-app projection. */
  linkedAppSlugs?: Record<string, string>;
  total: number;
  page: number;
  pageSize: number;
  sort: AccountHostSort;
}

export interface AccountHostLinkedApp {
  slug: string;
  name: string;
  relationship: "same_product" | "same_operator" | "inferred";
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
  signupUrl?: string;
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
  /** Legacy methods remain readable so deployed managers are not locked out. */
  method:
    | "dns_txt"
    | "atproto_handle"
    | "local_dev_fixture"
    | "oauth_atproto_account"
    | "pds_contact_email";
  claimedAt: number;
  verifiedAt: number;
  updatedAt: number;
}

export interface AccountHostClaimAuthority {
  handle: string;
  did: string | null;
}

export const ACCOUNT_HOST_EMAIL_CLAIM_RECOVERY_COOLDOWN_MS = 48 * 60 * 60 *
  1000;
export const ACCOUNT_HOST_EMAIL_CLAIM_RECOVERY_FINALIZE_WINDOW_MS = 7 * 24 *
  60 * 60 * 1000;

export type AccountHostClaimRecoveryNotificationStatus =
  | "pending"
  | "sent"
  | "failed"
  | "unavailable";

export interface AccountHostClaimRecovery {
  id: string;
  host: string;
  currentOwnerDid: string;
  currentOwnerHandle: string;
  requesterDid: string;
  requesterHandle: string;
  createdAt: number;
  eligibleAt: number;
  expiresAt: number;
  status: "pending" | "completed" | "expired" | "invalidated";
  notificationStatus: AccountHostClaimRecoveryNotificationStatus;
  notificationAttemptedAt: number | null;
  completedAt: number | null;
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
  signupUrl?: string | null;
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
  signupUrl?: string | null;
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
      | "dns_required"
      | "already_claimed"
      | "recovery_pending"
      | HostContactEmailVerificationFailureReason
      | HostDnsChallengeVerificationFailureReason;
    host?: AccountHost;
    authority?: AccountHostClaimAuthority | null;
    claim?: AccountHostClaim | null;
    recovery?: AccountHostClaimRecovery;
  };

export interface AccountHostClaimOptions {
  operatorListingOptIn?: boolean;
}

export interface DnsAccountHostClaimOptions extends AccountHostClaimOptions {
  transfer?: ResolvedHostOwnerTransferContext;
}

export interface ContactEmailAccountHostClaimOptions
  extends AccountHostClaimOptions {
  now?: number;
}

export type FinalizeAccountHostEmailClaimRecoveryResult =
  | {
    ok: true;
    host: AccountHost;
    claim: AccountHostClaim;
    recovery: AccountHostClaimRecovery;
  }
  | {
    ok: false;
    reason:
      | "not_found"
      | "not_requester"
      | "not_ready"
      | "expired"
      | "owner_changed"
      | "fresh_dns_required"
      | HostDnsChallengeVerificationFailureReason;
    recovery?: AccountHostClaimRecovery;
  };

export interface AccountHostClaimRecoveryNotificationInput {
  status: Exclude<
    AccountHostClaimRecoveryNotificationStatus,
    "pending"
  >;
  deliveryId?: string | null;
  emailFingerprint?: string | null;
  attemptedAt?: number;
}

export interface AccountHostClaimRecoveryNotificationReservationOptions {
  now?: number;
  /** A crashed sender may be retried after this lease; defaults to 5 minutes. */
  retryAfterMs?: number;
}

export interface AccountHostClaimRecoveryNotificationReservation {
  recovery: AccountHostClaimRecovery;
  /** Opaque HMAC from the exact email-claim evidence being recovered. */
  expectedEmailFingerprint: string | null;
}

class DnsClaimCompletionError extends Error {
  constructor(
    readonly reason:
      | HostDnsChallengeVerificationFailureReason
      | "claim_conflict",
  ) {
    super(reason);
    this.name = "DnsClaimCompletionError";
  }
}

class ContactEmailClaimCompletionError extends Error {
  constructor(
    readonly reason:
      | HostContactEmailVerificationFailureReason
      | "claim_conflict",
  ) {
    super(reason);
    this.name = "ContactEmailClaimCompletionError";
  }
}

class HostClaimRecoveryCompletionError extends Error {
  constructor(readonly reason: "owner_changed" | "recovery_changed") {
    super(reason);
    this.name = "HostClaimRecoveryCompletionError";
  }
}

export type AccountHostRegistrationResult =
  | { ok: true; host: AccountHost; claim: AccountHostClaim }
  | {
    ok: false;
    reason:
      | "invalid_host"
      | "invalid_display_name"
      | "invalid_homepage_url"
      | "invalid_signup_url"
      | "invalid_service_endpoint"
      | "invalid_account_management_url"
      | "invalid_support_url"
      | "invalid_profile_handle"
      | "already_claimed"
      | "dns_required"
      | "not_authorized";
    message: string;
    host?: AccountHost | null;
    claim?: AccountHostClaim | null;
  };

export interface ValidAccountHostRegistrationInput {
  host: string;
  displayName: string;
  description: string;
  dataLocation: string | null;
  inferredLocation: string | null;
  inferredLocationSource: string | null;
  inferredLocationCheckedAt: number | null;
  inferredLocationEvidenceJson: string | null;
  homepageUrl: string | null;
  signupUrl: string | null;
  serviceEndpoint: string | null;
  accountManagementUrl: string | null;
  supportUrl: string | null;
  avatarUrl: string | null;
  signupStatus: HostSignupStatus;
  profileHandle: string;
  bskyProfileVisible: boolean;
}

export type AccountHostRegistrationFieldValidationResult =
  | { ok: true; input: ValidAccountHostRegistrationInput }
  | {
    ok: false;
    reason:
      | "invalid_host"
      | "invalid_display_name"
      | "invalid_homepage_url"
      | "invalid_signup_url"
      | "invalid_service_endpoint"
      | "invalid_account_management_url"
      | "invalid_support_url"
      | "invalid_profile_handle"
      | "not_authorized";
    message: string;
  };

export type AccountHostProfileSettingsResult =
  | { ok: true; host: AccountHost }
  | {
    ok: false;
    reason:
      | "invalid_display_name"
      | "invalid_homepage_url"
      | "invalid_signup_url"
      | "invalid_profile_handle"
      | "invalid_avatar_url"
      | "not_authorized";
    message: string;
  };

const BSKY_PROFILE =
  "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile";
const HOST_PROFILE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const HOST_PROFILE_MISS_RETRY_MS = 6 * 60 * 60 * 1000;
// Keep this above the seeded host count so first-run directory hydration can
// pick up avatars for every known host without waiting for a later request.
const HOST_PROFILE_REFRESH_BATCH_SIZE = 16;

const SEEDED_HOSTS: SeedHost[] = [
  {
    host: "bsky.network",
    displayName: "Bluesky",
    description:
      "A large general-purpose account host for people using Bluesky and other Atmosphere apps.",
    homepageUrl: "https://bsky.app",
    signupUrl: "https://bsky.app/",
    serviceEndpoint: compiledAccountHostServiceEndpoint("bsky.network") ??
      undefined,
    accountManagementUrl: "https://bsky.app/settings",
    profileHandle: "bsky.app",
    claimHandle: "bsky.app",
    signupStatus: "open",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["bsky.network", "bsky.social", "*.bsky.network"],
  },
  {
    host: "atproto.brid.gy",
    displayName: "Bridgy Fed for the fediverse",
    description:
      "An account host that connects AT Protocol accounts with the fediverse through Bridgy Fed.",
    homepageUrl: "https://fed.brid.gy/",
    serviceEndpoint: "https://atproto.brid.gy",
    profileHandle: "ap.brid.gy",
    claimHandle: "ap.brid.gy",
    signupStatus: "unknown",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["atproto.brid.gy"],
  },
  {
    host: "pds.wsocial.network",
    displayName: "W Social",
    description:
      "A social account host for people using W Social and other Atmosphere apps.",
    homepageUrl: "https://wsocial.eu/",
    serviceEndpoint: "https://pds.wsocial.network",
    profileHandle: "wsocial.eu",
    claimHandle: "wsocial.eu",
    signupStatus: "invite_required",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["pds.wsocial.network"],
  },
  {
    host: "roomy.chat",
    displayName: "Roomy",
    description:
      "A Roomy account host listed while more host details are confirmed.",
    homepageUrl: "https://roomy.chat",
    serviceEndpoint: "https://roomy.chat",
    profileHandle: "roomy.space",
    claimHandle: "roomy.space",
    signupStatus: "unknown",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["roomy.chat", "*.roomy.chat"],
  },
  {
    host: "northsky.social",
    displayName: "Northsky",
    description:
      "A Northsky account host listed while more host details are confirmed.",
    homepageUrl: "https://northsky.social",
    serviceEndpoint: "https://northsky.social",
    profileHandle: "transrights.northsky.social",
    claimHandle: "transrights.northsky.social",
    signupStatus: "unknown",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["northsky.social", "*.northsky.social"],
  },
  {
    host: "bookhive.social",
    displayName: "BookHive",
    description:
      "A BookHive account host listed while more host details are confirmed.",
    homepageUrl: "https://bookhive.social",
    serviceEndpoint: "https://bookhive.social",
    profileHandle: "bookhive.buzz",
    claimHandle: "bookhive.buzz",
    signupStatus: "unknown",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: ["bookhive.social", "*.bookhive.social"],
  },
  {
    host: "selfhosted.social",
    displayName: "Self Hosted",
    description:
      "An independent account host for people who want a community-run home for their Atmosphere account.",
    homepageUrl: "https://selfhosted.social",
    signupUrl: "https://selfhosted.social/signup",
    serviceEndpoint: "https://selfhosted.social",
    capabilitiesJson: JSON.stringify([{
      id: "account.atmosphere.host.defs#capabilityOAuthAccountCreation",
      status: "account.atmosphere.host.defs#capabilitySupported",
      url: "https://selfhosted.social/signup",
      note: "Supports OAuth prompt=create account creation.",
    }]),
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
    matchPatterns: [
      "blacksky.community",
      "*.blacksky.community",
      "blacksky.app",
      "*.blacksky.app",
    ],
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
    homepageUrl: "https://tangled.org",
    signupUrl: "https://tangled.org/signup",
    profileHandle: "tangled.org",
    claimHandle: "tangled.org",
    signupStatus: "open",
    verificationStatus: "observed",
    source: "seeded",
    matchPatterns: [
      "tangled.org",
      "*.tangled.org",
      "tangled.sh",
      "tngl.sh",
      "*.tngl.sh",
    ],
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
    signupUrl: seed.signupUrl ?? null,
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
    publicIntentStatus: "unknown",
    publicIntentSource: null,
    publicIntentCheckedAt: null,
    publicIntentAttemptedAt: null,
    publicIntentEvidenceJson: null,
    profileCheckedAt: null,
    observedAccountCount: 0,
    observedActiveAccountCount: 0,
    lastActiveAt: null,
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
    host.inferredLocation,
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
    signupUrl: row.signup_url ? String(row.signup_url) : null,
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
    publicIntentStatus: normalizePublicIntentStatus(
      row.public_intent_status,
    ),
    publicIntentSource: normalizePublicIntentSource(row.public_intent_source),
    publicIntentCheckedAt: row.public_intent_checked_at == null
      ? null
      : Number(row.public_intent_checked_at),
    publicIntentAttemptedAt: row.public_intent_attempted_at == null
      ? null
      : Number(row.public_intent_attempted_at),
    publicIntentEvidenceJson: row.public_intent_evidence_json
      ? String(row.public_intent_evidence_json)
      : null,
    operatorListingOptIn: row.operator_listing_opt_in == null
      ? null
      : Number(row.operator_listing_opt_in) !== 0,
    operatorListingOptedAt: row.operator_listing_opted_at == null
      ? null
      : Number(row.operator_listing_opted_at),
    profileCheckedAt: row.profile_checked_at == null
      ? null
      : Number(row.profile_checked_at),
    observedAccountCount: row.observed_account_count == null
      ? 0
      : Number(row.observed_account_count),
    observedActiveAccountCount: row.observed_active_account_count == null
      ? 0
      : Number(row.observed_active_account_count),
    lastActiveAt: row.last_active_at == null
      ? null
      : Number(row.last_active_at),
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
    conformanceStatus: row.conformance_status === "passed" ||
        row.conformance_status === "failed"
      ? row.conformance_status
      : null,
    conformanceCheckedAt: row.conformance_checked_at == null
      ? null
      : Number(row.conformance_checked_at),
    conformanceExpiresAt: row.conformance_expires_at == null
      ? null
      : Number(row.conformance_expires_at),
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

function normalizePublicIntentStatus(value: unknown): HostPublicIntentStatus {
  return value === "detected" || value === "not_detected" ? value : "unknown";
}

function normalizePublicIntentSource(
  value: unknown,
): HostPublicIntentSource | null {
  return value === "pds_open_signup" || value === "pds_managed_invites"
    ? value
    : null;
}

interface HostProfile {
  did: string;
  handle: string;
  displayName: string | null;
  description: string | null;
  avatarUrl: string | null;
}

type HostProfileResult =
  | { status: "found"; profile: HostProfile }
  | { status: "miss" }
  | { status: "error" };

async function fetchHostProfile(
  handle: string,
  signal?: AbortSignal,
): Promise<HostProfile | null> {
  const url = new URL(BSKY_PROFILE);
  url.searchParams.set("actor", handle);
  const timeout = AbortSignal.timeout(3500);
  const res = await fetch(url.toString(), {
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`host profile HTTP ${res.status}`);
  if (!isJsonMediaType(res.headers.get("content-type"))) {
    await res.body?.cancel().catch(() => {});
    throw new Error("host profile returned a non-JSON response");
  }
  const body = await readResponseTextWithLimit(res, 256 * 1024);
  if (!body.ok) throw new Error(`host profile ${body.error}`);
  const json = JSON.parse(body.text) as Record<string, unknown>;
  const did = typeof json.did === "string" ? json.did : "";
  const resolvedHandle = typeof json.handle === "string"
    ? json.handle.toLowerCase()
    : "";
  const displayName = typeof json.displayName === "string" &&
      json.displayName.trim()
    ? json.displayName.trim().slice(0, 80)
    : null;
  const description = typeof json.description === "string" &&
      json.description.trim()
    ? json.description.trim().slice(0, 600)
    : null;
  const avatarUrl = typeof json.avatar === "string"
    ? normalizeAccountHostPublicHttpsUrl(json.avatar)
    : null;
  if (!isDid(did) || !isHandle(resolvedHandle)) return null;
  return { did, handle: resolvedHandle, displayName, description, avatarUrl };
}

export async function fetchHostProfileForTest(
  handle: string,
  signal?: AbortSignal,
): Promise<HostProfile | null> {
  return await fetchHostProfile(handle, signal);
}

function hostNeedsProfileRefresh(host: AccountHost, ts: number): boolean {
  if (profileHandleCandidatesForHost(host).length === 0) return false;
  const checkedAt = host.profileCheckedAt ?? 0;
  const ttl = host.avatarUrl
    ? HOST_PROFILE_REFRESH_MS
    : HOST_PROFILE_MISS_RETRY_MS;
  return checkedAt <= 0 || ts - checkedAt > ttl;
}

function normalizeHostProfileCandidate(
  value: string | null | undefined,
): string | null {
  const handle = (value ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!handle || handle.includes(":") || !handle.includes(".")) return null;
  return handle;
}

export function profileHandleCandidatesForHost(
  host: Pick<AccountHost, "host" | "profileHandle">,
): string[] {
  const candidates = [
    normalizeHostProfileCandidate(host.host),
    normalizeHostProfileCandidate(host.profileHandle),
  ].filter((handle): handle is string => !!handle);
  return [...new Set(candidates)];
}

function normalizeHandle(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^@/, "").toLowerCase();
}

/**
 * Return the authority compiled into the curated seed list, never a mutable
 * value copied back out of the database. Seed rows are a privileged mapping;
 * self-service and indexed records must not be able to redefine it.
 */
export function pinnedSeededAccountHostClaimHandle(
  host: Pick<AccountHost, "host"> & Partial<Pick<AccountHost, "source">>,
): string | null {
  if (host.source !== undefined && host.source !== "seeded") return null;
  const normalizedHost = normalizeHandle(host.host);
  const seed = SEEDED_HOSTS.find((candidate) =>
    normalizeHandle(candidate.host) === normalizedHost
  );
  if (!seed) return null;
  return normalizeClaimProfileHandle(
    seed.claimHandle ?? seed.profileHandle ?? seed.host,
  );
}

/**
 * Compiled hostnames whose legacy OAuth ownership must be revalidated against
 * the pinned AT Protocol identity. The returned list cannot be influenced by
 * mutable database source or claim-pin columns.
 */
export function pinnedSeededAccountHostNames(): string[] {
  return SEEDED_HOSTS.map((seed) => normalizeHandle(seed.host));
}

/**
 * Resolve the operator identity pinned by the compiled seed map. Callers that
 * already loaded an account-host row should pass its source; indexers may omit
 * source so a corrupted/missing row cannot make a curated domain unprotected.
 */
export async function resolvePinnedSeededAccountHostAuthority(
  host: Pick<AccountHost, "host"> & Partial<Pick<AccountHost, "source">>,
  options: {
    resolveIdentity?: (
      handle: string,
    ) => Promise<{ did: string; handle: string }>;
  } = {},
): Promise<AccountHostClaimAuthority | null> {
  const handle = pinnedSeededAccountHostClaimHandle(host);
  if (!handle) return null;
  const identity = await (options.resolveIdentity ?? resolveAtprotoIdentity)(
    handle,
  ).catch(() => null);
  if (!identity || normalizeHandle(identity.handle) !== handle) {
    return { handle, did: null };
  }
  return { handle, did: identity.did };
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

export function normalizeAccountHostPublicHttpsUrl(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (isPrivateNetworkUrl(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    return normalizedPublicUrlString(url);
  } catch {
    return null;
  }
}

export function normalizeAccountHostPublicServiceEndpoint(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (isPrivateNetworkUrl(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return normalizedPublicUrlString(url);
  } catch {
    return null;
  }
}

function normalizedPublicUrlString(url: URL): string {
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.origin}${path}${url.search}`;
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

function parseHostClaimRow(row: Record<string, unknown>): AccountHostClaim {
  const method = row.method === "pds_contact_email"
    ? "pds_contact_email"
    : row.method === "dns_txt"
    ? "dns_txt"
    : row.method === "atproto_handle"
    ? "atproto_handle"
    : row.method === "local_dev_fixture"
    ? "local_dev_fixture"
    : "oauth_atproto_account";
  return {
    host: String(row.host),
    claimantDid: String(row.claimant_did),
    claimantHandle: String(row.claimant_handle),
    method,
    claimedAt: Number(row.claimed_at),
    verifiedAt: Number(row.verified_at),
    updatedAt: Number(row.updated_at),
  };
}

function normalizedTimestamp(value?: number): number {
  return value != null && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : now();
}

function contactEmailEvidenceId(tokenHash: string): string {
  return `email:${tokenHash}`;
}

function dnsRecoveryId(tokenHash: string): string {
  return `dns-recovery:${tokenHash}`;
}

function parseAccountHostClaimRecovery(
  row: Record<string, unknown>,
): AccountHostClaimRecovery {
  const status = row.status === "completed"
    ? "completed"
    : row.status === "expired"
    ? "expired"
    : row.status === "invalidated"
    ? "invalidated"
    : "pending";
  const notificationStatus = row.notification_status === "sent"
    ? "sent"
    : row.notification_status === "failed"
    ? "failed"
    : row.notification_status === "unavailable"
    ? "unavailable"
    : "pending";
  return {
    id: String(row.id ?? ""),
    host: String(row.host ?? ""),
    currentOwnerDid: String(row.previous_owner_did ?? ""),
    currentOwnerHandle: String(row.previous_owner_handle ?? ""),
    requesterDid: String(row.requester_did ?? ""),
    requesterHandle: String(row.requester_handle ?? ""),
    createdAt: Number(row.requested_at ?? 0),
    eligibleAt: Number(row.eligible_at ?? 0),
    expiresAt: Number(row.expires_at ?? 0),
    status,
    notificationStatus,
    notificationAttemptedAt: row.notification_attempted_at == null
      ? null
      : Number(row.notification_attempted_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
  };
}

type AccountHostClaimRecoveryAuditEvent =
  | "requested"
  | "notification_sent"
  | "notification_failed"
  | "notification_unavailable"
  | "finalized"
  | "expired"
  | "invalidated";

async function insertHostClaimRecoveryAudit(
  c: DbClient,
  input: {
    id: string;
    recoveryId: string;
    host: string;
    event: AccountHostClaimRecoveryAuditEvent;
    actorDid: string | null;
    occurredAt: number;
    proofTokenHash?: string | null;
    deliveryId?: string | null;
    emailFingerprint?: string | null;
  },
): Promise<void> {
  await c.execute({
    sql: `INSERT INTO account_host_claim_recovery_audit (
        id, recovery_id, host, event, actor_did, proof_token_hash,
        delivery_id, email_fingerprint, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
    args: [
      input.id,
      input.recoveryId,
      input.host,
      input.event,
      input.actorDid,
      input.proofTokenHash ?? null,
      input.deliveryId ?? null,
      input.emailFingerprint ?? null,
      input.occurredAt,
    ],
  });
}

async function fetchHostProfileRefreshes(
  hosts: AccountHost[],
  signal?: AbortSignal,
): Promise<{
  ts: number;
  results: Array<{ host: AccountHost; result: HostProfileResult }>;
}> {
  const ts = now();
  const candidates = hosts
    .filter((host) => hostNeedsProfileRefresh(host, ts))
    .sort((a, b) =>
      hostProfileRefreshRank(a) - hostProfileRefreshRank(b) ||
      a.displayName.localeCompare(b.displayName)
    )
    .slice(0, HOST_PROFILE_REFRESH_BATCH_SIZE);
  if (candidates.length === 0) return { ts, results: [] };

  const results: Array<{ host: AccountHost; result: HostProfileResult }> =
    await Promise.all(candidates.map(async (host) => {
      let hadError = false;
      try {
        for (const handle of profileHandleCandidatesForHost(host)) {
          signal?.throwIfAborted();
          try {
            const profile = await fetchHostProfile(handle, signal);
            if (profile) {
              return {
                host,
                result: { status: "found", profile } as const,
              };
            }
          } catch (error) {
            if (signal?.aborted) throw signal.reason ?? error;
            hadError = true;
          }
        }
        return {
          host,
          result: hadError
            ? ({ status: "error" } as const)
            : ({ status: "miss" } as const),
        };
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        return { host, result: { status: "error" } as const };
      }
    }));

  return { ts, results };
}

function hostProfileRefreshRank(host: AccountHost): number {
  if (host.source === "seeded" && !host.avatarUrl) return 0;
  if (!host.avatarUrl) return 1;
  if (host.source === "seeded") return 2;
  return 3;
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
      const nextDisplayName = hostProfileDisplayName(host, profile);
      const nextDescription = hostProfileDescription(host, profile);
      await c.execute({
        sql: `UPDATE account_host
          SET display_name = ?,
              description = ?,
              profile_handle = ?, profile_did = ?, avatar_url = ?,
              profile_checked_at = ?, updated_at = ?
          WHERE host = ?`,
        args: [
          nextDisplayName,
          nextDescription,
          profile.handle,
          profile.did,
          profile.avatarUrl,
          ts,
          ts,
          host.host,
        ],
      });
      refreshed.set(host.host, {
        displayName: nextDisplayName,
        description: nextDescription,
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

function hostProfileDisplayName(
  host: AccountHost,
  profile: HostProfile,
): string {
  if (
    host.source !== "seeded" &&
    profile.displayName &&
    (!host.displayName.trim() || host.displayName === host.host)
  ) {
    return profile.displayName;
  }
  return host.displayName;
}

function hostProfileDescription(
  host: AccountHost,
  profile: HostProfile,
): string {
  const genericObservedDescription =
    "An account host observed from public account activity.";
  if (
    host.source !== "seeded" &&
    profile.description &&
    (!host.description.trim() ||
      host.description === genericObservedDescription)
  ) {
    return profile.description;
  }
  return host.description;
}

async function ensureSeededHosts(
  c: DbClient,
  options: { force?: boolean } = {},
): Promise<void> {
  const ts = now();
  if (
    !options.force && ts - seededHostsSyncedAt < SEEDED_HOSTS_SYNC_TTL_MS
  ) return;
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
          host, display_name, description, data_location, homepage_url, signup_url,
          service_endpoint, account_management_url, dashboard_url,
          capability_manifest_url, capabilities_json, support_url,
          profile_handle, bsky_profile_visible, claim_handle, signup_status, verification_status,
          source, match_patterns,
          last_checked_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET
          display_name = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.display_name
            ELSE excluded.display_name
          END,
          description = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.description
            ELSE excluded.description
          END,
          data_location = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.data_location
            ELSE COALESCE(excluded.data_location, account_host.data_location)
          END,
          homepage_url = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.homepage_url
            ELSE excluded.homepage_url
          END,
          signup_url = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.signup_url
            ELSE excluded.signup_url
          END,
          service_endpoint = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.service_endpoint
            ELSE COALESCE(account_host.service_endpoint, excluded.service_endpoint)
          END,
          account_management_url = CASE
            WHEN account_host.verification_status = 'claimed'
            THEN account_host.account_management_url
            WHEN excluded.account_management_url IS NOT NULL THEN excluded.account_management_url
            ELSE account_host.account_management_url
          END,
          dashboard_url = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.dashboard_url
            ELSE COALESCE(account_host.dashboard_url, excluded.dashboard_url)
          END,
          capability_manifest_url = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.capability_manifest_url
            ELSE COALESCE(account_host.capability_manifest_url, excluded.capability_manifest_url)
          END,
          capabilities_json = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.capabilities_json
            ELSE COALESCE(account_host.capabilities_json, excluded.capabilities_json)
          END,
          support_url = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.support_url
            ELSE COALESCE(account_host.support_url, excluded.support_url)
          END,
          profile_did = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.profile_did
            WHEN COALESCE(account_host.profile_handle, '') <> excluded.profile_handle
            THEN NULL
            ELSE account_host.profile_did
          END,
          avatar_url = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.avatar_url
            WHEN COALESCE(account_host.profile_handle, '') <> excluded.profile_handle
            THEN NULL
            ELSE account_host.avatar_url
          END,
          profile_checked_at = CASE
            WHEN account_host.verification_status = 'claimed'
            THEN account_host.profile_checked_at
            WHEN COALESCE(account_host.profile_handle, '') <> excluded.profile_handle
            THEN NULL
            WHEN account_host.avatar_url IS NULL
              AND account_host.profile_handle = excluded.profile_handle
            THEN NULL
            ELSE account_host.profile_checked_at
          END,
          profile_handle = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.profile_handle
            ELSE excluded.profile_handle
          END,
          bsky_profile_visible = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.bsky_profile_visible
            ELSE excluded.bsky_profile_visible
          END,
          claim_did = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.claim_did
            WHEN COALESCE(account_host.claim_handle, '') <> excluded.claim_handle
            THEN NULL
            ELSE account_host.claim_did
          END,
          claim_handle = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.claim_handle
            ELSE excluded.claim_handle
          END,
          signup_status = CASE
            WHEN account_host.verification_status = 'claimed' THEN account_host.signup_status
            ELSE excluded.signup_status
          END,
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
        seed.signupUrl ?? null,
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

/** Return the current DNS recovery state without exposing proof hashes,
 * delivery identifiers, or mailbox fingerprints to management surfaces. */
export async function getPendingAccountHostClaimRecovery(
  host: string,
  options: { now?: number } = {},
): Promise<AccountHostClaimRecovery | null> {
  const normalized = normalizeHandle(host);
  if (!normalized) return null;
  const at = normalizedTimestamp(options.now);
  return await withDbTransaction(async (c) => {
    await reconcilePendingHostClaimRecovery(c, normalized, at);
    const result = await c.execute({
      sql: `SELECT * FROM account_host_claim_recovery
        WHERE host = ? AND status = 'pending'
        ORDER BY requested_at DESC LIMIT 1`,
      args: [normalized],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? parseAccountHostClaimRecovery(row) : null;
  });
}

export async function listPendingAccountHostClaimRecoveriesForDid(
  did: string,
  options: { now?: number } = {},
): Promise<AccountHostClaimRecovery[]> {
  const normalizedDid = did.trim();
  if (!normalizedDid) return [];
  const at = normalizedTimestamp(options.now);
  return await withDbTransaction(async (c) => {
    const hosts = await c.execute({
      sql: `SELECT DISTINCT host FROM account_host_claim_recovery
        WHERE (requester_did = ? OR previous_owner_did = ?)
          AND status = 'pending'`,
      args: [normalizedDid, normalizedDid],
    });
    for (const row of hosts.rows as Record<string, unknown>[]) {
      const host = String(row.host ?? "");
      if (host) await reconcilePendingHostClaimRecovery(c, host, at);
    }
    const result = await c.execute({
      sql: `SELECT * FROM account_host_claim_recovery
        WHERE (requester_did = ? OR previous_owner_did = ?)
          AND status = 'pending'
        ORDER BY requested_at DESC`,
      args: [normalizedDid, normalizedDid],
    });
    return (result.rows as Record<string, unknown>[]).map(
      parseAccountHostClaimRecovery,
    );
  });
}

export async function hasManagedAccountHost(did: string): Promise<boolean> {
  const normalized = did.trim();
  if (!normalized) return false;
  return (await listManagedAccountHosts(normalized)).length > 0;
}

export async function listManagedAccountHosts(
  did: string,
): Promise<AccountHost[]> {
  const normalized = did.trim();
  if (!normalized) return [];
  const rows = await withDb(async (c) => {
    const r = await c.execute(managedAccountHostsQuery(normalized));
    return r.rows as Record<string, unknown>[];
  });
  const verified = await Promise.all(rows.map(async (row) => {
    const host = parseHostRow(row);
    const claim = parseManagedHostClaimRow(row);
    const ownerDid = await verifiedAccountHostOwnerDid(host, claim).catch(
      () => null,
    );
    return ownerDid === normalized ? host : null;
  }));
  // Management and preferred-host eligibility must be complete. A silent cap
  // here made a DID's 21st verified host impossible to manage or recommend.
  // Page at the presentation layer when needed; never truncate authority data.
  return verified.filter((host): host is AccountHost => host !== null);
}

function managedAccountHostsQuery(
  claimantDid: string,
): { sql: string; args: string[] } {
  return {
    sql: `SELECT h.*,
        c.host AS managed_claim_host,
        c.claimant_did AS managed_claimant_did,
        c.claimant_handle AS managed_claimant_handle,
        c.method AS managed_claim_method,
        c.claimed_at AS managed_claimed_at,
        c.verified_at AS managed_verified_at,
        c.updated_at AS managed_claim_updated_at
      FROM account_host h
      INNER JOIN account_host_claim c ON c.host = h.host
      WHERE c.claimant_did = ?
      ORDER BY lower(h.display_name), h.host`,
    args: [claimantDid],
  };
}

function parseManagedHostClaimRow(
  row: Record<string, unknown>,
): AccountHostClaim {
  return parseHostClaimRow({
    host: row.managed_claim_host,
    claimant_did: row.managed_claimant_did,
    claimant_handle: row.managed_claimant_handle,
    method: row.managed_claim_method,
    claimed_at: row.managed_claimed_at,
    verified_at: row.managed_verified_at,
    updated_at: row.managed_claim_updated_at,
  });
}

export const managedAccountHostsQueryForTest = managedAccountHostsQuery;

export async function listClaimedAccountHostsForOwner(
  did: string,
): Promise<AccountHost[]> {
  return await listManagedAccountHosts(did);
}

export async function resolveAccountHostClaimAuthority(
  host: AccountHost,
  options: {
    resolveIdentity?: (
      handle: string,
    ) => Promise<{ did: string; handle: string }>;
  } = {},
): Promise<AccountHostClaimAuthority | null> {
  // Curated seed mappings pin social metadata and let us revalidate
  // grandfathered OAuth claims. They are not accepted as proof for a new
  // production claim; that path requires the DNS challenge.
  const authority = await resolvePinnedSeededAccountHostAuthority(
    { host: host.host },
    options,
  );
  if (!authority) return null;
  if (!authority.did) return authority;
  if (
    normalizeHandle(host.claimHandle) !== authority.handle ||
    host.claimDid !== authority.did
  ) {
    await withDb(async (c) => {
      await c.execute({
        sql: `UPDATE account_host
          SET claim_handle = ?, claim_did = ?, source = 'seeded', updated_at = ?
          WHERE host = ?`,
        args: [authority.handle, authority.did, now(), host.host],
      });
    });
  }
  return authority;
}

export function accountHostClaimAuthorityMatchesUser(
  authority: AccountHostClaimAuthority,
  user: { did: string; handle: string },
): boolean {
  // A handle without a successfully resolved/pinned DID is not authority.
  // In particular, never fall back to the session's cached handle.
  return !!authority.did && authority.did === user.did;
}

interface AccountHostOwnerVerificationOptions {
  resolveIdentity?: (
    handle: string,
  ) => Promise<{ did: string; handle: string }>;
  isDev?: boolean;
}

export async function verifiedAccountHostClaimOwnerDid(
  host: string,
  claim: Pick<AccountHostClaim, "host" | "claimantDid" | "method">,
  options: AccountHostOwnerVerificationOptions = {},
): Promise<string | null> {
  const normalizedHost = normalizeHandle(host);
  if (
    !normalizedHost || normalizeHandle(claim.host) !== normalizedHost ||
    !claim.claimantDid.trim()
  ) return null;
  // Contact-email ownership remains operational until a stronger DNS recovery
  // is explicitly finalized. Creation is restricted to the atomic email-proof
  // path below and is never accepted by generic owner refreshes or transfers.
  if (
    claim.method === "pds_contact_email" || claim.method === "dns_txt" ||
    claim.method === "atproto_handle"
  ) {
    return claim.claimantDid.trim();
  }
  if (claim.method === "local_dev_fixture") {
    return hostSelfServiceClaimPolicy(normalizedHost, options) === "local-dev"
      ? claim.claimantDid.trim()
      : null;
  }
  // Preserve old OAuth claims. Curated rows still re-resolve their pinned DID.
  const authority = await resolvePinnedSeededAccountHostAuthority(
    { host: normalizedHost },
    options,
  );
  if (!authority) return claim.claimantDid.trim();
  return authority.did && authority.did === claim.claimantDid.trim()
    ? authority.did
    : null;
}

export async function verifiedAccountHostOwnerDid(
  host: AccountHost,
  claim: AccountHostClaim | null,
  options: AccountHostOwnerVerificationOptions = {},
): Promise<string | null> {
  if (!claim) return null;
  return await verifiedAccountHostClaimOwnerDid(host.host, claim, options);
}

interface AccountHostClaimUpdateQueryInput {
  host: string;
  claimHandle: string;
  claimDid: string;
  operatorListingOptIn?: boolean;
  timestamp: number;
}

function accountHostClaimUpdateQuery(
  input: AccountHostClaimUpdateQueryInput,
): { sql: string; args: Array<string | number | null> } {
  const listingWasSelected = input.operatorListingOptIn != null;
  return {
    sql: `UPDATE account_host
      SET claim_handle = CASE
            WHEN source = 'seeded' THEN claim_handle
            ELSE ?
          END,
          claim_did = CASE
            WHEN source = 'seeded' THEN claim_did
            ELSE ?
          END,
          verification_status = CASE
            WHEN verification_status = 'verified' THEN 'verified'
            ELSE 'claimed'
          END,
          ${
      listingWasSelected
        ? `operator_listing_opt_in = ?,
          operator_listing_opted_at = ?,`
        : ""
    }
          updated_at = ?
      WHERE host = ?`,
    args: [
      input.claimHandle,
      input.claimDid,
      ...(listingWasSelected
        ? [listingFlag(input.operatorListingOptIn), input.timestamp]
        : []),
      input.timestamp,
      input.host,
    ],
  };
}

export function accountHostClaimUpdateQueryForTest(
  input: AccountHostClaimUpdateQueryInput,
): { sql: string; args: Array<string | number | null> } {
  return accountHostClaimUpdateQuery(input);
}

interface DnsClaimWriteInput {
  tokenHash: string;
  claim: AccountHostClaim;
  claimHandle: string;
  claimDid: string;
  operatorListingOptIn?: boolean;
  transfer?: ResolvedHostOwnerTransferContext;
  timestamp: number;
}

async function upsertAccountHostClaimForOwner(
  c: DbClient,
  claim: AccountHostClaim,
): Promise<boolean> {
  // Legacy methods remain readable but cannot be minted or refreshed here.
  if (
    claim.method !== "dns_txt" && claim.method !== "atproto_handle" &&
    claim.method !== "local_dev_fixture"
  ) {
    return false;
  }
  const result = await c.execute({
    sql: `INSERT INTO account_host_claim (
        host, claimant_did, claimant_handle, method,
        claimed_at, verified_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host) DO UPDATE SET
        claimant_handle = excluded.claimant_handle,
        method = excluded.method,
        verified_at = excluded.verified_at,
        updated_at = excluded.updated_at
      WHERE account_host_claim.claimant_did = excluded.claimant_did`,
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
  return Number(result.rowsAffected ?? 0) === 1;
}

export const upsertAccountHostClaimForOwnerForTest =
  upsertAccountHostClaimForOwner;

interface AccountHostRegistrationOwnershipInput {
  host: string;
  displayName: string;
  timestamp: number;
  claim: AccountHostClaim;
}

async function establishAccountHostRegistrationOwnership(
  c: DbClient,
  input: AccountHostRegistrationOwnershipInput,
): Promise<boolean> {
  // A fresh claim needs its foreign-key parent before account_host_claim can
  // be inserted. The no-op conflict keeps existing host fields untouched until
  // the conditional ownership upsert confirms this claimant may manage them.
  const parentWrite = await c.execute({
    sql: `INSERT INTO account_host (
        host, display_name, description, created_at, updated_at
      ) VALUES (?, ?, '', ?, ?)
      ON CONFLICT(host) DO NOTHING`,
    args: [
      input.host,
      input.displayName,
      input.timestamp,
      input.timestamp,
    ],
  });
  const parentInserted = Number(parentWrite.rowsAffected ?? 0) === 1;
  const claimed = await upsertAccountHostClaimForOwner(c, input.claim);
  if (!claimed && parentInserted) {
    throw new Error("new account host ownership could not be established");
  }
  return claimed;
}

export const establishAccountHostRegistrationOwnershipForTest =
  establishAccountHostRegistrationOwnership;

async function writeDnsClaimTransaction(
  c: DbClient,
  input: DnsClaimWriteInput,
): Promise<void> {
  if (input.claim.method !== "dns_txt") {
    throw new DnsClaimCompletionError("claim_conflict");
  }
  const consumed = await consumeHostDnsChallenge(c, {
    tokenHash: input.tokenHash,
    host: input.claim.host,
    claimantDid: input.claim.claimantDid,
    consumedAt: input.timestamp,
  });
  if (!consumed.ok) {
    throw new DnsClaimCompletionError(consumed.reason);
  }

  const transferFromDid = input.transfer?.intent.previousOwnerDid ?? null;
  const isTransfer = !!input.transfer && !!transferFromDid &&
    transferFromDid !== input.claim.claimantDid;
  if (isTransfer) {
    const replaced = await c.execute({
      sql: `UPDATE account_host_claim SET
          claimant_did = ?, claimant_handle = ?, method = ?,
          claimed_at = ?, verified_at = ?, updated_at = ?
        WHERE host = ? AND claimant_did = ? AND updated_at = ?`,
      args: [
        input.claim.claimantDid,
        input.claim.claimantHandle,
        input.claim.method,
        input.claim.claimedAt,
        input.claim.verifiedAt,
        input.claim.updatedAt,
        input.claim.host,
        transferFromDid,
        input.transfer!.intent.previousOwnerUpdatedAt,
      ],
    });
    if (Number(replaced.rowsAffected ?? 0) !== 1) {
      throw new DnsClaimCompletionError("claim_conflict");
    }
    await c.execute({
      sql: `INSERT INTO account_host_owner_transfer (
          jti, host, previous_owner_did, new_owner_did, proof_method,
          initiated_at, completed_at
        ) VALUES (?, ?, ?, ?, 'dns_txt', ?, ?)`,
      args: [
        input.transfer!.intent.jti,
        input.claim.host,
        transferFromDid,
        input.claim.claimantDid,
        input.transfer!.intent.issuedAt,
        input.timestamp,
      ],
    });
  } else if (!await upsertAccountHostClaimForOwner(c, input.claim)) {
    throw new DnsClaimCompletionError("claim_conflict");
  }
  // A current manager may legitimately upgrade/repair an email-derived claim,
  // or complete an explicit transfer, while a recovery is cooling down. The
  // newly installed DNS claim wins and atomically releases the stale pending
  // request instead of leaving it visible or able to finalize later.
  await invalidatePendingHostClaimRecovery(
    c,
    input.claim.host,
    input.timestamp,
    input.claim.claimantDid,
  );
  const hostWrite = await c.execute(accountHostClaimUpdateQuery({
    host: input.claim.host,
    claimHandle: input.claimHandle,
    claimDid: input.claimDid,
    operatorListingOptIn: isTransfer ? undefined : input.operatorListingOptIn,
    timestamp: input.timestamp,
  }));
  if (Number(hostWrite.rowsAffected ?? 0) !== 1) {
    throw new Error("claimed account host disappeared during DNS verification");
  }
  if (isTransfer) {
    await c.execute({
      sql: `UPDATE account_host SET
          profile_handle = ?, profile_did = ?, avatar_url = NULL,
          service_record_uri = NULL, service_record_cid = NULL,
          service_observed_at = NULL, updated_at = ?
        WHERE host = ?`,
      args: [
        input.claim.claimantHandle,
        input.claim.claimantDid,
        input.timestamp,
        input.claim.host,
      ],
    });
    await c.execute({
      sql: `UPDATE directory_entity_link SET
          status = 'pending', host_owner_did = ?, host_approved_at = NULL,
          updated_at = ?
        WHERE host = ? AND source = 'claimed'`,
      args: [input.claim.claimantDid, input.timestamp, input.claim.host],
    });
  }
}

export const writeDnsClaimTransactionForTest = writeDnsClaimTransaction;

type PreparedHostContactEmailProof = Extract<
  PreparedHostContactEmailVerificationResult,
  { ok: true }
>;

interface ContactEmailClaimWriteInput {
  proof: PreparedHostContactEmailProof;
  claim: AccountHostClaim;
  claimHandle: string;
  claimDid: string;
  operatorListingOptIn?: boolean;
  timestamp: number;
}

/** The email proof and ownership row are committed together. This deliberately
 * uses INSERT-only claim semantics: contact email can establish an unclaimed
 * host but can never refresh, repair, transfer, or replace ownership. */
async function writeContactEmailClaimTransaction(
  c: DbClient,
  input: ContactEmailClaimWriteInput,
): Promise<void> {
  if (input.claim.method !== "pds_contact_email") {
    throw new ContactEmailClaimCompletionError("claim_conflict");
  }
  // Do not trust a caller-constructed "prepared" object to classify the
  // generic challenge. Re-bind its opaque evidence to the persisted
  // email-specific row inside the ownership transaction; in particular, a DNS
  // challenge has a NULL method_binding and can never enter this path.
  const bound = await c.execute({
    sql: `SELECT 1 FROM account_host_claim_challenge
      WHERE token_hash = ? AND host = ? AND claimant_did = ?
        AND email_fingerprint = ?
        AND method_binding = ? AND method_binding LIKE 'pds-contact-email-v2.%'
        AND created_at = ? AND expires_at = ?
      LIMIT 1`,
    args: [
      input.proof.tokenHash,
      input.claim.host,
      input.claim.claimantDid,
      input.proof.emailFingerprint,
      input.proof.methodBinding,
      input.proof.requestedAt,
      input.proof.expiresAt,
    ],
  });
  if (bound.rows.length !== 1) {
    throw new ContactEmailClaimCompletionError("invalid");
  }
  const consumed = await consumeHostContactEmailChallenge(c, {
    tokenHash: input.proof.tokenHash,
    host: input.claim.host,
    claimantDid: input.claim.claimantDid,
    consumedAt: input.timestamp,
  });
  if (!consumed.ok) {
    throw new ContactEmailClaimCompletionError(consumed.reason);
  }

  const claimWrite = await c.execute({
    sql: `INSERT INTO account_host_claim (
        host, claimant_did, claimant_handle, method,
        claimed_at, verified_at, updated_at
      ) VALUES (?, ?, ?, 'pds_contact_email', ?, ?, ?)
      ON CONFLICT(host) DO NOTHING`,
    args: [
      input.claim.host,
      input.claim.claimantDid,
      input.claim.claimantHandle,
      input.claim.claimedAt,
      input.claim.verifiedAt,
      input.claim.updatedAt,
    ],
  });
  if (Number(claimWrite.rowsAffected ?? 0) !== 1) {
    throw new ContactEmailClaimCompletionError("claim_conflict");
  }

  await c.execute({
    sql: `INSERT INTO account_host_claim_evidence (
        id, host, claimant_did, method, endpoint_origin, pds_did,
        email_fingerprint, challenge_token_hash, requested_at, expires_at,
        completed_at, claim_updated_at, delivery_id
      ) VALUES (?, ?, ?, 'pds_contact_email', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      contactEmailEvidenceId(input.proof.tokenHash),
      input.claim.host,
      input.claim.claimantDid,
      input.proof.endpointOrigin,
      input.proof.pdsDid,
      input.proof.emailFingerprint,
      input.proof.tokenHash,
      input.proof.requestedAt,
      input.proof.expiresAt,
      input.timestamp,
      input.claim.updatedAt,
      input.proof.deliveryId,
    ],
  });

  const hostWrite = await c.execute(accountHostClaimUpdateQuery({
    host: input.claim.host,
    claimHandle: input.claimHandle,
    claimDid: input.claimDid,
    operatorListingOptIn: input.operatorListingOptIn,
    timestamp: input.timestamp,
  }));
  if (Number(hostWrite.rowsAffected ?? 0) !== 1) {
    throw new Error(
      "claimed account host disappeared during email verification",
    );
  }
}

export const writeContactEmailClaimTransactionForTest =
  writeContactEmailClaimTransaction;

interface StartEmailClaimRecoveryInput {
  tokenHash: string;
  host: string;
  previousClaim: AccountHostClaim;
  requester: { did: string; handle: string };
  requestedAt: number;
}

async function startEmailClaimRecoveryTransaction(
  c: DbClient,
  input: StartEmailClaimRecoveryInput,
): Promise<AccountHostClaimRecovery> {
  if (
    input.previousClaim.method !== "pds_contact_email" ||
    input.previousClaim.claimantDid === input.requester.did
  ) {
    throw new HostClaimRecoveryCompletionError("owner_changed");
  }
  const currentResult = await c.execute({
    sql: `SELECT claimant_did, claimant_handle, method, claimed_at,
        verified_at, updated_at
      FROM account_host_claim WHERE host = ? LIMIT 1`,
    args: [input.host],
  });
  const currentRow = currentResult.rows[0] as
    | Record<string, unknown>
    | undefined;
  const current = currentRow
    ? parseHostClaimRow({ ...currentRow, host: input.host })
    : null;
  if (
    !current || current.method !== "pds_contact_email" ||
    current.claimantDid !== input.previousClaim.claimantDid ||
    current.updatedAt !== input.previousClaim.updatedAt
  ) {
    throw new HostClaimRecoveryCompletionError("owner_changed");
  }

  await reconcilePendingHostClaimRecovery(c, input.host, input.requestedAt);
  const pending = await c.execute({
    sql: `SELECT id FROM account_host_claim_recovery
      WHERE host = ? AND status = 'pending' LIMIT 1`,
    args: [input.host],
  });
  if (pending.rows.length > 0) {
    throw new HostClaimRecoveryCompletionError("recovery_changed");
  }
  // Lock and compare the email-derived owner before consuming the DNS proof.
  // A plain SELECT is not enough under Postgres READ COMMITTED: the current
  // owner could strengthen or transfer the claim after our read and before we
  // insert the recovery. This guarded no-op UPDATE is portable to libSQL and
  // makes that owner change serialize with this recovery transaction.
  const ownerReservation = await c.execute({
    sql: `UPDATE account_host_claim SET updated_at = updated_at
      WHERE host = ? AND claimant_did = ? AND method = 'pds_contact_email'
        AND updated_at = ?`,
    args: [input.host, current.claimantDid, current.updatedAt],
  });
  if (Number(ownerReservation.rowsAffected ?? 0) !== 1) {
    throw new HostClaimRecoveryCompletionError("owner_changed");
  }
  // Consume only after reserving both the owner snapshot and pending slot. A
  // race on the partial unique index still rolls this update back with the
  // transaction.
  const consumed = await consumeHostDnsChallenge(c, {
    tokenHash: input.tokenHash,
    host: input.host,
    claimantDid: input.requester.did,
    consumedAt: input.requestedAt,
  });
  if (!consumed.ok) throw new DnsClaimCompletionError(consumed.reason);

  const recoveryId = dnsRecoveryId(input.tokenHash);
  const eligibleAt = input.requestedAt +
    ACCOUNT_HOST_EMAIL_CLAIM_RECOVERY_COOLDOWN_MS;
  const expiresAt = eligibleAt +
    ACCOUNT_HOST_EMAIL_CLAIM_RECOVERY_FINALIZE_WINDOW_MS;
  await c.execute({
    sql: `INSERT INTO account_host_claim_recovery (
        id, host, previous_owner_did, previous_owner_handle,
        previous_owner_updated_at, requester_did, requester_handle,
        proof_method, proof_token_hash, requested_at, eligible_at, expires_at,
        status, notification_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'dns_txt', ?, ?, ?, ?, 'pending', 'pending')`,
    args: [
      recoveryId,
      input.host,
      current.claimantDid,
      current.claimantHandle,
      current.updatedAt,
      input.requester.did,
      input.requester.handle,
      input.tokenHash,
      input.requestedAt,
      eligibleAt,
      expiresAt,
    ],
  });
  await insertHostClaimRecoveryAudit(c, {
    id: `${recoveryId}:requested`,
    recoveryId,
    host: input.host,
    event: "requested",
    actorDid: input.requester.did,
    proofTokenHash: input.tokenHash,
    occurredAt: input.requestedAt,
  });
  return {
    id: recoveryId,
    host: input.host,
    currentOwnerDid: current.claimantDid,
    currentOwnerHandle: current.claimantHandle,
    requesterDid: input.requester.did,
    requesterHandle: input.requester.handle,
    createdAt: input.requestedAt,
    eligibleAt,
    expiresAt,
    status: "pending",
    notificationStatus: "pending",
    notificationAttemptedAt: null,
    completedAt: null,
  };
}

export const startEmailClaimRecoveryTransactionForTest =
  startEmailClaimRecoveryTransaction;

async function expireStaleHostClaimRecovery(
  c: DbClient,
  host: string,
  at: number,
): Promise<void> {
  const result = await c.execute({
    sql: `SELECT id FROM account_host_claim_recovery
      WHERE host = ? AND status = 'pending' AND expires_at <= ?`,
    args: [host, at],
  });
  for (const row of result.rows as Record<string, unknown>[]) {
    const recoveryId = String(row.id ?? "");
    if (!recoveryId) continue;
    const expired = await c.execute({
      sql: `UPDATE account_host_claim_recovery SET status = 'expired',
          completed_at = ?
        WHERE id = ? AND status = 'pending' AND expires_at <= ?`,
      args: [at, recoveryId, at],
    });
    if (Number(expired.rowsAffected ?? 0) !== 1) continue;
    await insertHostClaimRecoveryAudit(c, {
      id: `${recoveryId}:expired`,
      recoveryId,
      host,
      event: "expired",
      actorDid: null,
      occurredAt: at,
    });
  }
}

async function invalidatePendingHostClaimRecovery(
  c: DbClient,
  host: string,
  at: number,
  actorDid: string | null,
): Promise<void> {
  const result = await c.execute({
    sql: `SELECT id FROM account_host_claim_recovery
      WHERE host = ? AND status = 'pending'`,
    args: [host],
  });
  for (const row of result.rows as Record<string, unknown>[]) {
    const recoveryId = String(row.id ?? "");
    if (!recoveryId) continue;
    const invalidated = await c.execute({
      sql: `UPDATE account_host_claim_recovery SET status = 'invalidated',
          completed_at = ?
        WHERE id = ? AND status = 'pending'`,
      args: [at, recoveryId],
    });
    if (Number(invalidated.rowsAffected ?? 0) !== 1) continue;
    await insertHostClaimRecoveryAudit(c, {
      id: `${recoveryId}:invalidated`,
      recoveryId,
      host,
      event: "invalidated",
      actorDid,
      occurredAt: at,
    });
  }
}

/** Expire old requests and invalidate any request whose snapshotted email
 * owner is no longer the active ownership row. Both transitions release the
 * partial unique index so a fresh DNS proof can start a new recovery. */
async function reconcilePendingHostClaimRecovery(
  c: DbClient,
  host: string,
  at: number,
): Promise<void> {
  await expireStaleHostClaimRecovery(c, host, at);
  const pending = await c.execute({
    sql: `SELECT * FROM account_host_claim_recovery
      WHERE host = ? AND status = 'pending'
      ORDER BY requested_at DESC LIMIT 1`,
    args: [host],
  });
  const row = pending.rows[0] as Record<string, unknown> | undefined;
  if (!row) return;
  const claimResult = await c.execute({
    sql: `SELECT * FROM account_host_claim WHERE host = ? LIMIT 1`,
    args: [host],
  });
  const claimRow = claimResult.rows[0] as Record<string, unknown> | undefined;
  const claim = claimRow ? parseHostClaimRow(claimRow) : null;
  if (
    claim?.method === "pds_contact_email" &&
    claim.claimantDid === String(row.previous_owner_did ?? "") &&
    claim.updatedAt === Number(row.previous_owner_updated_at ?? 0)
  ) return;
  await invalidatePendingHostClaimRecovery(
    c,
    host,
    at,
    claim?.claimantDid ?? null,
  );
}

function isCompletedDnsClaimReplay(
  claim: AccountHostClaim | null,
  verifiedOwnerDid: string | null,
  userDid: string,
): claim is AccountHostClaim {
  return !!claim && claim.method === "dns_txt" &&
    claim.claimantDid === userDid && verifiedOwnerDid === userDid;
}

export const isCompletedDnsClaimReplayForTest = isCompletedDnsClaimReplay;

async function completedDnsClaimReplay(
  host: AccountHost,
  userDid: string,
): Promise<Extract<AccountHostClaimResult, { ok: true }> | null> {
  const claim = await getAccountHostClaim(host.host);
  const ownerDid = claim
    ? await verifiedAccountHostClaimOwnerDid(host.host, claim).catch(() => null)
    : null;
  if (!isCompletedDnsClaimReplay(claim, ownerDid, userDid)) return null;
  return {
    ok: true,
    host: await getAccountHost(host.host) ?? host,
    claim,
  };
}

async function getAccountHostClaimRecoveryByProof(
  host: string,
  tokenHash: string,
): Promise<AccountHostClaimRecovery | null> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `SELECT * FROM account_host_claim_recovery
        WHERE host = ? AND proof_token_hash = ?
        ORDER BY requested_at DESC LIMIT 1`,
      args: [host, tokenHash],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? parseAccountHostClaimRecovery(row) : null;
  });
}

async function completedEmailRecoveryReplay(
  host: AccountHost,
  userDid: string,
  tokenHash: string,
): Promise<AccountHostClaimResult | null> {
  const recovery = await getAccountHostClaimRecoveryByProof(
    host.host,
    tokenHash,
  );
  if (!recovery || recovery.requesterDid !== userDid) return null;
  if (recovery.status === "pending") {
    return {
      ok: false,
      reason: "recovery_pending",
      host,
      claim: await getAccountHostClaim(host.host),
      recovery,
    };
  }
  if (recovery.status !== "completed") return null;
  const claim = await getAccountHostClaim(host.host);
  if (claim?.method !== "dns_txt" || claim.claimantDid !== userDid) {
    return null;
  }
  return {
    ok: true,
    host: await getAccountHost(host.host) ?? host,
    claim,
  };
}

async function beginAccountHostEmailClaimRecoveryWithDns(
  row: AccountHost,
  existingClaim: AccountHostClaim,
  user: { did: string; handle: string },
  token: string,
): Promise<AccountHostClaimResult> {
  const tokenHash = await sha256B64u(token);
  // Reconcile expiry or a current-owner repair before treating a consumed
  // proof as an idempotent pending recovery.
  const active = await getPendingAccountHostClaimRecovery(row.host);
  if (active) {
    return active.requesterDid === user.did
      ? {
        ok: false,
        reason: "recovery_pending",
        host: row,
        claim: existingClaim,
        recovery: active,
      }
      : {
        ok: false,
        reason: "already_claimed",
        host: row,
        claim: existingClaim,
      };
  }
  const proofReplay = await completedEmailRecoveryReplay(
    row,
    user.did,
    tokenHash,
  );
  if (proofReplay) return proofReplay;

  const verified = await prepareHostDnsChallenge(
    { host: row.host },
    user,
    token,
  );
  if (!verified.ok) {
    if (verified.reason === "already_used") {
      const replay = await completedEmailRecoveryReplay(
        row,
        user.did,
        tokenHash,
      );
      if (replay) return replay;
    }
    return {
      ok: false,
      reason: verified.reason,
      host: row,
      claim: existingClaim,
    };
  }

  try {
    const recovery = await withDbTransaction((c) =>
      startEmailClaimRecoveryTransaction(c, {
        tokenHash: verified.tokenHash,
        host: row.host,
        previousClaim: existingClaim,
        requester: user,
        requestedAt: normalizedTimestamp(),
      })
    );
    return {
      ok: false,
      reason: "recovery_pending",
      host: row,
      claim: existingClaim,
      recovery,
    };
  } catch (error) {
    if (error instanceof DnsClaimCompletionError) {
      if (error.reason === "already_used") {
        const replay = await completedEmailRecoveryReplay(
          row,
          user.did,
          tokenHash,
        );
        if (replay) return replay;
      }
      if (error.reason !== "claim_conflict") {
        return {
          ok: false,
          reason: error.reason,
          host: row,
          claim: existingClaim,
        };
      }
    }
    if (error instanceof HostClaimRecoveryCompletionError) {
      if (error.reason === "recovery_changed") {
        const winner = await getPendingAccountHostClaimRecovery(row.host);
        if (winner?.requesterDid === user.did) {
          return {
            ok: false,
            reason: "recovery_pending",
            host: row,
            claim: await getAccountHostClaim(row.host),
            recovery: winner,
          };
        }
      }
      return {
        ok: false,
        reason: "already_claimed",
        host: row,
        claim: await getAccountHostClaim(row.host),
      };
    }
    // A concurrent recovery may win the partial unique index after our
    // read. Its transaction owns the request; ours rolls back the DNS token
    // consumption. Return the winner only to that same requester.
    const concurrent = await getPendingAccountHostClaimRecovery(row.host);
    if (concurrent) {
      if (concurrent.requesterDid === user.did) {
        return {
          ok: false,
          reason: "recovery_pending",
          host: row,
          claim: await getAccountHostClaim(row.host),
          recovery: concurrent,
        };
      }
      return {
        ok: false,
        reason: "already_claimed",
        host: row,
        claim: await getAccountHostClaim(row.host),
      };
    }
    throw error;
  }
}

export async function claimAccountHost(
  host: string,
  user: { did: string; handle: string },
  options: AccountHostClaimOptions = {},
): Promise<AccountHostClaimResult> {
  const row = await getAccountHost(host);
  if (!row) return { ok: false, reason: "host_not_found" };
  if (hostSelfServiceClaimPolicy(row.host) !== "local-dev") {
    return {
      ok: false,
      reason: "dns_required",
      host: row,
    };
  }
  const authority = await resolveAccountHostClaimAuthority(row);
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
  if (!existingClaim) {
    const verifiedMethod = verifyHostClaimDomainProof(row, user);
    if (!verifiedMethod.ok) {
      return {
        ok: false,
        reason: "not_authorized",
        host: row,
        authority,
        claim: existingClaim,
      };
    }
  }
  const ts = now();
  const claim: AccountHostClaim = {
    host: row.host,
    claimantDid: user.did,
    claimantHandle: user.handle,
    method: "local_dev_fixture",
    claimedAt: existingClaim?.claimedAt ?? ts,
    verifiedAt: ts,
    updatedAt: ts,
  };
  let verifiedClaimHandle = user.handle;
  let verifiedClaimDid = user.did;
  if (authority?.did) {
    verifiedClaimHandle = authority.handle;
    verifiedClaimDid = authority.did;
  }
  const saved = await withDbTransaction(async (c) => {
    if (!await upsertAccountHostClaimForOwner(c, claim)) return false;
    const hostWrite = await c.execute(accountHostClaimUpdateQuery({
      host: row.host,
      claimHandle: verifiedClaimHandle,
      claimDid: verifiedClaimDid,
      operatorListingOptIn: options.operatorListingOptIn,
      timestamp: ts,
    }));
    if (Number(hostWrite.rowsAffected ?? 0) !== 1) {
      throw new Error("claimed account host disappeared during registration");
    }
    return true;
  });
  if (!saved) {
    const conflictingClaim = await getAccountHostClaim(row.host);
    return {
      ok: false,
      reason: conflictingClaim?.claimantDid === user.did
        ? "not_authorized"
        : "already_claimed",
      host: row,
      authority,
      claim: conflictingClaim,
    };
  }
  const updatedHost = await getAccountHost(row.host) ?? row;
  return { ok: true, host: updatedHost, claim };
}

/**
 * Claim a host without an additional Atmosphere TXT record when the active
 * AT Protocol identity already proves the exact host domain. The domain's own
 * handle authority and the DID document are resolved live immediately before
 * the ownership transaction and fail closed on any lookup mismatch. The
 * account may legitimately use a different PDS service origin.
 */
export async function claimAccountHostWithAtprotoIdentity(
  host: string,
  user: { did: string; handle: string },
  options: AccountHostClaimOptions = {},
): Promise<AccountHostClaimResult> {
  const row = await getAccountHost(host);
  if (!row) return { ok: false, reason: "host_not_found" };
  const authority = await resolveAccountHostClaimAuthority(row).catch(() =>
    null
  );
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

  const proof = await verifyAtprotoHostClaimDomainProof(row, user);
  if (!proof.ok) {
    return {
      ok: false,
      reason: "dns_required",
      host: row,
      authority,
      claim: existingClaim,
    };
  }

  const ts = now();
  const claim: AccountHostClaim = {
    host: row.host,
    claimantDid: user.did,
    claimantHandle: proof.handle,
    method: "atproto_handle",
    claimedAt: existingClaim?.claimedAt ?? ts,
    verifiedAt: ts,
    updatedAt: ts,
  };
  const saved = await withDbTransaction(async (c) => {
    if (!await upsertAccountHostClaimForOwner(c, claim)) return false;
    const hostWrite = await c.execute(accountHostClaimUpdateQuery({
      host: row.host,
      claimHandle: authority?.did ? authority.handle : proof.handle,
      claimDid: authority?.did ? authority.did : proof.did,
      operatorListingOptIn: options.operatorListingOptIn,
      timestamp: ts,
    }));
    if (Number(hostWrite.rowsAffected ?? 0) !== 1) {
      throw new Error("claimed account host disappeared during registration");
    }
    return true;
  });
  if (!saved) {
    const conflictingClaim = await getAccountHostClaim(row.host);
    return {
      ok: false,
      reason: conflictingClaim?.claimantDid === user.did
        ? "not_authorized"
        : "already_claimed",
      host: row,
      authority,
      claim: conflictingClaim,
    };
  }
  return {
    ok: true,
    host: await getAccountHost(row.host) ?? row,
    claim,
  };
}

/** Establish initial ownership from a freshly prepared, exact-origin PDS
 * contact-email proof. This path is intentionally creation-only. */
export async function claimAccountHostWithContactEmailEvidence(
  host: string,
  user: { did: string; handle: string },
  proofOrToken: PreparedHostContactEmailProof | string,
  options: ContactEmailAccountHostClaimOptions = {},
): Promise<AccountHostClaimResult> {
  const row = await getAccountHost(host);
  if (!row) return { ok: false, reason: "host_not_found" };
  const authority = await resolveAccountHostClaimAuthority(row).catch(() =>
    null
  );
  const existingClaim = await getAccountHostClaim(row.host);
  if (existingClaim) {
    const tokenHash = typeof proofOrToken === "string"
      ? await hashHostContactEmailToken(proofOrToken)
      : proofOrToken.tokenHash;
    const replay = tokenHash
      ? await completedContactEmailClaimReplay(
        row,
        existingClaim,
        user.did,
        tokenHash,
      )
      : null;
    if (replay) return replay;
    return {
      ok: false,
      reason: "already_claimed",
      host: row,
      authority,
      claim: existingClaim,
    };
  }

  const prepared = typeof proofOrToken === "string"
    ? await prepareHostContactEmailChallenge(
      {
        host: row.host,
        displayName: row.displayName,
        serviceEndpoint: row.serviceEndpoint,
      },
      user,
      proofOrToken,
    )
    : proofOrToken;
  if (!prepared.ok) {
    if (
      prepared.reason === "already_used" && typeof proofOrToken === "string"
    ) {
      const tokenHash = await hashHostContactEmailToken(proofOrToken);
      const current = tokenHash ? await getAccountHostClaim(row.host) : null;
      const replay = tokenHash && current
        ? await completedContactEmailClaimReplay(
          row,
          current,
          user.did,
          tokenHash,
        )
        : null;
      if (replay) return replay;
    }
    return {
      ok: false,
      reason: prepared.reason,
      host: row,
      authority,
      claim: null,
    };
  }
  if (
    prepared.host !== row.host || prepared.claimantDid !== user.did ||
    prepared.requestedAt > prepared.expiresAt
  ) {
    return {
      ok: false,
      reason: "invalid",
      host: row,
      authority,
      claim: null,
    };
  }

  const ts = normalizedTimestamp(options.now);
  if (prepared.expiresAt < ts) {
    return {
      ok: false,
      reason: "expired",
      host: row,
      authority,
      claim: null,
    };
  }
  const claim: AccountHostClaim = {
    host: row.host,
    claimantDid: user.did,
    claimantHandle: user.handle,
    method: "pds_contact_email",
    claimedAt: ts,
    verifiedAt: ts,
    updatedAt: ts,
  };
  try {
    await withDbTransaction((c) =>
      writeContactEmailClaimTransaction(c, {
        proof: prepared,
        claim,
        claimHandle: authority?.did ? authority.handle : user.handle,
        claimDid: authority?.did ? authority.did : user.did,
        operatorListingOptIn: options.operatorListingOptIn,
        timestamp: ts,
      })
    );
  } catch (error) {
    if (
      error instanceof ContactEmailClaimCompletionError &&
      error.reason === "already_used"
    ) {
      const current = await getAccountHostClaim(row.host);
      const replay = current
        ? await completedContactEmailClaimReplay(
          row,
          current,
          user.did,
          prepared.tokenHash,
        )
        : null;
      if (replay) return replay;
    }
    if (
      error instanceof ContactEmailClaimCompletionError &&
      error.reason !== "claim_conflict"
    ) {
      return {
        ok: false,
        reason: error.reason,
        host: row,
        authority,
        claim: null,
      };
    }
    if (
      !(error instanceof ContactEmailClaimCompletionError) ||
      error.reason !== "claim_conflict"
    ) throw error;
    const conflictingClaim = await getAccountHostClaim(row.host);
    return {
      ok: false,
      reason: "already_claimed",
      host: row,
      authority,
      claim: conflictingClaim,
    };
  }
  return {
    ok: true,
    host: await getAccountHost(row.host) ?? row,
    claim,
  };
}

async function hasCompletedContactEmailClaimEvidence(
  c: DbClient,
  host: string,
  claimantDid: string,
  tokenHash: string,
  claimUpdatedAt: number,
): Promise<boolean> {
  const evidence = await c.execute({
    sql: `SELECT 1 FROM account_host_claim_evidence
      WHERE host = ? AND claimant_did = ? AND method = 'pds_contact_email'
        AND challenge_token_hash = ? AND claim_updated_at = ?
      LIMIT 1`,
    args: [host, claimantDid, tokenHash, claimUpdatedAt],
  });
  return evidence.rows.length === 1;
}

export const hasCompletedContactEmailClaimEvidenceForTest =
  hasCompletedContactEmailClaimEvidence;

async function completedContactEmailClaimReplay(
  host: AccountHost,
  claim: AccountHostClaim,
  userDid: string,
  tokenHash: string,
): Promise<Extract<AccountHostClaimResult, { ok: true }> | null> {
  if (
    claim.method !== "pds_contact_email" || claim.claimantDid !== userDid
  ) return null;
  const hasEvidence = await withDb((c) =>
    hasCompletedContactEmailClaimEvidence(
      c,
      host.host,
      userDid,
      tokenHash,
      claim.updatedAt,
    )
  );
  if (!hasEvidence) return null;
  return {
    ok: true,
    host: await getAccountHost(host.host) ?? host,
    claim,
  };
}

/** Complete an account-bound DNS TXT challenge atomically with ownership. */
export async function claimAccountHostWithDns(
  host: string,
  user: { did: string; handle: string },
  token: string,
  options: DnsAccountHostClaimOptions = {},
): Promise<AccountHostClaimResult> {
  const row = await getAccountHost(host);
  if (!row) return { ok: false, reason: "host_not_found" };
  const authority = await resolveAccountHostClaimAuthority(row).catch(() =>
    null
  );
  const existingClaim = await getAccountHostClaim(row.host);
  const existingOwnerDid = existingClaim
    ? await verifiedAccountHostClaimOwnerDid(row.host, existingClaim).catch(
      () => null,
    )
    : null;
  const transfer = options.transfer ?? null;
  const transferFromDid = transfer?.intent.previousOwnerDid ?? null;
  // A second transfer POST can arrive after the first request has atomically
  // consumed the account-bound token and installed this DID as the owner. The
  // original transfer intent is stale at that point, so recognize the exact
  // consumed token before applying the previous-owner CAS below.
  if (
    transfer &&
    isCompletedDnsClaimReplay(existingClaim, existingOwnerDid, user.did)
  ) {
    const replay = await inspectHostDnsChallenge(
      { host: row.host },
      user,
      token,
    );
    if (!replay.ok && replay.reason === "already_used") {
      return { ok: true, host: row, claim: existingClaim };
    }
  }
  if (
    transfer &&
    (transfer.intent.host !== row.host ||
      transfer.intent.expiresAt <= now() ||
      transfer.intent.previousOwnerDid === user.did ||
      !existingClaim ||
      existingOwnerDid !== transfer.intent.previousOwnerDid ||
      existingClaim.claimantDid !== transfer.intent.previousOwnerDid ||
      existingClaim.updatedAt !== transfer.intent.previousOwnerUpdatedAt)
  ) {
    return {
      ok: false,
      reason: "not_authorized",
      host: row,
      authority,
      claim: existingClaim,
    };
  }
  if (
    !transfer && existingClaim?.method === "pds_contact_email" &&
    existingClaim.claimantDid !== user.did
  ) {
    return await beginAccountHostEmailClaimRecoveryWithDns(
      row,
      existingClaim,
      user,
      token,
    );
  }
  if (
    existingClaim && existingClaim.claimantDid !== user.did &&
    existingClaim.claimantDid !== transferFromDid
  ) {
    return {
      ok: false,
      reason: "already_claimed",
      host: row,
      authority,
      claim: existingClaim,
    };
  }

  const verified = await prepareHostDnsChallenge(
    { host: row.host },
    user,
    token,
  );
  if (!verified.ok) {
    if (verified.reason === "already_used") {
      const replay = await completedDnsClaimReplay(row, user.did);
      if (replay) return replay;
    }
    return {
      ok: false,
      reason: verified.reason,
      host: row,
      authority,
      claim: existingClaim,
    };
  }

  const observedNow = now();
  const ts = transfer && existingClaim
    ? Math.max(observedNow, existingClaim.updatedAt + 1)
    : observedNow;
  const claim: AccountHostClaim = {
    host: row.host,
    claimantDid: user.did,
    claimantHandle: user.handle,
    method: "dns_txt",
    claimedAt: existingClaim?.claimantDid === user.did
      ? existingClaim.claimedAt
      : ts,
    verifiedAt: ts,
    updatedAt: ts,
  };
  try {
    await withDbTransaction(async (c) => {
      await writeDnsClaimTransaction(c, {
        tokenHash: verified.tokenHash,
        claim,
        claimHandle: authority?.did ? authority.handle : user.handle,
        claimDid: authority?.did ? authority.did : user.did,
        operatorListingOptIn: transfer
          ? undefined
          : options.operatorListingOptIn,
        transfer: transfer ?? undefined,
        timestamp: ts,
      });
    });
  } catch (error) {
    if (
      error instanceof DnsClaimCompletionError &&
      error.reason === "already_used"
    ) {
      const replay = await completedDnsClaimReplay(row, user.did);
      if (replay) return replay;
    }
    if (
      error instanceof DnsClaimCompletionError &&
      error.reason !== "claim_conflict"
    ) {
      return {
        ok: false,
        reason: error.reason,
        host: row,
        authority,
        claim: existingClaim,
      };
    }
    if (
      !(error instanceof DnsClaimCompletionError) ||
      error.reason !== "claim_conflict"
    ) throw error;

    const conflictingClaim = await getAccountHostClaim(row.host);
    return {
      ok: false,
      reason: conflictingClaim?.claimantDid === user.did
        ? "not_authorized"
        : "already_claimed",
      host: row,
      authority,
      claim: conflictingClaim,
    };
  }
  const updatedHost = await getAccountHost(row.host) ?? row;
  return { ok: true, host: updatedHost, claim };
}

type FinalizeEmailRecoveryTransactionResult =
  | {
    ok: true;
    claim: AccountHostClaim;
    recovery: AccountHostClaimRecovery;
  }
  | {
    ok: false;
    reason:
      | "not_found"
      | "not_requester"
      | "not_ready"
      | "expired"
      | "owner_changed"
      | "fresh_dns_required"
      | HostDnsChallengeVerificationFailureReason;
    recovery?: AccountHostClaimRecovery;
  };

type PreparedHostDnsProof = Extract<
  PreparedHostDnsChallengeResult,
  { ok: true }
>;

/** A duplicate finalization can prepare the still-unused proof just before a
 * competing identical transaction commits. Once its guarded consume resumes,
 * the token is already used even though the requested ownership transition
 * succeeded. Re-read the exact durable outcome on the same transaction client
 * so that race is idempotent without accepting a token consumed elsewhere. */
async function completedEmailRecoveryFinalizationTransactionReplay(
  c: DbClient,
  host: string,
  requesterDid: string,
  tokenHash: string,
  recoveryId: string,
): Promise<
  Extract<FinalizeEmailRecoveryTransactionResult, { ok: true }> | null
> {
  const recoveryResult = await c.execute({
    sql: `SELECT * FROM account_host_claim_recovery
      WHERE id = ? AND host = ? AND requester_did = ?
        AND status = 'completed' AND finalization_proof_token_hash = ?
      LIMIT 1`,
    args: [recoveryId, host, requesterDid, tokenHash],
  });
  const recoveryRow = recoveryResult.rows[0] as
    | Record<string, unknown>
    | undefined;
  if (!recoveryRow) return null;
  const claimResult = await c.execute({
    sql: `SELECT * FROM account_host_claim WHERE host = ? LIMIT 1`,
    args: [host],
  });
  const claimRow = claimResult.rows[0] as Record<string, unknown> | undefined;
  const claim = claimRow ? parseHostClaimRow(claimRow) : null;
  if (claim?.method !== "dns_txt" || claim.claimantDid !== requesterDid) {
    return null;
  }
  return {
    ok: true,
    claim,
    recovery: parseAccountHostClaimRecovery(recoveryRow),
  };
}

async function finalizeEmailClaimRecoveryTransaction(
  c: DbClient,
  host: string,
  user: { did: string; handle: string },
  proof: PreparedHostDnsProof,
  at: number,
): Promise<FinalizeEmailRecoveryTransactionResult> {
  const result = await c.execute({
    sql: `SELECT * FROM account_host_claim_recovery
      WHERE host = ? ORDER BY requested_at DESC LIMIT 1`,
    args: [host],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  let recovery = parseAccountHostClaimRecovery(row);
  if (recovery.requesterDid !== user.did) {
    return { ok: false, reason: "not_requester", recovery };
  }

  const currentResult = await c.execute({
    sql: `SELECT * FROM account_host_claim WHERE host = ? LIMIT 1`,
    args: [host],
  });
  const currentRow = currentResult.rows[0] as
    | Record<string, unknown>
    | undefined;
  const current = currentRow ? parseHostClaimRow(currentRow) : null;
  if (recovery.status === "completed") {
    return current?.method === "dns_txt" && current.claimantDid === user.did &&
        String(row.finalization_proof_token_hash ?? "") === proof.tokenHash
      ? { ok: true, claim: current, recovery }
      : { ok: false, reason: "owner_changed", recovery };
  }
  if (recovery.status === "expired") {
    return { ok: false, reason: "expired", recovery };
  }
  if (recovery.status === "invalidated") {
    return { ok: false, reason: "owner_changed", recovery };
  }
  if (recovery.expiresAt <= at) {
    await expireStaleHostClaimRecovery(c, host, at);
    recovery = { ...recovery, status: "expired", completedAt: at };
    return { ok: false, reason: "expired", recovery };
  }
  if (at < recovery.eligibleAt) {
    return { ok: false, reason: "not_ready", recovery };
  }
  if (
    current?.method !== "pds_contact_email" ||
    current.claimantDid !== recovery.currentOwnerDid ||
    current.updatedAt !== Number(row.previous_owner_updated_at ?? 0)
  ) {
    await invalidatePendingHostClaimRecovery(
      c,
      host,
      at,
      current?.claimantDid ?? null,
    );
    recovery = { ...recovery, status: "invalidated", completedAt: at };
    return { ok: false, reason: "owner_changed", recovery };
  }

  // The initiating proof establishes the recovery request, not continuing
  // DNS control. Require a second account-bound challenge issued only after
  // the review period and before this recovery expires. Re-bind its persisted
  // DNS classification inside the ownership transaction before consuming it.
  if (
    proof.host !== host || proof.claimantDid !== user.did ||
    proof.createdAt < recovery.eligibleAt ||
    proof.createdAt > at || proof.createdAt >= recovery.expiresAt ||
    proof.expiresAt < at
  ) {
    return { ok: false, reason: "fresh_dns_required", recovery };
  }
  const boundProof = await c.execute({
    sql: `SELECT 1 FROM account_host_claim_challenge
      WHERE token_hash = ? AND host = ? AND claimant_did = ?
        AND email_fingerprint = ? AND email_fingerprint LIKE 'dns-v1:%'
        AND method_binding IS NULL
        AND created_at = ? AND expires_at = ?
      LIMIT 1`,
    args: [
      proof.tokenHash,
      host,
      user.did,
      proof.methodFingerprint,
      proof.createdAt,
      proof.expiresAt,
    ],
  });
  if (boundProof.rows.length !== 1) {
    return { ok: false, reason: "invalid", recovery };
  }
  const consumed = await consumeHostDnsChallenge(c, {
    tokenHash: proof.tokenHash,
    host,
    claimantDid: user.did,
    consumedAt: at,
  });
  if (!consumed.ok) {
    if (consumed.reason === "already_used") {
      const replay = await completedEmailRecoveryFinalizationTransactionReplay(
        c,
        host,
        user.did,
        proof.tokenHash,
        recovery.id,
      );
      if (replay) return replay;
    }
    return { ok: false, reason: consumed.reason, recovery };
  }

  const effectiveAt = Math.max(at, current.updatedAt + 1);
  const claim: AccountHostClaim = {
    host,
    claimantDid: user.did,
    claimantHandle: user.handle,
    method: "dns_txt",
    claimedAt: effectiveAt,
    verifiedAt: effectiveAt,
    updatedAt: effectiveAt,
  };
  const ownerWrite = await c.execute({
    sql: `UPDATE account_host_claim SET
        claimant_did = ?, claimant_handle = ?, method = 'dns_txt',
        claimed_at = ?, verified_at = ?, updated_at = ?
      WHERE host = ? AND claimant_did = ? AND method = 'pds_contact_email'
        AND updated_at = ?`,
    args: [
      claim.claimantDid,
      claim.claimantHandle,
      claim.claimedAt,
      claim.verifiedAt,
      claim.updatedAt,
      host,
      recovery.currentOwnerDid,
      Number(row.previous_owner_updated_at ?? 0),
    ],
  });
  if (Number(ownerWrite.rowsAffected ?? 0) !== 1) {
    throw new HostClaimRecoveryCompletionError("owner_changed");
  }
  const recoveryWrite = await c.execute({
    sql: `UPDATE account_host_claim_recovery SET
        status = 'completed', finalization_proof_token_hash = ?,
        completed_at = ?
      WHERE id = ? AND host = ? AND requester_did = ? AND status = 'pending'
        AND previous_owner_did = ? AND previous_owner_updated_at = ?`,
    args: [
      proof.tokenHash,
      effectiveAt,
      recovery.id,
      host,
      user.did,
      recovery.currentOwnerDid,
      Number(row.previous_owner_updated_at ?? 0),
    ],
  });
  if (Number(recoveryWrite.rowsAffected ?? 0) !== 1) {
    throw new HostClaimRecoveryCompletionError("recovery_changed");
  }

  const hostWrite = await c.execute(accountHostClaimUpdateQuery({
    host,
    claimHandle: user.handle,
    claimDid: user.did,
    timestamp: effectiveAt,
  }));
  if (Number(hostWrite.rowsAffected ?? 0) !== 1) {
    throw new Error("recovered account host disappeared during finalization");
  }
  await c.execute({
    sql: `UPDATE account_host SET
        profile_handle = ?, profile_did = ?, avatar_url = NULL,
        service_record_uri = NULL, service_record_cid = NULL,
        service_observed_at = NULL, updated_at = ?
      WHERE host = ?`,
    args: [user.handle, user.did, effectiveAt, host],
  });
  await c.execute({
    sql: `UPDATE directory_entity_link SET
        status = 'pending', host_owner_did = ?, host_approved_at = NULL,
        updated_at = ?
      WHERE host = ? AND source = 'claimed'`,
    args: [user.did, effectiveAt, host],
  });
  await insertHostClaimRecoveryAudit(c, {
    id: `${recovery.id}:finalized`,
    recoveryId: recovery.id,
    host,
    event: "finalized",
    actorDid: user.did,
    proofTokenHash: proof.tokenHash,
    occurredAt: effectiveAt,
  });
  return {
    ok: true,
    claim,
    recovery: {
      ...recovery,
      status: "completed",
      completedAt: effectiveAt,
    },
  };
}

export const finalizeEmailClaimRecoveryTransactionForTest =
  finalizeEmailClaimRecoveryTransaction;

/** Finalize a cooled-down DNS recovery. The requester's DID, prior
 * email-derived owner snapshot, and pending row are all compared again in the
 * same transaction, so a current-manager repair or stronger claim always wins
 * a race. */
export async function finalizeAccountHostEmailClaimRecovery(
  host: string,
  user: { did: string; handle: string },
  dnsToken: string,
  options: { now?: number } = {},
): Promise<FinalizeAccountHostEmailClaimRecoveryResult> {
  const normalizedHost = normalizeHandle(host);
  const did = user.did.trim();
  const handle = normalizeHandle(user.handle);
  const tokenHash = await hashHostDnsChallengeToken(dnsToken);
  if (!normalizedHost || !did || !handle || !tokenHash) {
    return { ok: false, reason: "invalid" };
  }
  const at = normalizedTimestamp(options.now);
  const latest = await getLatestAccountHostClaimRecovery(normalizedHost, did);
  if (!latest) {
    return { ok: false, reason: "not_found" };
  }
  if (latest.status === "completed") {
    return await completedEmailRecoveryFinalizationReplay(
      normalizedHost,
      did,
      tokenHash,
      latest,
    ) ?? { ok: false, reason: "owner_changed", recovery: latest };
  }
  if (latest.status === "expired" || latest.expiresAt <= at) {
    // The transaction performs the durable expiry transition. Do not inspect
    // or consume a newly supplied token once the finalize window has closed.
    const afterExpiry = await withDbTransaction(async (c) => {
      await expireStaleHostClaimRecovery(c, normalizedHost, at);
      const result = await c.execute({
        sql: `SELECT * FROM account_host_claim_recovery
          WHERE host = ? AND requester_did = ?
          ORDER BY requested_at DESC LIMIT 1`,
        args: [normalizedHost, did],
      });
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? parseAccountHostClaimRecovery(row) : null;
    });
    if (afterExpiry?.status === "completed") {
      const replay = await completedEmailRecoveryFinalizationReplay(
        normalizedHost,
        did,
        tokenHash,
        afterExpiry,
      );
      if (replay) return replay;
      return { ok: false, reason: "owner_changed", recovery: afterExpiry };
    }
    return {
      ok: false,
      reason: afterExpiry?.status === "invalidated"
        ? "owner_changed"
        : "expired",
      recovery: afterExpiry ?? latest,
    };
  }
  if (latest.status === "invalidated") {
    return { ok: false, reason: "owner_changed", recovery: latest };
  }
  if (at < latest.eligibleAt) {
    return { ok: false, reason: "not_ready", recovery: latest };
  }
  const prepared = await prepareHostDnsChallenge(
    { host: normalizedHost },
    { did, handle },
    dnsToken,
    { now: at },
  );
  if (!prepared.ok) {
    if (prepared.reason === "already_used") {
      const completed = await completedEmailRecoveryFinalizationReplay(
        normalizedHost,
        did,
        tokenHash,
      );
      if (completed) return completed;
    }
    return { ok: false, reason: prepared.reason, recovery: latest };
  }
  // Live DNS I/O can span either the recovery deadline or challenge expiry.
  // The transaction must use a fresh completion time rather than the preflight
  // timestamp so both lifetimes are enforced at the ownership write boundary.
  const completionAt = options.now == null ? normalizedTimestamp() : at;
  let result: FinalizeEmailRecoveryTransactionResult;
  try {
    result = await withDbTransaction((c) =>
      finalizeEmailClaimRecoveryTransaction(
        c,
        normalizedHost,
        { did, handle },
        prepared,
        completionAt,
      )
    );
  } catch (error) {
    if (!(error instanceof HostClaimRecoveryCompletionError)) throw error;
    const recovery = await getLatestAccountHostClaimRecovery(
      normalizedHost,
      did,
    );
    const replay = await completedEmailRecoveryFinalizationReplay(
      normalizedHost,
      did,
      tokenHash,
      recovery ?? undefined,
    );
    if (replay) return replay;
    return {
      ok: false,
      reason: "owner_changed",
      recovery: recovery ?? undefined,
    };
  }
  if (!result.ok) return result;
  const row = await getAccountHost(normalizedHost);
  if (!row) return { ok: false, reason: "not_found" };
  return {
    ok: true,
    host: row,
    claim: result.claim,
    recovery: result.recovery,
  };
}

async function completedEmailRecoveryFinalizationReplay(
  host: string,
  requesterDid: string,
  tokenHash: string,
  recovery?: AccountHostClaimRecovery,
): Promise<
  Extract<FinalizeAccountHostEmailClaimRecoveryResult, { ok: true }> | null
> {
  const latest = recovery ??
    await getLatestAccountHostClaimRecovery(host, requesterDid);
  if (latest?.status !== "completed") return null;
  const evidence = await withDb((c) =>
    c.execute({
      sql: `SELECT 1 FROM account_host_claim_recovery
        WHERE id = ? AND host = ? AND requester_did = ?
          AND status = 'completed' AND finalization_proof_token_hash = ?
        LIMIT 1`,
      args: [latest.id, host, requesterDid, tokenHash],
    })
  );
  if (evidence.rows.length !== 1) return null;
  const claim = await getAccountHostClaim(host);
  const row = await getAccountHost(host);
  if (
    !row || claim?.method !== "dns_txt" || claim.claimantDid !== requesterDid
  ) {
    return null;
  }
  return { ok: true, host: row, claim, recovery: latest };
}

async function getLatestAccountHostClaimRecovery(
  host: string,
  requesterDid?: string,
): Promise<AccountHostClaimRecovery | null> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `SELECT * FROM account_host_claim_recovery WHERE host = ?
        ${requesterDid ? "AND requester_did = ?" : ""}
        ORDER BY requested_at DESC LIMIT 1`,
      args: requesterDid ? [host, requesterDid] : [host],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? parseAccountHostClaimRecovery(row) : null;
  });
}

function opaqueNotificationValue(
  value: string | null | undefined,
  options: { fingerprint?: boolean } = {},
): string | null {
  const normalized = value?.trim() ?? "";
  if (
    !normalized || normalized.length > 512 ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return null;
  }
  if (
    options.fingerprint &&
    (!/^[A-Za-z0-9._-]+$/.test(normalized) || normalized.includes("@"))
  ) {
    return null;
  }
  return normalized;
}

const ACCOUNT_HOST_RECOVERY_NOTIFICATION_LEASE_MS = 5 * 60 * 1000;

async function reserveHostClaimRecoveryNotificationTransaction(
  c: DbClient,
  host: string,
  requesterDid: string,
  at: number,
  retryAfterMs: number,
): Promise<AccountHostClaimRecoveryNotificationReservation | null> {
  await reconcilePendingHostClaimRecovery(c, host, at);
  const staleBefore = Math.max(0, at - retryAfterMs);
  const reserved = await c.execute({
    sql: `UPDATE account_host_claim_recovery SET notification_attempted_at = ?
      WHERE host = ? AND requester_did = ? AND status = 'pending'
        AND notification_status IN ('pending', 'failed')
        AND (notification_attempted_at IS NULL OR notification_attempted_at <= ?)`,
    args: [at, host, requesterDid, staleBefore],
  });
  if (Number(reserved.rowsAffected ?? 0) !== 1) return null;
  const result = await c.execute({
    sql: `SELECT * FROM account_host_claim_recovery
      WHERE host = ? AND requester_did = ? AND status = 'pending'
      ORDER BY requested_at DESC LIMIT 1`,
    args: [host, requesterDid],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const recovery = parseAccountHostClaimRecovery(row);
  const evidence = await c.execute({
    sql: `SELECT email_fingerprint FROM account_host_claim_evidence
      WHERE host = ? AND claimant_did = ? AND method = 'pds_contact_email'
        AND claim_updated_at = ?
      ORDER BY completed_at DESC LIMIT 1`,
    args: [
      host,
      String(row.previous_owner_did ?? ""),
      Number(row.previous_owner_updated_at ?? 0),
    ],
  });
  const fingerprint = evidence.rows[0]?.email_fingerprint;
  return {
    recovery,
    expectedEmailFingerprint: typeof fingerprint === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(fingerprint)
      ? fingerprint
      : null,
  };
}

export const reserveHostClaimRecoveryNotificationTransactionForTest =
  reserveHostClaimRecoveryNotificationTransaction;

/** Acquire the crash-retry lease before sending a recovery warning. Only one
 * concurrent request can move notification_attempted_at, so only that caller
 * may contact the current PDS mailbox. */
export async function reserveAccountHostClaimRecoveryNotification(
  host: string,
  requesterDid: string,
  options: AccountHostClaimRecoveryNotificationReservationOptions = {},
): Promise<AccountHostClaimRecoveryNotificationReservation | null> {
  const normalizedHost = normalizeHandle(host);
  const normalizedDid = requesterDid.trim();
  if (!normalizedHost || !normalizedDid) return null;
  const retryAfterMs = options.retryAfterMs != null &&
      Number.isFinite(options.retryAfterMs)
    ? Math.max(1, Math.floor(options.retryAfterMs))
    : ACCOUNT_HOST_RECOVERY_NOTIFICATION_LEASE_MS;
  return await withDbTransaction((c) =>
    reserveHostClaimRecoveryNotificationTransaction(
      c,
      normalizedHost,
      normalizedDid,
      normalizedTimestamp(options.now),
      retryAfterMs,
    )
  );
}

/** Persist notification outcome separately from DNS proof. Delivery failure is
 * intentionally non-authoritative and cannot roll back or cancel recovery. */
async function recordHostClaimRecoveryNotificationTransaction(
  c: DbClient,
  normalizedHost: string,
  requesterDid: string,
  input:
    & Required<
      Pick<AccountHostClaimRecoveryNotificationInput, "status" | "attemptedAt">
    >
    & {
      deliveryId: string | null;
      emailFingerprint: string | null;
    },
): Promise<AccountHostClaimRecovery | null> {
  await reconcilePendingHostClaimRecovery(c, normalizedHost, input.attemptedAt);
  const found = await c.execute({
    sql: `SELECT * FROM account_host_claim_recovery
      WHERE host = ? AND requester_did = ? AND status = 'pending'
      ORDER BY requested_at DESC LIMIT 1`,
    args: [normalizedHost, requesterDid],
  });
  const row = found.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const current = parseAccountHostClaimRecovery(row);
  if (current.notificationAttemptedAt !== input.attemptedAt) return current;
  // A delivered notification is terminal. A transient failure may later be
  // upgraded to sent; unavailable is terminal. Repeated results are
  // idempotent.
  if (
    current.notificationStatus === "sent" ||
    current.notificationStatus === input.status
  ) return current;
  const write = await c.execute({
    sql: `UPDATE account_host_claim_recovery SET
        notification_status = ?, notification_delivery_id = ?,
        notification_email_fingerprint = ?, notification_attempted_at = ?
      WHERE id = ? AND host = ? AND requester_did = ? AND status = 'pending'
        AND notification_status <> 'sent' AND notification_attempted_at = ?`,
    args: [
      input.status,
      input.deliveryId,
      input.emailFingerprint,
      input.attemptedAt,
      current.id,
      normalizedHost,
      requesterDid,
      input.attemptedAt,
    ],
  });
  if (Number(write.rowsAffected ?? 0) !== 1) {
    const latest = await c.execute({
      sql: `SELECT * FROM account_host_claim_recovery WHERE id = ? LIMIT 1`,
      args: [current.id],
    });
    const latestRow = latest.rows[0] as Record<string, unknown> | undefined;
    return latestRow ? parseAccountHostClaimRecovery(latestRow) : null;
  }
  await insertHostClaimRecoveryAudit(c, {
    id: `${current.id}:notification:${input.status}`,
    recoveryId: current.id,
    host: normalizedHost,
    event: `notification_${input.status}`,
    actorDid: requesterDid,
    deliveryId: input.deliveryId,
    emailFingerprint: input.emailFingerprint,
    occurredAt: input.attemptedAt,
  });
  return {
    ...current,
    notificationStatus: input.status,
    notificationAttemptedAt: input.attemptedAt,
  };
}

export const recordHostClaimRecoveryNotificationTransactionForTest =
  recordHostClaimRecoveryNotificationTransaction;

export async function recordAccountHostClaimRecoveryNotification(
  host: string,
  requestedByDid: string,
  input: AccountHostClaimRecoveryNotificationInput,
): Promise<AccountHostClaimRecovery | null> {
  const normalizedHost = normalizeHandle(host);
  const requesterDid = requestedByDid.trim();
  if (!normalizedHost || !requesterDid) return null;
  const attemptedAt = normalizedTimestamp(input.attemptedAt);
  const deliveryId = opaqueNotificationValue(input.deliveryId);
  const emailFingerprint = opaqueNotificationValue(input.emailFingerprint, {
    fingerprint: true,
  });
  return await withDbTransaction((c) =>
    recordHostClaimRecoveryNotificationTransaction(
      c,
      normalizedHost,
      requesterDid,
      {
        status: input.status,
        attemptedAt,
        deliveryId,
        emailFingerprint,
      },
    )
  );
}

export function validateAccountHostRegistrationInput(
  input: AccountHostRegistrationInput,
  user: { did: string; handle: string },
): AccountHostRegistrationFieldValidationResult {
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
    ? normalizeAccountHostPublicHttpsUrl(input.homepageUrl)
    : null;
  if (input.homepageUrl?.trim() && !homepageUrl) {
    return {
      ok: false,
      reason: "invalid_homepage_url",
      message: "Use an HTTPS URL for the host website.",
    };
  }

  const signupUrl = input.signupUrl?.trim()
    ? normalizeAccountHostPublicHttpsUrl(input.signupUrl)
    : null;
  if (input.signupUrl?.trim() && !signupUrl) {
    return {
      ok: false,
      reason: "invalid_signup_url",
      message: "Use an HTTPS URL for the host signup flow.",
    };
  }

  const serviceEndpoint = input.serviceEndpoint?.trim()
    ? normalizeAccountHostPublicServiceEndpoint(input.serviceEndpoint)
    : null;
  if (!serviceEndpoint) {
    return {
      ok: false,
      reason: "invalid_service_endpoint",
      message: "Enter the HTTPS origin for the host PDS service endpoint.",
    };
  }

  const accountManagementUrl = input.accountManagementUrl?.trim()
    ? normalizeAccountHostPublicHttpsUrl(input.accountManagementUrl)
    : null;
  if (input.accountManagementUrl?.trim() && !accountManagementUrl) {
    return {
      ok: false,
      reason: "invalid_account_management_url",
      message: "Use an HTTPS URL for the host account management page.",
    };
  }

  const supportUrl = input.supportUrl?.trim()
    ? normalizeAccountHostPublicHttpsUrl(input.supportUrl)
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
      message:
        "Use Login with Atmosphere with the host account you want attached to this listing.",
    };
  }

  const inferredLocationCheckedAt = input.inferredLocationCheckedAt &&
      Number.isFinite(input.inferredLocationCheckedAt)
    ? Math.max(0, Math.floor(input.inferredLocationCheckedAt))
    : null;

  return {
    ok: true,
    input: {
      host,
      displayName,
      description: (input.description ?? "").trim().slice(0, 600),
      dataLocation: normalizeDataLocation(input.dataLocation),
      inferredLocation: normalizeDataLocation(input.inferredLocation),
      inferredLocationSource: textOrNull(input.inferredLocationSource)
        ?.slice(0, 120) ?? null,
      inferredLocationCheckedAt,
      inferredLocationEvidenceJson:
        textOrNull(input.inferredLocationEvidenceJson)?.slice(0, 4000) ?? null,
      homepageUrl,
      signupUrl,
      serviceEndpoint,
      accountManagementUrl,
      supportUrl,
      avatarUrl: normalizePublicImageUrl(input.avatarUrl),
      signupStatus: normalizeSignupStatus(input.signupStatus),
      profileHandle,
      bskyProfileVisible: input.bskyProfileVisible !== false,
    },
  };
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
  if (hostSelfServiceClaimPolicy(host) !== "local-dev") {
    return {
      ok: false,
      reason: "dns_required",
      message:
        "Production host registration starts from a detected PDS. Find the PDS by its exact server domain and verify control with its DNS TXT challenge.",
      host: await getAccountHost(host).catch(() => null),
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
    ? normalizeAccountHostPublicHttpsUrl(input.homepageUrl)
    : null;
  if (input.homepageUrl?.trim() && !homepageUrl) {
    return {
      ok: false,
      reason: "invalid_homepage_url",
      message: "Use an HTTPS URL for the host website.",
    };
  }
  const signupUrl = input.signupUrl?.trim()
    ? normalizeAccountHostPublicHttpsUrl(input.signupUrl)
    : null;
  if (input.signupUrl?.trim() && !signupUrl) {
    return {
      ok: false,
      reason: "invalid_signup_url",
      message: "Use an HTTPS URL for the host signup flow.",
    };
  }
  const serviceEndpoint = input.serviceEndpoint?.trim()
    ? normalizeAccountHostPublicServiceEndpoint(input.serviceEndpoint)
    : null;
  if (!serviceEndpoint) {
    return {
      ok: false,
      reason: "invalid_service_endpoint",
      message: "Enter the HTTPS origin for the host PDS service endpoint.",
    };
  }
  const accountManagementUrl = input.accountManagementUrl?.trim()
    ? normalizeAccountHostPublicHttpsUrl(input.accountManagementUrl)
    : null;
  if (input.accountManagementUrl?.trim() && !accountManagementUrl) {
    return {
      ok: false,
      reason: "invalid_account_management_url",
      message: "Use an HTTPS URL for the host account management page.",
    };
  }
  const supportUrl = input.supportUrl?.trim()
    ? normalizeAccountHostPublicHttpsUrl(input.supportUrl)
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
      message:
        "Use Login with Atmosphere with the host account you want attached to this listing.",
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
    ? await getAccountHostClaim(existing.host)
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
  const authority = existing
    ? await resolveAccountHostClaimAuthority(existing).catch(() => null)
    : null;
  if (existing) {
    if (
      authority && !accountHostClaimAuthorityMatchesUser(authority, user)
    ) {
      return {
        ok: false,
        reason: "not_authorized",
        message: authority
          ? `This host is tied to @${authority.handle}. Use that account in Login with Atmosphere to claim it.`
          : "This curated host's operator identity could not be verified. Try again later.",
        host: existing,
      };
    }
  }

  const proofHost = {
    host,
    source: existing?.source ?? "manual",
    claimHandle: existing?.claimHandle ?? null,
    profileHandle: existing?.profileHandle ?? profileHandle,
    serviceRecordUri: input.serviceRecordUri ?? existing?.serviceRecordUri ??
      null,
    serviceRecordCid: input.serviceRecordCid ?? existing?.serviceRecordCid ??
      null,
  };
  const domainProof = verifyHostClaimDomainProof(proofHost, user);
  if (!domainProof.ok) {
    return {
      ok: false,
      reason: "not_authorized",
      message: hostClaimProofMessage(),
      host: existing,
    };
  }
  const ts = now();
  const claim: AccountHostClaim = {
    host,
    claimantDid: user.did,
    claimantHandle: user.handle,
    method: "local_dev_fixture",
    claimedAt: existingClaim?.claimedAt ?? ts,
    verifiedAt: ts,
    updatedAt: ts,
  };
  const saved = await withDbTransaction(async (c) => {
    if (
      !await establishAccountHostRegistrationOwnership(c, {
        host,
        displayName,
        timestamp: ts,
        claim,
      })
    ) return false;

    const hostWrite = await c.execute({
      sql: `INSERT INTO account_host (
          host, display_name, description, data_location,
          inferred_location, inferred_location_source,
          inferred_location_checked_at, inferred_location_evidence_json,
          homepage_url, signup_url,
          service_endpoint, account_management_url,
          profile_handle, profile_did, bsky_profile_visible, avatar_url, claim_handle, claim_did,
          support_url, service_record_uri, service_record_cid, service_observed_at,
          signup_status, verification_status, source, match_patterns,
          last_checked_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'observed', 'manual', ?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET
          display_name = excluded.display_name,
          description = excluded.description,
          data_location = COALESCE(excluded.data_location, account_host.data_location),
          inferred_location = COALESCE(excluded.inferred_location, account_host.inferred_location),
          inferred_location_source = COALESCE(excluded.inferred_location_source, account_host.inferred_location_source),
          inferred_location_checked_at = COALESCE(excluded.inferred_location_checked_at, account_host.inferred_location_checked_at),
          inferred_location_evidence_json = COALESCE(excluded.inferred_location_evidence_json, account_host.inferred_location_evidence_json),
          homepage_url = COALESCE(excluded.homepage_url, account_host.homepage_url),
          signup_url = COALESCE(excluded.signup_url, account_host.signup_url),
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
          claim_handle = CASE
            WHEN account_host.source = 'seeded' THEN account_host.claim_handle
            ELSE excluded.claim_handle
          END,
          claim_did = CASE
            WHEN account_host.source = 'seeded' THEN account_host.claim_did
            ELSE excluded.claim_did
          END,
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
        signupUrl,
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
    if (Number(hostWrite.rowsAffected ?? 0) !== 1) {
      throw new Error("registered account host could not be saved");
    }
    const ownershipWrite = await c.execute(accountHostClaimUpdateQuery({
      host,
      claimHandle: authority?.did ? authority.handle : profileHandle,
      claimDid: authority?.did ? authority.did : user.did,
      operatorListingOptIn: true,
      timestamp: ts,
    }));
    if (Number(ownershipWrite.rowsAffected ?? 0) !== 1) {
      throw new Error("registered account host disappeared during claim");
    }
    return true;
  });

  if (!saved) {
    const conflictingClaim = await getAccountHostClaim(host);
    return {
      ok: false,
      reason: conflictingClaim?.claimantDid !== user.did
        ? "already_claimed"
        : "not_authorized",
      message: conflictingClaim?.claimantDid !== user.did
        ? "This host is already claimed by another account, so no listing changes were saved."
        : "The signed-in account could not claim this host, so no listing changes were saved.",
      host: await getAccountHost(host),
      claim: conflictingClaim,
    };
  }
  const [registeredHost, registeredClaim] = await Promise.all([
    getAccountHost(host),
    getAccountHostClaim(host),
  ]);
  if (!registeredHost || !registeredClaim) {
    throw new Error("registered account host could not be read back");
  }
  return { ok: true, host: registeredHost, claim: registeredClaim };
}

export async function updateAccountHostProfileSettings(
  host: string,
  input: AccountHostProfileSettingsInput,
  claimantDid: string,
): Promise<AccountHostProfileSettingsResult> {
  const normalized = host.trim().toLowerCase();
  const did = claimantDid.trim();
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80) {
    return {
      ok: false,
      reason: "invalid_display_name",
      message: "Enter a host name under 80 characters.",
    };
  }

  const homepageUrl = input.homepageUrl?.trim()
    ? normalizeAccountHostPublicHttpsUrl(input.homepageUrl)
    : null;
  if (input.homepageUrl?.trim() && !homepageUrl) {
    return {
      ok: false,
      reason: "invalid_homepage_url",
      message: "Use an HTTPS URL for the host website.",
    };
  }

  const signupUrl = input.signupUrl?.trim()
    ? normalizeAccountHostPublicHttpsUrl(input.signupUrl)
    : null;
  if (input.signupUrl?.trim() && !signupUrl) {
    return {
      ok: false,
      reason: "invalid_signup_url",
      message: "Use an HTTPS URL for the host signup flow.",
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

  const [existing, claim] = await Promise.all([
    getAccountHost(normalized),
    getAccountHostClaim(normalized),
  ]);
  const ownerDid = existing
    ? await verifiedAccountHostOwnerDid(existing, claim).catch(() => null)
    : null;
  if (!existing || !did || ownerDid !== did) {
    return {
      ok: false,
      reason: "not_authorized",
      message: "Only the currently verified host owner can update this host.",
    };
  }
  const existingProfileHandle = normalizeHandle(existing?.profileHandle);
  const nextProfileHandle = normalizeHandle(profileHandle);
  const profileChanged = existingProfileHandle !== nextProfileHandle;
  const ts = now();
  const saved = await withDb(async (c) => {
    await ensureSeededHosts(c);
    const result = await c.execute({
      sql: `UPDATE account_host
        SET display_name = ?,
            description = ?,
            data_location = ?,
            homepage_url = ?,
            signup_url = ?,
            signup_status = ?,
            profile_handle = ?,
            bsky_profile_visible = ?,
            profile_did = CASE WHEN ? = 1 THEN NULL ELSE profile_did END,
            avatar_url = CASE
              WHEN ? = 1 THEN ?
              WHEN ? = 1 THEN NULL
              ELSE avatar_url
            END,
            profile_checked_at = CASE WHEN ? = 1 THEN NULL ELSE profile_checked_at END,
            updated_at = ?
        WHERE host = ?
          AND EXISTS (
            SELECT 1 FROM account_host_claim
            WHERE account_host_claim.host = account_host.host
              AND account_host_claim.claimant_did = ?
          )`,
      args: [
        displayName,
        (input.description ?? "").trim().slice(0, 600),
        normalizeDataLocation(input.dataLocation),
        homepageUrl,
        signupUrl,
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
        did,
      ],
    });
    return Number(result.rowsAffected ?? 0) === 1;
  });

  if (!saved) {
    return {
      ok: false,
      reason: "not_authorized",
      message: "Host ownership changed before these updates could be saved.",
    };
  }

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
  claimantDid: string,
): Promise<AccountHost | null> {
  const normalized = host.trim().toLowerCase();
  const did = claimantDid.trim();
  if (!normalized || !did) return null;
  const [existing, claim] = await Promise.all([
    getAccountHost(normalized),
    getAccountHostClaim(normalized),
  ]);
  if (
    !existing ||
    await verifiedAccountHostOwnerDid(existing, claim).catch(() => null) !== did
  ) return null;
  const saved = await withDb(async (c) => {
    await ensureSeededHosts(c);
    const result = await c.execute(accountHostDashboardSettingsUpdateQuery(
      normalized,
      input,
      now(),
      did,
    ));
    return Number(result.rowsAffected ?? 0) === 1;
  });
  return saved ? await getAccountHost(normalized) : null;
}

function accountHostDashboardSettingsUpdateQuery(
  host: string,
  input: AccountHostDashboardSettingsInput,
  timestamp: number,
  claimantDid: string,
): { sql: string; args: DbValue[] } {
  return {
    sql: `UPDATE account_host
      SET service_endpoint = ?,
          account_management_url = ?,
          dashboard_url = ?,
          capability_manifest_url = ?,
          capabilities_json = ?,
          support_url = ?,
          service_record_uri = COALESCE(?, service_record_uri),
          service_record_cid = COALESCE(?, service_record_cid),
          service_observed_at = CASE WHEN ? = 1 THEN ? ELSE service_observed_at END,
          updated_at = ?
      WHERE host = ?
        AND EXISTS (
          SELECT 1 FROM account_host_claim
          WHERE account_host_claim.host = account_host.host
            AND account_host_claim.claimant_did = ?
        )`,
    args: [
      input.serviceEndpoint ?? null,
      input.accountManagementUrl ?? null,
      input.dashboardUrl ?? null,
      input.capabilityManifestUrl ?? null,
      input.capabilitiesJson ?? null,
      input.supportUrl ?? null,
      input.serviceRecordUri ?? null,
      input.serviceRecordCid ?? null,
      input.serviceRecordUri == null ? 0 : 1,
      timestamp,
      timestamp,
      host,
      claimantDid,
    ],
  };
}

export const accountHostDashboardSettingsUpdateQueryForTest =
  accountHostDashboardSettingsUpdateQuery;

/**
 * Change public-directory visibility only when the signed-in DID owns the
 * verified claim. The relay's inferred classification remains untouched.
 */
export async function updateAccountHostDirectoryListing(
  host: string,
  claimantDid: string,
  listed: boolean,
): Promise<AccountHost | null> {
  const normalized = host.trim().toLowerCase();
  const did = claimantDid.trim();
  if (!normalized || !did) return null;
  const [existing, claim] = await Promise.all([
    getAccountHost(normalized),
    getAccountHostClaim(normalized),
  ]);
  if (
    !existing ||
    await verifiedAccountHostOwnerDid(existing, claim).catch(() => null) !== did
  ) return null;
  const ts = now();
  const updated = await withDb(async (c) => {
    await ensureSeededHosts(c);
    const result = await c.execute({
      sql: `UPDATE account_host
        SET operator_listing_opt_in = ?,
            operator_listing_opted_at = ?,
            updated_at = ?
        WHERE host = ?
          AND EXISTS (
            SELECT 1 FROM account_host_claim
            WHERE account_host_claim.host = account_host.host
              AND account_host_claim.claimant_did = ?
          )`,
      args: [listed ? 1 : 0, ts, ts, normalized, did],
    });
    return Number(result.rowsAffected ?? 0) === 1;
  });
  return updated ? await getAccountHost(normalized) : null;
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

export function lookupAccountHostHint(
  pdsUrl: string | null | undefined,
): AccountHostLookup | null {
  const host = endpointHost(pdsUrl);
  if (!host) return null;
  const seed = seedForEndpoint(pdsUrl);
  if (seed) {
    return {
      host: seed.host,
      displayName: seed.displayName,
      endpoint: pdsUrl ?? host,
      verificationStatus: seed.verificationStatus,
    };
  }
  return {
    host,
    displayName: host,
    endpoint: pdsUrl ?? host,
    verificationStatus: "observed",
  };
}

export async function lookupAccountHost(
  pdsUrl: string | null | undefined,
): Promise<AccountHostLookup | null> {
  const host = endpointHost(pdsUrl);
  if (!host) return null;
  const seed = seedForEndpoint(pdsUrl);
  if (seed) {
    return {
      host: seed.host,
      displayName: seed.displayName,
      endpoint: pdsUrl ?? host,
      verificationStatus: seed.verificationStatus,
    };
  }
  return await withDb(async (c) => {
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
      const serviceEndpoint =
        normalizeAccountHostPublicServiceEndpoint(pdsUrl) ??
          seed.serviceEndpoint ?? null;
      const accountManagementUrl = seed.accountManagementUrl ?? null;
      if (accountManagementUrl) {
        await c.execute({
          sql: `UPDATE account_host
            SET service_endpoint = COALESCE(service_endpoint, ?),
                account_management_url = ?,
                service_observed_at = COALESCE(service_observed_at, ?),
                last_observed_at = ?,
                updated_at = ?
            WHERE host = ?`,
          args: [
            serviceEndpoint,
            accountManagementUrl,
            serviceEndpoint ? ts : null,
            ts,
            ts,
            seed.host,
          ],
        });
      } else {
        await c.execute({
          sql: `UPDATE account_host
            SET service_endpoint = COALESCE(service_endpoint, ?),
                service_observed_at = COALESCE(service_observed_at, ?),
                last_observed_at = ?,
                updated_at = ?
            WHERE host = ?`,
          args: [
            serviceEndpoint,
            serviceEndpoint ? ts : null,
            ts,
            ts,
            seed.host,
          ],
        });
      }
      return;
    }
    const origin = normalizeEndpoint(pdsUrl)?.origin ?? `https://${host}`;
    const serviceEndpoint = normalizeAccountHostPublicServiceEndpoint(origin);
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
        null,
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
  opts: AccountHostDirectoryOptions = {},
): Promise<AccountHost[]> {
  const result = await listAccountHostDirectory({
    ...opts,
    page: 1,
    pageSize: positiveInteger(
      opts.pageSize,
      MAX_PUBLIC_HOSTS,
      MAX_PUBLIC_HOSTS,
    ),
  });
  return result.hosts;
}

export async function listAccountHostDirectory(
  opts: AccountHostDirectoryOptions = {},
): Promise<AccountHostDirectoryResult> {
  return await withDb(async (c) => {
    const filters: string[] = [];
    const args: DbValue[] = [];
    const query = opts.query?.trim();
    if (query) {
      filters.push(
        `(lower(account_host.display_name) LIKE ? OR lower(account_host.host) LIKE ? OR lower(account_host.description) LIKE ? OR lower(COALESCE(account_host.profile_handle, '')) LIKE ? OR lower(COALESCE(account_host.data_location, '')) LIKE ? OR lower(COALESCE(account_host.inferred_location, '')) LIKE ?)`,
      );
      const like = `%${query.toLowerCase()}%`;
      args.push(like, like, like, like, like, like);
    }
    if (opts.verificationStatus && opts.verificationStatus !== "all") {
      filters.push(`account_host.verification_status = ?`);
      args.push(opts.verificationStatus);
    }
    const signupStatuses = [...new Set(opts.signupStatuses ?? [])].filter(
      (status): status is HostSignupStatus =>
        status === "open" || status === "invite_required" ||
        status === "closed" || status === "unknown",
    );
    if (signupStatuses.length > 0) {
      filters.push(
        `account_host.signup_status IN (${
          signupStatuses.map(() => "?").join(", ")
        })`,
      );
      args.push(...signupStatuses);
    } else if (opts.signupStatus && opts.signupStatus !== "all") {
      filters.push(`account_host.signup_status = ?`);
      args.push(opts.signupStatus);
    }
    if (opts.hasSignupUrl) {
      filters.push(`COALESCE(account_host.signup_url, '') <> ''`);
    }
    if (opts.trustedOnly) {
      filters.push(
        `(account_host.verification_status IN ('verified', 'claimed') OR account_host.source = 'seeded')`,
      );
    }
    if (opts.publicOnly) {
      const publicNow = Number.isFinite(opts.now)
        ? Math.floor(opts.now!)
        : now();
      filters.push(publicAccountHostVisibilitySql());
      args.push(
        publicNow - PUBLIC_ACCOUNT_HOST_ACTIVITY_MAX_AGE_MS,
        publicNow,
        publicNow - PUBLIC_ACCOUNT_HOST_CLAIM_GRACE_MS,
        publicNow - PUBLIC_ACCOUNT_HOST_INTENT_MAX_AGE_MS,
      );
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await c.execute({
      sql: `SELECT COUNT(*) AS total FROM account_host ${where}`,
      args,
    });
    const total = Number(
      (countResult.rows[0] as Record<string, unknown> | undefined)?.total ?? 0,
    );
    const pageSize = positiveInteger(opts.pageSize, 24, MAX_PUBLIC_HOSTS);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(
      pageCount,
      positiveInteger(opts.page, 1),
    );
    const sort = opts.sort ?? DEFAULT_ACCOUNT_HOST_SORT;
    const r = await c.execute({
      sql: `SELECT account_host.*,
          host_conformance.status AS conformance_status,
          host_conformance.checked_at AS conformance_checked_at,
          host_conformance.expires_at AS conformance_expires_at
        FROM account_host
        LEFT JOIN host_conformance ON host_conformance.host = account_host.host
        ${where}
        ORDER BY ${accountHostOrder(sort)}
        LIMIT ? OFFSET ?`,
      args: [...args, pageSize, (page - 1) * pageSize],
    });
    return {
      hosts: r.rows.map((row) => parseHostRow(row as Record<string, unknown>)),
      total,
      page,
      pageSize,
      sort,
    };
  });
}

function accountHostOrder(sort: AccountHostSort): string {
  const stable = `CASE account_host.verification_status
      WHEN 'verified' THEN 0
      WHEN 'claimed' THEN 1
      ELSE 2
    END,
    CASE account_host.signup_status
      WHEN 'open' THEN 0
      WHEN 'invite_required' THEN 1
      WHEN 'closed' THEN 2
      ELSE 3
    END,
    lower(account_host.display_name) ASC,
    account_host.host ASC`;
  if (sort === "name") {
    return `lower(account_host.display_name) ASC, account_host.host ASC`;
  }
  if (sort === "recent") {
    return `COALESCE(account_host.last_observed_at, account_host.last_checked_at, account_host.updated_at) DESC,
      ${stable}`;
  }
  if (sort === DEFAULT_ACCOUNT_HOST_SORT) {
    return `account_host.observed_account_count DESC,
      CASE
        WHEN account_host.verification_status IN ('verified', 'claimed') THEN 0
        ELSE 1
      END,
      lower(account_host.display_name) ASC,
      account_host.host ASC`;
  }
  return `account_host.observed_account_count DESC,
    account_host.observed_active_account_count DESC,
    ${stable}`;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isFinite(value) || value == null) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

export function sortAccountHostsForDirectory(
  hosts: AccountHost[],
  sort: AccountHostSort,
): AccountHost[] {
  return [...hosts].sort((a, b) => {
    if (sort === DEFAULT_ACCOUNT_HOST_SORT) {
      const recommended = b.observedAccountCount - a.observedAccountCount ||
        claimedHostRank(a) - claimedHostRank(b) ||
        a.displayName.localeCompare(b.displayName) ||
        a.host.localeCompare(b.host);
      if (recommended) return recommended;
    } else if (sort === "accounts") {
      const count = b.observedAccountCount - a.observedAccountCount ||
        b.observedActiveAccountCount - a.observedActiveAccountCount;
      if (count) return count;
    } else if (sort === "recent") {
      const recent = accountHostRecentAt(b) - accountHostRecentAt(a);
      if (recent) return recent;
    } else {
      return a.displayName.localeCompare(b.displayName) ||
        a.host.localeCompare(b.host);
    }
    return verificationRank(a.verificationStatus) -
        verificationRank(b.verificationStatus) ||
      signupRank(a.signupStatus) - signupRank(b.signupStatus) ||
      a.displayName.localeCompare(b.displayName) ||
      a.host.localeCompare(b.host);
  });
}

export function isAccountHostPubliclyListable(
  host: AccountHost,
  at = now(),
): boolean {
  if (host.operatorListingOptIn === false) return false;
  // Host records are self-asserted metadata. Until the operator claims the
  // host, they must not establish domain authority or directory visibility.
  const hasPublicIntent = host.verificationStatus === "claimed" ||
    host.verificationStatus === "verified" || host.source === "seeded" ||
    normalizeAccountHostPublicHttpsUrl(host.signupUrl) !== null ||
    hasFreshDetectedPublicIntent(host, at);
  if (!hasPublicIntent) return false;

  return accountHostAvailability(host, at) !== "unavailable";
}

export function hasFreshDetectedPublicIntent(
  host: Pick<
    AccountHost,
    "publicIntentStatus" | "publicIntentCheckedAt"
  >,
  at = now(),
): boolean {
  return host.publicIntentStatus === "detected" &&
    host.publicIntentCheckedAt != null &&
    host.publicIntentCheckedAt >= at - PUBLIC_ACCOUNT_HOST_INTENT_MAX_AGE_MS;
}

export function accountHostAvailability(
  host: Pick<
    AccountHost,
    | "lastIndexedAccountAt"
    | "observedActiveAccountCount"
    | "conformanceStatus"
    | "conformanceExpiresAt"
    | "verificationStatus"
    | "lastActiveAt"
  >,
  at = now(),
): AccountHostAvailability {
  const inventoryIsFresh = host.lastIndexedAccountAt != null &&
    host.lastIndexedAccountAt >= at - PUBLIC_ACCOUNT_HOST_ACTIVITY_MAX_AGE_MS;
  const relayActive = inventoryIsFresh && host.observedActiveAccountCount > 0;
  if (relayActive) return "relay_active";
  const directlyReachable = host.conformanceStatus === "passed" &&
    host.conformanceExpiresAt != null && host.conformanceExpiresAt > at;
  if (directlyReachable) return "reachable";
  const claimedGrace = (host.verificationStatus === "claimed" ||
    host.verificationStatus === "verified") &&
    host.lastActiveAt != null &&
    host.lastActiveAt >= at - PUBLIC_ACCOUNT_HOST_CLAIM_GRACE_MS;
  return claimedGrace ? "grace" : "unavailable";
}

function publicAccountHostVisibilitySql(): string {
  // Deliberately keep service_record_uri out of this projection: the record is
  // useful profile data, but is not proof that its author controls the host.
  return `(
    COALESCE(account_host.operator_listing_opt_in, 1) <> 0
    AND
    (
      (
        account_host.observed_active_account_count > 0
        AND account_host.last_indexed_account_at >= ?
      )
      OR EXISTS (
        SELECT 1 FROM host_conformance public_conformance
        WHERE public_conformance.host = account_host.host
          AND public_conformance.status = 'passed'
          AND public_conformance.expires_at > ?
      )
      OR (
        account_host.verification_status IN ('verified', 'claimed')
        AND account_host.last_active_at >= ?
      )
    )
    AND (
      account_host.verification_status IN ('verified', 'claimed')
      OR account_host.source = 'seeded'
      OR lower(COALESCE(account_host.signup_url, '')) LIKE 'https://%'
      OR (
        account_host.public_intent_status = 'detected'
        AND account_host.public_intent_checked_at >= ?
      )
    )
  )`;
}

function listingFlag(value: boolean | undefined): number | null {
  return value == null ? null : value ? 1 : 0;
}

function claimedHostRank(host: AccountHost): number {
  return host.verificationStatus === "observed" ? 1 : 0;
}

function accountHostRecentAt(host: AccountHost): number {
  return host.lastObservedAt ?? host.lastCheckedAt ?? host.updatedAt;
}

export async function getAccountHost(
  host: string,
): Promise<AccountHost | null> {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return null;
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `SELECT account_host.*,
          host_conformance.status AS conformance_status,
          host_conformance.checked_at AS conformance_checked_at,
          host_conformance.expires_at AS conformance_expires_at
        FROM account_host
        LEFT JOIN host_conformance ON host_conformance.host = account_host.host
        WHERE account_host.host = ? LIMIT 1`,
      args: [normalized],
    });
    if (r.rows.length === 0) return null;
    return parseHostRow(r.rows[0] as Record<string, unknown>);
  });
}

export function hydrateAccountHostProfiles(
  hosts: AccountHost[],
): Promise<AccountHost[]> {
  // Request-time host reads are intentionally read-only. External profile
  // refreshes are performed by maintainAccountHostDirectory so a slow social
  // API cannot add latency or database writes to public list/detail GETs.
  return Promise.resolve(hosts);
}

async function refreshAccountHostProfiles(
  hosts: AccountHost[],
  signal?: AbortSignal,
): Promise<{ hosts: AccountHost[]; attempted: number; updated: number }> {
  signal?.throwIfAborted();
  const { ts, results } = await fetchHostProfileRefreshes(hosts, signal);
  if (results.length === 0) return { hosts, attempted: 0, updated: 0 };
  signal?.throwIfAborted();
  const refreshed = await withDb(async (c) => {
    return await persistHostProfileRefreshes(c, ts, results);
  });
  return {
    hosts: hosts.map((host) => ({
      ...host,
      ...(refreshed.get(host.host) ?? {}),
    })),
    attempted: results.length,
    updated: refreshed.size,
  };
}

export async function warmAccountHostProfiles(
  hosts: AccountHost[],
): Promise<void> {
  await refreshAccountHostProfiles(hosts);
}

export interface AccountHostDirectoryMaintenanceResult {
  seededHosts: number;
  profilesConsidered: number;
  profilesAttempted: number;
  profilesUpdated: number;
}

/** Apply curated seed additions/upgrades outside request handling. Safe to
 * call from every release because syncSeededHosts preserves claimed fields. */
export async function syncSeededAccountHosts(): Promise<number> {
  await withDb(async (c) => {
    await ensureSeededHosts(c, { force: true });
  });
  return SEEDED_HOSTS.length;
}

/**
 * Explicit release/background maintenance for curated seed upgrades and slow
 * external profile hydration. This deliberately stays outside public GETs.
 */
export async function maintainAccountHostDirectory(
  options: { signal?: AbortSignal } = {},
): Promise<
  AccountHostDirectoryMaintenanceResult
> {
  const signal = options.signal;
  signal?.throwIfAborted();
  const seededHosts = await syncSeededAccountHosts();
  signal?.throwIfAborted();
  const hosts = await withDb(async (c) => {
    const result = await c.execute({
      sql: `SELECT * FROM account_host
        ORDER BY CASE WHEN profile_checked_at IS NULL THEN 0 ELSE 1 END,
          profile_checked_at ASC, host ASC
        LIMIT ?`,
      args: [MAX_PUBLIC_HOSTS],
    });
    return result.rows.map((row) =>
      parseHostRow(row as Record<string, unknown>)
    );
  });
  signal?.throwIfAborted();
  const refreshed = await refreshAccountHostProfiles(hosts, signal);
  return {
    seededHosts,
    profilesConsidered: hosts.length,
    profilesAttempted: refreshed.attempted,
    profilesUpdated: refreshed.updated,
  };
}
