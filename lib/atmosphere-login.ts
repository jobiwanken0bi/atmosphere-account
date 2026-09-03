import { type DbClient, isPostgresBackend, withDb } from "./db.ts";
import {
  b64uDecode,
  loadClientPrivateKey,
  parseJwkEnv,
  randomB64u,
  signEs256,
} from "./jose.ts";
import {
  type AtmosphereSelectionClaims,
  type AtmosphereSelectionReplayStore,
  type AtmosphereSelectionVerificationResult,
  verifyAtmosphereSelectionToken,
} from "./atmosphere-login-sdk.ts";
import {
  clientId as atmosphereClientId,
  IS_DEV,
  OAUTH_KID,
  OAUTH_PRIVATE_JWK,
  OAUTH_PUBLIC_JWK,
  siteOrigin,
} from "./env.ts";
import { isTrustedAtmosphereOrigin } from "./atmosphere-origins.ts";
import {
  isPrivateNetworkHostname,
  readResponseTextWithLimit,
} from "./security.ts";
import {
  type AccountHost,
  type AccountHostClaim,
  getAccountHost,
  getAccountHostClaim,
  listClaimedAccountHostsForOwner,
  verifiedAccountHostOwnerDid,
} from "./account-hosts.ts";
import {
  type AppListing,
  type AppListingLoginAvailability,
  getAppListingLoginAvailability,
  listManagedAppListingsByAccountDid,
} from "./app-directory.ts";
import { listVerifiedDirectoryEntityLinksForApp } from "./directory-entity-links.ts";

const SELECTION_TOKEN_TTL_SEC = 2 * 60;
const MAX_STATE_LEN = 500;
const MAX_SCOPE_LEN = 1000;
const MAX_URL_LEN = 2048;
const MAX_ALLOWED_RETURN_URIS = 20;
const MAX_REVIEW_NOTES_LEN = 2000;
export const LOGIN_APP_CLIENT_ID_CONFLICT_MESSAGE =
  "This client ID is already registered to another app account.";
export const LOGIN_APP_STALE_ENVIRONMENT_MESSAGE =
  "This login environment changed in another tab. Reload before saving.";
export const ATMOSPHERE_LOGIN_MANIFEST_VERSION = "atmosphere.login.v0.1";
const ATMOSPHERE_LOGIN_MANIFEST_PATH = "/.well-known/atmosphere-login.json";
const ATMOSPHERE_LOGIN_MANIFEST_TIMEOUT_MS = 3_000;
const MAX_ATMOSPHERE_LOGIN_MANIFEST_BYTES = 64_000;
const EXAMPLE_LOGIN_CLIENT_METADATA_PATH =
  "/examples/atmosphere-login/client-metadata.json";
const EXAMPLE_APP_ICON_PATH = "/app-icon.svg";

export interface LoginRequest {
  clientId: string;
  returnUri: string;
  state: string;
  scope: string | null;
}

export interface LoginApp {
  clientId: string;
  /** Live identity derived from the linked app profile. */
  appName: string;
  appUri: string | null;
  logoUri: string | null;
  appDid: string | null;
  appProfileUri: string | null;
  appProfileSlug: string | null;
  linkStatus: LoginAppLinkStatus;
  identityAvailable: boolean;
  /** Safety state for picker/handoff; owner management stays available. */
  loginAvailability: AppListingLoginAvailability | "unlinked";
  allowedReturnUris: string[];
  allowedOrigins: string[];
  status: "trusted" | "unverified" | "development" | "blocked";
  reviewStatus: LoginAppReviewStatus;
  reviewRequestedAt: number | null;
  reviewNotes: string | null;
  reviewDecisionAt: number | null;
  reviewDecisionBy: string | null;
  reviewDecisionReason: string | null;
  /** Opaque version binding an admin decision to the reviewed configuration. */
  reviewRevision: string | null;
  /** Opaque version used to compare-and-swap owner environment edits. */
  environmentRevision: string | null;
  contactDid: string | null;
  preferredAccountHost: string | null;
  registered: boolean;
}

export type LoginAppLinkStatus =
  | "linked"
  | "relink_required"
  | "system_fixture";

export interface LoginAppProfileIdentity {
  did: string;
  listingId: string;
  profileUri: string;
  slug: string;
  name: string;
  homepage: string | null;
  logoUri: string | null;
  /** Indexed app-profile version used for atomic trust checks. */
  updatedAt: number;
  loginAvailability: AppListingLoginAvailability;
  /** Internal version used to invalidate stale trust after profile updates. */
  identityFingerprint: string;
}

export type LoginAppReviewStatus =
  | "none"
  | "requested"
  | "approved"
  | "rejected";

export interface LoginAppIdentityCheck {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  body: string;
  href?: string | null;
  hrefLabel?: string | null;
}

export type LoginAppReadinessState =
  | "development"
  | "needs_fixes"
  | "ready"
  | "trusted"
  | "unavailable"
  | "blocked";

export interface LoginAppReadiness {
  state: LoginAppReadinessState;
  label: string;
  tone: "pass" | "warn" | "fail";
  body: string;
}

export type LoginSelectionPayload = AtmosphereSelectionClaims;

export interface LoginConnection {
  clientId: string;
  appName: string;
  appUri: string | null;
  logoUri: string | null;
  status: LoginApp["status"];
  handle: string;
  selectedCount: number;
  firstSelectedAt: number;
  lastSelectedAt: number;
}

export interface LoginAppRegistrationInput {
  clientId: string;
  allowedReturnUris: string[];
  preferredAccountHost?: string | null;
  expectedEnvironmentRevision?: string | null;
}

export class LoginRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LoginRequestError";
    this.status = status;
  }
}

function jsonArray(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function readStatus(value: unknown): LoginApp["status"] {
  return value === "trusted" || value === "development" ||
      value === "blocked" || value === "unverified"
    ? value
    : "unverified";
}

function readReviewStatus(value: unknown): LoginAppReviewStatus {
  return value === "requested" || value === "approved" ||
      value === "rejected" || value === "none"
    ? value
    : "none";
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    const normalized = Number(value);
    return Number.isSafeInteger(normalized) ? normalized : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    const normalized = Number(trimmed);
    return Number.isSafeInteger(normalized) ? normalized : null;
  }
  return null;
}

function readLinkStatus(value: unknown): LoginAppLinkStatus {
  return value === "linked" || value === "system_fixture" ||
      value === "relink_required"
    ? value
    : "relink_required";
}

function isExampleLoginClientId(clientId: string): boolean {
  try {
    return new URL(clientId).pathname === EXAMPLE_LOGIN_CLIENT_METADATA_PATH;
  } catch {
    return false;
  }
}

function exampleLoginAppLogoUri(
  clientId: string,
  appUri?: string | null,
): string | null {
  if (!isExampleLoginClientId(clientId)) return null;
  try {
    return new URL(
      EXAMPLE_APP_ICON_PATH,
      new URL(appUri || clientId).origin,
    ).toString();
  } catch {
    return null;
  }
}

function rowToLoginApp(
  row: Record<string, unknown>,
  profile: LoginAppProfileIdentity | null = null,
): LoginApp {
  const clientId = String(row.client_id);
  const linkStatus = readLinkStatus(row.link_status);
  const usesStoredFixtureIdentity = linkStatus === "system_fixture";
  const identityAvailable = !!profile || usesStoredFixtureIdentity;
  const snapshotAppUri = typeof row.app_uri === "string" ? row.app_uri : null;
  const appUri = profile?.homepage ??
    (usesStoredFixtureIdentity ? snapshotAppUri : null);
  const snapshotLogoUri = typeof row.logo_uri === "string"
    ? row.logo_uri
    : null;
  return {
    clientId,
    appName: profile?.name ??
      (usesStoredFixtureIdentity
        ? String(row.app_name)
        : "Unlinked login configuration"),
    appUri,
    logoUri: profile?.logoUri ??
      (usesStoredFixtureIdentity
        ? exampleLoginAppLogoUri(clientId, appUri) ?? snapshotLogoUri
        : null),
    appDid: typeof row.app_did === "string" ? row.app_did : null,
    appProfileUri: typeof row.app_profile_uri === "string"
      ? row.app_profile_uri
      : null,
    appProfileSlug: profile?.slug ?? null,
    linkStatus,
    identityAvailable,
    loginAvailability: profile?.loginAvailability ??
      (usesStoredFixtureIdentity ? "available" : "unlinked"),
    allowedReturnUris: jsonArray(row.allowed_return_uris),
    allowedOrigins: jsonArray(row.allowed_origins),
    status: readStatus(row.status),
    reviewStatus: readReviewStatus(row.review_status),
    reviewRequestedAt: nullableNumber(row.review_requested_at),
    reviewNotes: typeof row.review_notes === "string" ? row.review_notes : null,
    reviewDecisionAt: nullableNumber(row.review_decision_at),
    reviewDecisionBy: typeof row.review_decision_by === "string"
      ? row.review_decision_by
      : null,
    reviewDecisionReason: typeof row.review_decision_reason === "string"
      ? row.review_decision_reason
      : null,
    reviewRevision: typeof row.review_revision === "string"
      ? row.review_revision
      : null,
    environmentRevision: typeof row.environment_revision === "string"
      ? row.environment_revision
      : null,
    contactDid: typeof row.contact_did === "string" ? row.contact_did : null,
    preferredAccountHost: typeof row.preferred_account_host === "string"
      ? row.preferred_account_host
      : null,
    registered: true,
  };
}

function withExampleLoginAppLogo(app: LoginApp): LoginApp {
  if (app.registered && app.linkStatus !== "system_fixture") return app;
  const logoUri = exampleLoginAppLogoUri(app.clientId, app.appUri);
  return logoUri && app.logoUri !== logoUri ? { ...app, logoUri } : app;
}

function parseAbsoluteUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LoginRequestError(`${label} must be an absolute URL`);
  }
  if (url.username || url.password) {
    throw new LoginRequestError(`${label} must not contain credentials`);
  }
  url.hash = "";
  return url;
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" ||
    host === "[::1]";
}

function assertSafeWebUrl(url: URL, label: string): void {
  if (isPrivateNetworkHostname(url.hostname)) {
    if (
      IS_DEV && url.protocol === "http:" && isLoopbackHostname(url.hostname)
    ) {
      return;
    }
    throw new LoginRequestError(
      `${label} must use a public HTTPS host`,
    );
  }
  if (url.protocol === "https:") return;
  if (IS_DEV && url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
    return;
  }
  throw new LoginRequestError(`${label} must use HTTPS`);
}

function normalizeHref(url: URL): string {
  url.hash = "";
  return url.toString();
}

function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname &&
    a.port === b.port;
}

function loopbackDevClientAllowsReturn(
  client: URL,
  returnUri: URL,
  dev = IS_DEV,
): boolean {
  if (
    !dev || client.protocol !== "http:" || returnUri.protocol !== "http:" ||
    !isLoopbackHostname(client.hostname) ||
    !isLoopbackHostname(returnUri.hostname)
  ) {
    return false;
  }
  if (sameOrigin(client, returnUri)) return true;
  if (!isAtprotoLocalhostClientId(client)) return false;
  return declaredLocalhostRedirectUris(client).some((declared) =>
    loopbackRedirectUriMatches(declared, returnUri)
  );
}

function isAtprotoLocalhostClientId(client: URL): boolean {
  return client.protocol === "http:" &&
    client.hostname.toLowerCase() === "localhost" &&
    !client.port &&
    (client.pathname === "" || client.pathname === "/");
}

function declaredLocalhostRedirectUris(client: URL): URL[] {
  const declared = client.searchParams.getAll("redirect_uri");
  const values = declared.length > 0
    ? declared
    : ["http://127.0.0.1/", "http://[::1]/"];
  const urls: URL[] = [];
  for (const value of values) {
    try {
      const url = new URL(value);
      if (
        url.protocol === "http:" && !url.username && !url.password &&
        isLoopbackHostname(url.hostname)
      ) {
        urls.push(url);
      }
    } catch {
      // Invalid localhost metadata entries are ignored.
    }
  }
  return urls;
}

function loopbackRedirectUriMatches(declared: URL, actual: URL): boolean {
  return declared.protocol === actual.protocol &&
    declared.hostname === actual.hostname &&
    declared.pathname === actual.pathname &&
    declared.search === actual.search;
}

export function isUnregisteredDevLoginReturnAllowed(
  clientId: string,
  returnUri: string,
  options: { dev?: boolean } = {},
): boolean {
  try {
    return loopbackDevClientAllowsReturn(
      parseAbsoluteUrl(clientId, "client_id"),
      parseAbsoluteUrl(returnUri, "return_uri"),
      options.dev ?? IS_DEV,
    );
  } catch {
    return false;
  }
}

function appFromClientId(clientId: string): LoginApp {
  const client = parseAbsoluteUrl(clientId, "client_id");
  assertSafeWebUrl(client, "client_id");
  const isDev = client.protocol === "http:" &&
    isLoopbackHostname(client.hostname);
  const isReferenceApp = isExampleLoginClientId(clientId);
  return {
    clientId,
    appName: isReferenceApp
      ? "Login with Atmosphere reference app"
      : isDev
      ? "Development app"
      : client.hostname,
    appUri: isReferenceApp
      ? new URL("/examples/atmosphere-login/app", client.origin).toString()
      : client.origin,
    logoUri: exampleLoginAppLogoUri(clientId, client.origin),
    appDid: null,
    appProfileUri: null,
    appProfileSlug: null,
    linkStatus: "system_fixture",
    identityAvailable: true,
    loginAvailability: "available",
    allowedReturnUris: [],
    allowedOrigins: [],
    status: isDev ? "development" : "unverified",
    reviewStatus: "none",
    reviewRequestedAt: null,
    reviewNotes: null,
    reviewDecisionAt: null,
    reviewDecisionBy: null,
    reviewDecisionReason: null,
    reviewRevision: null,
    environmentRevision: null,
    contactDid: null,
    preferredAccountHost: null,
    registered: false,
  };
}

export function readLoginRequest(url: URL): LoginRequest {
  const clientId = singleLoginRequestValue(url, "client_id")?.trim();
  const returnUriValue = singleLoginRequestValue(url, "return_uri");
  const redirectUriValue = singleLoginRequestValue(url, "redirect_uri");
  if (returnUriValue !== null && redirectUriValue !== null) {
    throw new LoginRequestError("use only one return URI parameter");
  }
  const returnUri = (returnUriValue ?? redirectUriValue)?.trim();
  const state = singleLoginRequestValue(url, "state")?.trim();
  const scope = singleLoginRequestValue(url, "scope")?.trim() || null;
  if (!clientId) throw new LoginRequestError("missing client_id");
  if (!returnUri) throw new LoginRequestError("missing return_uri");
  if (!state) throw new LoginRequestError("missing state");
  if (clientId.length > MAX_URL_LEN) {
    throw new LoginRequestError("client_id is too long");
  }
  if (returnUri.length > MAX_URL_LEN) {
    throw new LoginRequestError("return_uri is too long");
  }
  if (state.length > MAX_STATE_LEN) {
    throw new LoginRequestError("state is too long");
  }
  if (scope && scope.length > MAX_SCOPE_LEN) {
    throw new LoginRequestError("scope is too long");
  }
  return { clientId, returnUri, state, scope };
}

function singleLoginRequestValue(url: URL, key: string): string | null {
  const values = url.searchParams.getAll(key);
  if (values.length > 1) {
    throw new LoginRequestError(`duplicate ${key}`);
  }
  return values[0] ?? null;
}

export function loginRequestToPath(req: LoginRequest): string {
  const params = new URLSearchParams({
    client_id: req.clientId,
    return_uri: req.returnUri,
    state: req.state,
  });
  if (req.scope) params.set("scope", req.scope);
  return `/login/select?${params.toString()}`;
}

function derivedProfileUrl(
  value: string | null | undefined,
  allowRelative = false,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = allowRelative ? new URL(raw, siteOrigin()) : new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return normalizeHref(url);
  } catch {
    return null;
  }
}

export function loginAppProfileIdentityFromListing(
  ownerDid: string,
  listing: Pick<
    AppListing,
    | "id"
    | "canonicalUri"
    | "slug"
    | "name"
    | "primaryUrl"
    | "iconUrl"
    | "updatedAt"
  >,
  loginAvailability: AppListingLoginAvailability = "available",
): LoginAppProfileIdentity {
  const homepage = derivedProfileUrl(listing.primaryUrl);
  const logoUri = derivedProfileUrl(listing.iconUrl, true);
  return {
    did: ownerDid.trim(),
    listingId: listing.id,
    profileUri: listing.canonicalUri,
    slug: listing.slug,
    name: listing.name.trim(),
    homepage,
    logoUri,
    updatedAt: listing.updatedAt,
    loginAvailability,
    // App-profile image URLs can be stable proxy URLs while their underlying
    // blob changes. Including the indexed profile version makes that change
    // invalidate picker trust as well as direct name/homepage URL edits.
    identityFingerprint: JSON.stringify([
      listing.name.trim(),
      homepage,
      logoUri,
      listing.updatedAt,
    ]),
  };
}

export async function getLoginAppProfileForOwner(
  ownerDid: string,
): Promise<LoginAppProfileIdentity | null> {
  const owner = ownerDid.trim();
  if (!owner.startsWith("did:")) return null;
  const listings = await listManagedAppListingsByAccountDid(owner, {
    syncLegacy: false,
  });
  if (listings.length === 0) return null;
  if (listings.length !== 1) {
    throw new LoginRequestError(
      "This account controls more than one legacy app profile. Resolve the duplicate profiles before using Login with Atmosphere.",
      409,
    );
  }
  const availability = await getAppListingLoginAvailability(listings[0].id);
  return loginAppProfileIdentityFromListing(owner, listings[0], availability);
}

export async function requireLoginAppProfileForOwner(
  ownerDid: string,
): Promise<LoginAppProfileIdentity> {
  const profile = await getLoginAppProfileForOwner(ownerDid);
  if (!profile) {
    throw new LoginRequestError(
      "Create an app profile with this account before adding Login with Atmosphere.",
      403,
    );
  }
  return profile;
}

async function getLinkedLoginAppProfile(
  appDid: string | null,
  profileUri: string | null,
): Promise<LoginAppProfileIdentity | null> {
  const did = appDid?.trim() ?? "";
  const uri = profileUri?.trim() ?? "";
  if (!did.startsWith("did:") || !uri) return null;
  const listings = await listManagedAppListingsByAccountDid(did, {
    syncLegacy: false,
  });
  const matches = listings.filter((listing) => listing.canonicalUri === uri);
  if (matches.length !== 1) return null;
  const availability = await getAppListingLoginAvailability(matches[0].id);
  return loginAppProfileIdentityFromListing(did, matches[0], availability);
}

function sameOptionalIdentityUrl(
  left: unknown,
  right: string | null,
): boolean {
  const stored = typeof left === "string" ? left : null;
  if (!stored || !right) return stored === right;
  return sameNormalizedUrl(stored, right);
}

export function loginAppProfileIdentityChanged(
  snapshot: {
    appName: string;
    appUri: string | null;
    logoUri: string | null;
    identityFingerprint: string | null;
  },
  profile: LoginAppProfileIdentity,
): boolean {
  if (snapshot.appName !== profile.name) return true;
  if (!sameOptionalIdentityUrl(snapshot.appUri, profile.homepage)) return true;
  if (!sameOptionalIdentityUrl(snapshot.logoUri, profile.logoUri)) return true;
  // A null fingerprint is a pre-migration snapshot. Preserve its existing
  // review only when all three historical identity fields still match.
  return snapshot.identityFingerprint !== null &&
    snapshot.identityFingerprint !== profile.identityFingerprint;
}

function rowIdentityChanged(
  row: Record<string, unknown>,
  profile: LoginAppProfileIdentity,
): boolean {
  return loginAppProfileIdentityChanged({
    appName: String(row.app_name),
    appUri: typeof row.app_uri === "string" ? row.app_uri : null,
    logoUri: typeof row.logo_uri === "string" ? row.logo_uri : null,
    identityFingerprint: typeof row.profile_identity_fingerprint === "string"
      ? row.profile_identity_fingerprint
      : null,
  }, profile);
}

export function loginAppStatusAfterProfileIdentityChange(
  currentStatus: LoginApp["status"],
  clientId: string,
  allowedReturnUris: string[],
): LoginApp["status"] {
  return currentStatus === "blocked"
    ? "blocked"
    : defaultRegistrationStatus(clientId, allowedReturnUris);
}

async function bindLoginAppRowToProfile(
  row: Record<string, unknown>,
  profile: LoginAppProfileIdentity,
): Promise<Record<string, unknown>> {
  return await withDb((c) =>
    syncLoginAppProfileIdentityWithClient(c, row, profile)
  );
}

export async function syncLoginAppProfileIdentityWithClient(
  c: DbClient,
  row: Record<string, unknown>,
  profile: LoginAppProfileIdentity,
  now = Date.now(),
): Promise<Record<string, unknown>> {
  const identityChanged = rowIdentityChanged(row, profile);
  const profileChanged = row.app_did !== profile.did ||
    row.app_profile_uri !== profile.profileUri;
  const linkageChanged = profileChanged || row.contact_did !== profile.did ||
    readLinkStatus(row.link_status) !== "linked";
  const fingerprintChanged = row.profile_identity_fingerprint !==
    profile.identityFingerprint;
  const profileVersionChanged = nullableNumber(
    row.profile_identity_updated_at,
  ) !== profile.updatedAt;
  const reviewRevisionMissing = typeof row.review_revision !== "string" ||
    !row.review_revision;
  const environmentRevisionMissing =
    typeof row.environment_revision !== "string" || !row.environment_revision;
  if (
    !identityChanged && !linkageChanged && !fingerprintChanged &&
    !profileVersionChanged && !reviewRevisionMissing &&
    !environmentRevisionMissing
  ) return row;
  const resetTrust = identityChanged || profileChanged;
  const nextReviewRevision = randomB64u(18);
  const ownerEnvironmentChanged = identityChanged || linkageChanged ||
    fingerprintChanged || profileVersionChanged;
  const nextEnvironmentRevision = ownerEnvironmentChanged ||
      environmentRevisionMissing
    ? randomB64u(18)
    : String(row.environment_revision);
  const currentStatus = readStatus(row.status);
  const nextStatus = resetTrust
    ? loginAppStatusAfterProfileIdentityChange(
      currentStatus,
      String(row.client_id),
      jsonArray(row.allowed_return_uris),
    )
    : currentStatus;
  const changed = await c.execute({
    sql: `
        UPDATE login_app
        SET app_name = ?,
            app_uri = ?,
            logo_uri = ?,
            contact_did = ?,
            app_did = ?,
            app_profile_uri = ?,
            link_status = 'linked',
            profile_identity_fingerprint = ?,
            profile_identity_updated_at = ?,
            review_revision = ?,
            environment_revision = ?,
            status = CASE
              WHEN status = 'blocked' THEN 'blocked'
              WHEN ? THEN ?
              ELSE status
            END,
            review_status = CASE
              WHEN ? AND status <> 'blocked' THEN 'none'
              ELSE review_status
            END,
            review_requested_at = CASE
              WHEN ? AND status <> 'blocked' THEN NULL
              ELSE review_requested_at
            END,
            review_notes = CASE
              WHEN ? AND status <> 'blocked' THEN NULL
              ELSE review_notes
            END,
            review_decision_at = CASE
              WHEN ? AND status <> 'blocked' THEN NULL
              ELSE review_decision_at
            END,
            review_decision_by = CASE
              WHEN ? AND status <> 'blocked' THEN NULL
              ELSE review_decision_by
            END,
            review_decision_reason = CASE
              WHEN ? AND status <> 'blocked' THEN NULL
              ELSE review_decision_reason
            END,
            updated_at = ?
        WHERE client_id = ?
          AND app_name = ?
          AND COALESCE(app_uri, '') = COALESCE(?, '')
          AND COALESCE(logo_uri, '') = COALESCE(?, '')
          AND allowed_return_uris = ?
          AND allowed_origins = ?
          AND COALESCE(contact_did, '') = COALESCE(?, '')
          AND COALESCE(app_did, '') = COALESCE(?, '')
          AND COALESCE(app_profile_uri, '') = COALESCE(?, '')
          AND link_status = ?
          AND COALESCE(profile_identity_fingerprint, '') = COALESCE(?, '')
          AND COALESCE(
            profile_identity_updated_at,
            CAST(-1 AS BIGINT)
          ) = COALESCE(?, CAST(-1 AS BIGINT))
          AND COALESCE(review_revision, '') = COALESCE(?, '')
          AND COALESCE(environment_revision, '') = COALESCE(?, '')
      `,
    args: [
      profile.name,
      profile.homepage,
      profile.logoUri,
      profile.did,
      profile.did,
      profile.profileUri,
      profile.identityFingerprint,
      profile.updatedAt,
      nextReviewRevision,
      nextEnvironmentRevision,
      resetTrust ? 1 : 0,
      nextStatus,
      resetTrust ? 1 : 0,
      resetTrust ? 1 : 0,
      resetTrust ? 1 : 0,
      resetTrust ? 1 : 0,
      resetTrust ? 1 : 0,
      resetTrust ? 1 : 0,
      now,
      String(row.client_id),
      String(row.app_name),
      typeof row.app_uri === "string" ? row.app_uri : null,
      typeof row.logo_uri === "string" ? row.logo_uri : null,
      typeof row.allowed_return_uris === "string"
        ? row.allowed_return_uris
        : "[]",
      typeof row.allowed_origins === "string" ? row.allowed_origins : "[]",
      typeof row.contact_did === "string" ? row.contact_did : null,
      typeof row.app_did === "string" ? row.app_did : null,
      typeof row.app_profile_uri === "string" ? row.app_profile_uri : null,
      readLinkStatus(row.link_status),
      typeof row.profile_identity_fingerprint === "string"
        ? row.profile_identity_fingerprint
        : null,
      nullableNumber(row.profile_identity_updated_at),
      typeof row.review_revision === "string" ? row.review_revision : null,
      typeof row.environment_revision === "string"
        ? row.environment_revision
        : null,
    ],
  });
  const selected = await c.execute({
    sql: `SELECT * FROM login_app WHERE client_id = ?`,
    args: [String(row.client_id)],
  });
  const updated = selected.rows[0] as Record<string, unknown> | undefined;
  if (!updated) {
    throw new LoginRequestError("Login environment no longer exists", 404);
  }
  const stillBoundToProfile = updated.app_did === profile.did &&
    updated.app_profile_uri === profile.profileUri &&
    readLinkStatus(updated.link_status) === "linked" &&
    !rowIdentityChanged(updated, profile) &&
    updated.profile_identity_fingerprint === profile.identityFingerprint &&
    nullableNumber(updated.profile_identity_updated_at) === profile.updatedAt &&
    typeof updated.review_revision === "string" && !!updated.review_revision &&
    typeof updated.environment_revision === "string" &&
    !!updated.environment_revision;
  if (Number(changed.rowsAffected ?? 0) !== 1 && !stillBoundToProfile) {
    throw new LoginRequestError(
      "Login environment ownership changed while its app profile was being refreshed.",
      409,
    );
  }
  if (!stillBoundToProfile) {
    throw new LoginRequestError(
      "Login environment could not be linked to its current app profile.",
      409,
    );
  }
  return updated;
}

async function hydrateLoginAppRow(
  input: Record<string, unknown>,
  knownOwnerProfile?: LoginAppProfileIdentity,
): Promise<LoginApp> {
  const linkStatus = readLinkStatus(input.link_status);
  if (linkStatus === "system_fixture") return rowToLoginApp(input);

  const rowAppDid = typeof input.app_did === "string" ? input.app_did : null;
  const rowProfileUri = typeof input.app_profile_uri === "string"
    ? input.app_profile_uri
    : null;
  let profile = linkStatus === "linked"
    ? knownOwnerProfile
      ? rowAppDid === knownOwnerProfile.did ? knownOwnerProfile : null
      : await getLinkedLoginAppProfile(rowAppDid, rowProfileUri)
    : null;
  // A DID may safely recover a deleted/recreated profile because new writes
  // enforce one canonical app profile per DID. Zero or multiple live profiles
  // remain unavailable, and the latter throws/fails closed.
  if (!profile && linkStatus === "linked" && rowAppDid) {
    profile = await getLoginAppProfileForOwner(rowAppDid);
  }
  if (!profile && linkStatus === "relink_required") {
    const legacyOwner = typeof input.contact_did === "string"
      ? input.contact_did
      : "";
    profile = legacyOwner
      ? knownOwnerProfile?.did === legacyOwner
        ? knownOwnerProfile
        : await getLoginAppProfileForOwner(legacyOwner)
      : null;
  }
  if (!profile) return rowToLoginApp(input);
  const row = await bindLoginAppRowToProfile(input, profile);
  return rowToLoginApp(row, profile);
}

export async function getLoginApp(
  clientId: string,
): Promise<LoginApp | null> {
  const row = await withDb(async (c) => {
    const result = await c.execute({
      sql: `SELECT * FROM login_app WHERE client_id = ?`,
      args: [clientId],
    });
    if (result.rows.length === 0) return null;
    return result.rows[0] as Record<string, unknown>;
  });
  return row ? await hydrateLoginAppRow(row) : null;
}

export async function listLoginAppsForOwner(
  ownerDid: string,
  knownOwnerProfile?: LoginAppProfileIdentity,
): Promise<LoginApp[]> {
  const owner = ownerDid.trim();
  if (knownOwnerProfile && knownOwnerProfile.did !== owner) {
    throw new LoginRequestError("App profile owner does not match", 403);
  }
  const profile = knownOwnerProfile ?? await getLoginAppProfileForOwner(owner);
  if (!profile) return [];
  const rows = await withDb(async (c) => {
    const appNameOrder = isPostgresBackend()
      ? "lower(app_name)"
      : "app_name COLLATE NOCASE";
    const result = await c.execute({
      sql: `
        SELECT * FROM login_app
        WHERE app_did = ?
          OR (app_did IS NULL AND contact_did = ?)
        ORDER BY updated_at DESC, ${appNameOrder}
      `,
      args: [owner, owner],
    });
    return result.rows as Record<string, unknown>[];
  });
  const apps = await Promise.all(
    rows.map((row) => hydrateLoginAppRow(row, profile)),
  );
  return apps.filter((app) =>
    app.identityAvailable && app.appDid === profile.did &&
    app.appProfileUri === profile.profileUri
  );
}

/**
 * Owner-facing recovery inventory. Unlike the normal environment list, this
 * keeps legacy or orphaned rows visible to the DID that can remove them. If
 * the owner now has one unambiguous app profile, hydration relinks the rows
 * automatically; otherwise their stored identity remains unavailable.
 */
export async function listRecoverableLoginAppsForOwner(
  ownerDid: string,
): Promise<LoginApp[]> {
  const owner = ownerDid.trim();
  if (!owner.startsWith("did:")) return [];
  let profile: LoginAppProfileIdentity | null = null;
  try {
    profile = await getLoginAppProfileForOwner(owner);
  } catch {
    // Multiple legacy profiles cannot be guessed. The raw rows stay visible
    // only for cleanup until the ownership ambiguity is resolved.
  }
  const rows = await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT * FROM login_app
        WHERE link_status <> 'system_fixture'
          AND (
            app_did = ? OR
            (app_did IS NULL AND contact_did = ?)
          )
        ORDER BY updated_at DESC, client_id ASC
      `,
      args: [owner, owner],
    });
    return result.rows as Record<string, unknown>[];
  });
  return await Promise.all(rows.map(async (row) => {
    try {
      return await hydrateLoginAppRow(row, profile ?? undefined);
    } catch {
      return rowToLoginApp(row);
    }
  }));
}

export async function getLoginAppForOwner(
  ownerDid: string,
  clientId: string,
): Promise<LoginApp | null> {
  const app = await getLoginApp(clientId);
  if (
    !app || !app.identityAvailable || app.linkStatus !== "linked" ||
    app.appDid !== ownerDid.trim()
  ) return null;
  return app;
}

export async function deleteLoginAppForOwner(
  ownerDid: string,
  clientId: string,
): Promise<boolean> {
  const owner = ownerDid.trim();
  if (!owner.startsWith("did:")) {
    throw new LoginRequestError("signed-in app account is required", 401);
  }
  return await withDb((c) =>
    deleteLoginAppForOwnerWithClient(c, owner, clientId)
  );
}

export async function deleteLoginAppForOwnerWithClient(
  c: DbClient,
  ownerDid: string,
  clientId: string,
): Promise<boolean> {
  const result = await c.execute({
    sql: `
      DELETE FROM login_app
      WHERE client_id = ?
        AND link_status <> 'system_fixture'
        AND (
          app_did = ? OR
          (app_did IS NULL AND contact_did = ?)
        )
    `,
    args: [clientId.trim(), ownerDid.trim(), ownerDid.trim()],
  });
  return Number(result.rowsAffected ?? 0) === 1;
}

interface PreferredAccountHostDependencies {
  getHost?: typeof getAccountHost;
  getClaim?: typeof getAccountHostClaim;
  getAppProfile?: (
    ownerDid: string,
  ) => Promise<LoginAppProfileIdentity | null>;
  listVerifiedLinks?: (
    appListingId: string,
  ) => Promise<Array<{ host: string; relationship: string }>>;
  verifyOwner?: (
    host: AccountHost,
    claim: AccountHostClaim | null,
  ) => Promise<string | null>;
}

function isJoinableAccountHost(host: AccountHost): boolean {
  return !!host.signupUrl &&
    (host.signupStatus === "open" ||
      host.signupStatus === "invite_required");
}

async function verifiedPreferredHostRelationship(
  profile: LoginAppProfileIdentity,
  host: AccountHost,
  claim: AccountHostClaim | null,
  dependencies: PreferredAccountHostDependencies,
): Promise<boolean> {
  const verifiedOwnerDid = await (dependencies.verifyOwner ??
    verifiedAccountHostOwnerDid)(host, claim).catch(() => null);
  if (verifiedOwnerDid === profile.did) return true;
  const links = await (dependencies.listVerifiedLinks ??
    listVerifiedDirectoryEntityLinksForApp)(profile.listingId);
  return links.some((link) =>
    link.host === host.host && link.relationship !== "host_only"
  );
}

export async function listLoginPreferredHostChoicesForApp(
  ownerDid: string,
  knownOwnerProfile?: LoginAppProfileIdentity,
): Promise<AccountHost[]> {
  const owner = ownerDid.trim();
  if (knownOwnerProfile && knownOwnerProfile.did !== owner) {
    throw new LoginRequestError("App profile owner does not match", 403);
  }
  const profile = knownOwnerProfile ??
    await requireLoginAppProfileForOwner(owner);
  const [ownedHosts, links] = await Promise.all([
    listClaimedAccountHostsForOwner(profile.did),
    listVerifiedDirectoryEntityLinksForApp(profile.listingId),
  ]);
  const linkedHosts = await Promise.all(
    links.filter((link) => link.relationship !== "host_only").map((link) =>
      getAccountHost(link.host)
    ),
  );
  const choices = new Map<string, AccountHost>();
  for (const host of [...ownedHosts, ...linkedHosts]) {
    if (host && isJoinableAccountHost(host)) choices.set(host.host, host);
  }
  return [...choices.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName) ||
    left.host.localeCompare(right.host)
  );
}

export async function verifyPreferredAccountHostForOwner(
  ownerDid: string,
  value: string | null | undefined,
  dependencies: PreferredAccountHostDependencies = {},
): Promise<string | null> {
  const host = value?.trim().toLowerCase() ?? "";
  if (!host) return null;
  const profile = await (dependencies.getAppProfile ??
    getLoginAppProfileForOwner)(ownerDid);
  if (!profile) {
    throw new LoginRequestError(
      "An app profile is required before choosing a preferred account host.",
      403,
    );
  }
  const getHostClaim = dependencies.getClaim ?? getAccountHostClaim;
  const getHost = dependencies.getHost ?? getAccountHost;
  const [claim, accountHost] = await Promise.all([
    getHostClaim(host),
    getHost(host),
  ]);
  if (
    !accountHost || !isJoinableAccountHost(accountHost) ||
    !await verifiedPreferredHostRelationship(
      profile,
      accountHost,
      claim,
      dependencies,
    )
  ) {
    throw new LoginRequestError(
      "Choose a joinable account host owned by this app account or connected to this app by a verified relationship.",
      400,
    );
  }
  return accountHost.host;
}

export async function resolveVerifiedPreferredAccountHost(
  app: LoginApp,
  dependencies: PreferredAccountHostDependencies = {},
): Promise<AccountHost | null> {
  if (
    !app.registered || !app.identityAvailable || app.linkStatus !== "linked" ||
    !app.appDid || !app.appProfileUri || !app.preferredAccountHost
  ) {
    return null;
  }
  const profile = dependencies.getAppProfile
    ? await dependencies.getAppProfile(app.appDid)
    : await getLinkedLoginAppProfile(app.appDid, app.appProfileUri);
  if (!profile || profile.profileUri !== app.appProfileUri) return null;
  const getHostClaim = dependencies.getClaim ?? getAccountHostClaim;
  const getHost = dependencies.getHost ?? getAccountHost;
  const [claim, host] = await Promise.all([
    getHostClaim(app.preferredAccountHost),
    getHost(app.preferredAccountHost),
  ]);
  if (
    !host || !isJoinableAccountHost(host) ||
    !await verifiedPreferredHostRelationship(
      profile,
      host,
      claim,
      dependencies,
    )
  ) {
    return null;
  }
  return host;
}

export interface LoginAppTrustReviewListOptions {
  limit?: number;
  offset?: number;
}

export async function hydrateLoginAppTrustReviewRowFailClosed(
  row: Record<string, unknown>,
  hydrate: (
    row: Record<string, unknown>,
  ) => Promise<LoginApp> = hydrateLoginAppRow,
): Promise<LoginApp> {
  try {
    return await hydrate(row);
  } catch {
    // Legacy rows may have no owner profile or an ambiguous owner. Keep the
    // request visible to admins, but expose no stored identity and make trust
    // approval impossible until the link can be recovered safely.
    return rowToLoginApp(row);
  }
}

export async function listLoginAppsForTrustReview(
  options: LoginAppTrustReviewListOptions = {},
): Promise<LoginApp[]> {
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 50)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const rows = await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT * FROM login_app
        WHERE review_status = 'requested'
        ORDER BY review_requested_at ASC, updated_at ASC
        LIMIT ? OFFSET ?
      `,
      args: [limit, offset],
    });
    return result.rows as Record<string, unknown>[];
  });
  return await Promise.all(
    rows.map((row) => hydrateLoginAppTrustReviewRowFailClosed(row)),
  );
}

export async function countLoginAppsForTrustReview(): Promise<number> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM login_app
        WHERE review_status = 'requested'
      `,
      args: [],
    });
    return Number(result.rows[0]?.count) || 0;
  });
}

export interface LoginAppUpsertInput {
  clientId: string;
  appName: string;
  appUri?: string | null;
  logoUri?: string | null;
  allowedReturnUris: string[];
  allowedOrigins?: string[];
  status?: LoginApp["status"];
  contactDid?: string | null;
  appDid?: string | null;
  appProfileUri?: string | null;
  linkStatus?: LoginAppLinkStatus;
  profileIdentityFingerprint?: string | null;
  profileIdentityUpdatedAt?: number | null;
  reviewRevision?: string;
  environmentRevision?: string;
  expectedEnvironmentRevision?: string | null;
  /** Refuse the conflict-update branch; used for race-safe owner creation. */
  insertOnly?: boolean;
  preferredAccountHost?: string | null;
}

export async function upsertLoginApp(
  app: LoginAppUpsertInput,
): Promise<boolean> {
  return await withDb((c) => upsertLoginAppWithClient(c, app));
}

export async function upsertLoginAppWithClient(
  c: DbClient,
  app: LoginAppUpsertInput,
  now = Date.now(),
): Promise<boolean> {
  const linkStatus = app.linkStatus ??
    (app.appDid && app.appProfileUri ? "linked" : "relink_required");
  const reviewRevision = app.reviewRevision ?? randomB64u(18);
  const environmentRevision = app.environmentRevision ?? randomB64u(18);
  const expectedEnvironmentRevision = app.expectedEnvironmentRevision ?? null;
  // Keep trust only when the security- and identity-bearing environment is
  // byte-for-byte unchanged. Resetting the review in this same statement
  // prevents an admin from approving the new environment in the gap between
  // an owner update and a later cleanup query.
  const unchangedEnvironmentSql = `
    login_app.allowed_return_uris = excluded.allowed_return_uris
    AND login_app.allowed_origins = excluded.allowed_origins
    AND login_app.app_name = excluded.app_name
    AND COALESCE(login_app.app_uri, '') = COALESCE(excluded.app_uri, '')
    AND COALESCE(login_app.logo_uri, '') = COALESCE(excluded.logo_uri, '')
    AND COALESCE(login_app.app_did, '') = COALESCE(excluded.app_did, '')
    AND COALESCE(login_app.app_profile_uri, '') = COALESCE(excluded.app_profile_uri, '')
    AND COALESCE(login_app.profile_identity_fingerprint, '') = COALESCE(excluded.profile_identity_fingerprint, '')
  `;
  const unchangedOwnerEnvironmentSql = `
    ${unchangedEnvironmentSql}
    AND COALESCE(login_app.preferred_account_host, '') = COALESCE(excluded.preferred_account_host, '')
  `;
  const result = await c.execute({
    sql: `
        INSERT INTO login_app (
          client_id, app_name, app_uri, logo_uri, allowed_return_uris,
          allowed_origins, status, contact_did, app_did, app_profile_uri,
          link_status, profile_identity_fingerprint,
          profile_identity_updated_at, review_revision, environment_revision,
          preferred_account_host,
          created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ? <> 'linked'
          OR EXISTS (
            SELECT 1
            FROM app_listing
            WHERE canonical_uri = ?
              AND deleted_at IS NULL
              AND updated_at = ?
              AND (
                product_did = ? OR
                profile_did = ? OR
                legacy_profile_did = ?
              )
          )
        ON CONFLICT(client_id) DO UPDATE SET
          app_name = excluded.app_name,
          app_uri = excluded.app_uri,
          logo_uri = excluded.logo_uri,
          allowed_return_uris = excluded.allowed_return_uris,
          allowed_origins = excluded.allowed_origins,
          status = CASE
            WHEN login_app.status = 'blocked' THEN 'blocked'
            WHEN ${unchangedEnvironmentSql}
            THEN login_app.status
            ELSE excluded.status
          END,
          contact_did = excluded.contact_did,
          app_did = excluded.app_did,
          app_profile_uri = excluded.app_profile_uri,
          link_status = excluded.link_status,
          profile_identity_fingerprint = excluded.profile_identity_fingerprint,
          profile_identity_updated_at = excluded.profile_identity_updated_at,
          review_status = CASE
            WHEN login_app.status = 'blocked' OR ${unchangedEnvironmentSql}
            THEN login_app.review_status
            ELSE 'none'
          END,
          review_requested_at = CASE
            WHEN login_app.status = 'blocked' OR ${unchangedEnvironmentSql}
            THEN login_app.review_requested_at
            ELSE NULL
          END,
          review_notes = CASE
            WHEN login_app.status = 'blocked' OR ${unchangedEnvironmentSql}
            THEN login_app.review_notes
            ELSE NULL
          END,
          review_decision_at = CASE
            WHEN login_app.status = 'blocked' OR ${unchangedEnvironmentSql}
            THEN login_app.review_decision_at
            ELSE NULL
          END,
          review_decision_by = CASE
            WHEN login_app.status = 'blocked' OR ${unchangedEnvironmentSql}
            THEN login_app.review_decision_by
            ELSE NULL
          END,
          review_decision_reason = CASE
            WHEN login_app.status = 'blocked' OR ${unchangedEnvironmentSql}
            THEN login_app.review_decision_reason
            ELSE NULL
          END,
          review_revision = CASE
            WHEN ${unchangedEnvironmentSql} THEN login_app.review_revision
            ELSE excluded.review_revision
          END,
          environment_revision = CASE
            WHEN ${unchangedOwnerEnvironmentSql}
            THEN login_app.environment_revision
            ELSE excluded.environment_revision
          END,
          preferred_account_host = excluded.preferred_account_host,
          updated_at = excluded.updated_at
        WHERE (
          (
            excluded.link_status = 'linked'
            AND (
              (
                login_app.link_status = 'linked'
                AND login_app.app_did = excluded.app_did
                AND login_app.app_profile_uri = excluded.app_profile_uri
              )
              OR (
                login_app.link_status = 'relink_required'
                AND login_app.app_did IS NULL
                AND login_app.contact_did = excluded.contact_did
              )
            )
          )
          OR (
            excluded.link_status = 'system_fixture'
            AND login_app.link_status = 'system_fixture'
          )
          OR (
            excluded.link_status = 'relink_required'
            AND login_app.link_status = 'relink_required'
            AND COALESCE(login_app.contact_did, '') = COALESCE(excluded.contact_did, '')
            AND COALESCE(login_app.app_did, '') = COALESCE(excluded.app_did, '')
          )
        )
          AND (
            ? IS NULL OR
            COALESCE(login_app.environment_revision, '') = COALESCE(?, '')
          )
          AND ? = 0
      `,
    args: [
      app.clientId,
      app.appName,
      app.appUri ?? null,
      app.logoUri ?? null,
      JSON.stringify(app.allowedReturnUris),
      JSON.stringify(app.allowedOrigins ?? []),
      app.status ?? "unverified",
      app.contactDid ?? null,
      app.appDid ?? null,
      app.appProfileUri ?? null,
      linkStatus,
      app.profileIdentityFingerprint ?? null,
      app.profileIdentityUpdatedAt ?? null,
      reviewRevision,
      environmentRevision,
      app.preferredAccountHost ?? null,
      now,
      now,
      linkStatus,
      app.appProfileUri ?? null,
      app.profileIdentityUpdatedAt ?? null,
      app.appDid ?? null,
      app.appDid ?? null,
      app.appDid ?? null,
      expectedEnvironmentRevision,
      expectedEnvironmentRevision,
      app.insertOnly ? 1 : 0,
    ],
  });
  return Number(result.rowsAffected ?? 0) === 1;
}

export async function registerLoginAppForOwner(
  ownerDid: string,
  input: LoginAppRegistrationInput,
): Promise<LoginApp> {
  const owner = ownerDid.trim();
  if (!owner) {
    throw new LoginRequestError("signed-in account is required", 401);
  }

  const profile = await requireLoginAppProfileForOwner(owner);
  const clientId = normalizeRegistrationUrl(input.clientId, "client ID", true);
  const allowedReturnUris = normalizeAllowedReturnUris(
    input.allowedReturnUris,
  );

  const existing = await getLoginApp(clientId);
  if (
    existing &&
    (existing.linkStatus === "system_fixture" ||
      (existing.appDid && existing.appDid !== owner) ||
      (!existing.appDid && existing.contactDid !== owner))
  ) {
    throw new LoginRequestError(LOGIN_APP_CLIENT_ID_CONFLICT_MESSAGE, 409);
  }
  const preferredAccountHost = input.preferredAccountHost === undefined
    ? (existing?.preferredAccountHost ?? null)
    : await verifyPreferredAccountHostForOwner(
      owner,
      input.preferredAccountHost,
    );
  const expectedEnvironmentRevision =
    input.expectedEnvironmentRevision?.trim() || null;
  const desiredEnvironment = {
    ownerDid: owner,
    profileUri: profile.profileUri,
    allowedReturnUris,
    preferredAccountHost,
  };
  if (existing && !expectedEnvironmentRevision) {
    if (loginEnvironmentMatchesRegistration(existing, desiredEnvironment)) {
      return existing;
    }
    throw new LoginRequestError(LOGIN_APP_STALE_ENVIRONMENT_MESSAGE, 409);
  }

  const changed = existing
    ? registrationChanged(existing, { allowedReturnUris }) ||
      existing.appProfileUri !== profile.profileUri
    : false;
  const status = existing?.status === "blocked"
    ? "blocked"
    : existing && !changed
    ? existing.status
    : defaultRegistrationStatus(clientId, allowedReturnUris);
  const writeRevision = randomB64u(18);
  const writeEnvironmentRevision = randomB64u(18);

  const saved = await upsertLoginApp({
    clientId,
    appName: profile.name,
    appUri: profile.homepage,
    logoUri: profile.logoUri,
    allowedReturnUris,
    allowedOrigins: [],
    status,
    contactDid: owner,
    appDid: owner,
    appProfileUri: profile.profileUri,
    linkStatus: "linked",
    profileIdentityFingerprint: profile.identityFingerprint,
    profileIdentityUpdatedAt: profile.updatedAt,
    reviewRevision: writeRevision,
    environmentRevision: writeEnvironmentRevision,
    expectedEnvironmentRevision,
    insertOnly: !existing,
    preferredAccountHost,
  });
  if (!saved) {
    const current = await getLoginAppForOwner(owner, clientId).catch(() =>
      null
    );
    if (
      current && loginEnvironmentMatchesRegistration(
        current,
        desiredEnvironment,
      )
    ) {
      return current;
    }
    throw new LoginRequestError(
      existing
        ? LOGIN_APP_STALE_ENVIRONMENT_MESSAGE
        : LOGIN_APP_CLIENT_ID_CONFLICT_MESSAGE,
      409,
    );
  }

  let registered: LoginApp | null;
  try {
    registered = await getLoginApp(clientId);
  } catch (error) {
    if (!existing && error instanceof LoginRequestError) {
      await deleteNewlyInsertedLoginApp(
        clientId,
        owner,
        profile.profileUri,
        writeRevision,
      );
    }
    throw error;
  }
  if (!registered) {
    throw new LoginRequestError("App registration could not be saved", 500);
  }
  if (
    !registered.identityAvailable || registered.linkStatus !== "linked" ||
    registered.appDid !== owner ||
    registered.appProfileUri !== profile.profileUri
  ) {
    if (!existing) {
      await deleteNewlyInsertedLoginApp(
        clientId,
        owner,
        profile.profileUri,
        writeRevision,
      );
    }
    throw new LoginRequestError(LOGIN_APP_CLIENT_ID_CONFLICT_MESSAGE, 409);
  }
  return registered;
}

async function deleteNewlyInsertedLoginApp(
  clientId: string,
  ownerDid: string,
  profileUri: string,
  reviewRevision: string,
): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql: `
        DELETE FROM login_app
        WHERE client_id = ?
          AND app_did = ?
          AND app_profile_uri = ?
          AND link_status = 'linked'
          AND review_revision = ?
      `,
      args: [clientId, ownerDid, profileUri, reviewRevision],
    });
  });
}

export async function saveLoginAppTrustReviewRequestWithClient(
  c: DbClient,
  input: {
    clientId: string;
    ownerDid: string;
    notes: string;
    expectedReviewRevision: string;
    nextReviewRevision: string;
  },
  now = Date.now(),
): Promise<boolean> {
  const result = await c.execute({
    sql: `
      UPDATE login_app
      SET review_status = 'requested',
          review_requested_at = ?,
          review_notes = ?,
          review_decision_at = NULL,
          review_decision_by = NULL,
          review_decision_reason = NULL,
          review_revision = ?,
          updated_at = ?
      WHERE client_id = ?
        AND contact_did = ?
        AND status <> 'blocked'
        AND link_status = 'linked'
        AND review_revision = ?
        AND app_did IS NOT NULL
        AND app_profile_uri IS NOT NULL
        AND profile_identity_updated_at IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM app_listing l
          LEFT JOIN app_moderation m ON m.listing_id = l.id
          WHERE l.canonical_uri = login_app.app_profile_uri
            AND l.deleted_at IS NULL
            AND l.updated_at = login_app.profile_identity_updated_at
            AND COALESCE(m.status, 'visible') = 'visible'
            AND (
              l.product_did = login_app.app_did OR
              l.profile_did = login_app.app_did OR
              l.legacy_profile_did = login_app.app_did
            )
            AND NOT EXISTS (
              SELECT 1
              FROM profile p
              WHERE p.profile_type = 'project'
                AND p.takedown_status = 'taken_down'
                AND p.did IN (
                  l.product_did,
                  l.profile_did,
                  l.legacy_profile_did
                )
            )
        )
    `,
    args: [
      now,
      input.notes,
      input.nextReviewRevision,
      now,
      input.clientId,
      input.ownerDid,
      input.expectedReviewRevision,
    ],
  });
  return Number(result.rowsAffected ?? 0) === 1;
}

export async function requestLoginAppTrustReview(
  ownerDid: string,
  clientId: string,
  notes: string,
): Promise<LoginApp> {
  const app = await getLoginAppForOwner(ownerDid, clientId);
  if (!app) {
    throw new LoginRequestError("App registration not found", 404);
  }
  if (app.status === "blocked") {
    throw new LoginRequestError(
      "Blocked apps cannot request trusted review",
      403,
    );
  }
  if (app.loginAvailability !== "available") {
    throw new LoginRequestError(
      "This app profile is not available for Login with Atmosphere.",
      403,
    );
  }
  if (app.status === "trusted") {
    throw new LoginRequestError("This app is already trusted");
  }
  const checks = await buildLoginAppProductionChecks(app);
  const readiness = buildLoginAppReadiness(app, checks);
  if (readiness.state !== "ready") {
    throw new LoginRequestError(
      `${readiness.label}: ${readiness.body}`,
      400,
    );
  }
  const reviewNotes = normalizeReviewNotes(notes);
  const expectedReviewRevision = app.reviewRevision;
  if (!expectedReviewRevision) {
    throw new LoginRequestError(
      "Reload this login environment before requesting review.",
      409,
    );
  }
  const now = Date.now();
  const reviewRevision = randomB64u(18);
  const requested = await withDb((c) =>
    saveLoginAppTrustReviewRequestWithClient(c, {
      clientId,
      ownerDid,
      notes: reviewNotes,
      expectedReviewRevision,
      nextReviewRevision: reviewRevision,
    }, now)
  );
  if (!requested) {
    throw new LoginRequestError(
      "This login environment changed before review could be requested.",
      409,
    );
  }
  const updated = await getLoginAppForOwner(ownerDid, clientId);
  if (!updated) throw new LoginRequestError("App registration not found", 404);
  return updated;
}

export interface LoginAppTrustReviewDecisionInput {
  clientId: string;
  adminDid: string;
  action: "approve" | "reject" | "block";
  reason?: string | null;
  /**
   * Revision rendered with the admin review. Approval requires a non-empty
   * revision; reject/block also compare-and-swap legacy rows whose revision is
   * absent.
   */
  expectedReviewRevision?: string | null;
}

export async function applyLoginAppTrustReviewDecisionWithClient(
  c: DbClient,
  input: LoginAppTrustReviewDecisionInput,
  now = Date.now(),
  nextReviewRevision = randomB64u(18),
): Promise<boolean> {
  const reason = normalizeDecisionReason(input.reason ?? "");
  const expectedRevision = input.expectedReviewRevision?.trim() ?? "";
  if (input.action === "approve") {
    if (!expectedRevision) return false;
    const result = await c.execute({
      sql: `
        UPDATE login_app
        SET status = 'trusted',
            review_status = 'approved',
            review_decision_at = ?,
            review_decision_by = ?,
            review_decision_reason = ?,
            review_revision = ?,
            updated_at = ?
        WHERE client_id = ?
          AND status <> 'blocked'
          AND review_status = 'requested'
          AND review_revision = ?
          AND (
            link_status = 'system_fixture'
            OR (
              link_status = 'linked'
              AND app_did IS NOT NULL
              AND app_profile_uri IS NOT NULL
              AND profile_identity_updated_at IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM app_listing l
                LEFT JOIN app_moderation m ON m.listing_id = l.id
                WHERE l.canonical_uri = login_app.app_profile_uri
                  AND l.deleted_at IS NULL
                  AND l.updated_at = login_app.profile_identity_updated_at
                  AND COALESCE(m.status, 'visible') = 'visible'
                  AND (
                    l.product_did = login_app.app_did OR
                    l.profile_did = login_app.app_did OR
                    l.legacy_profile_did = login_app.app_did
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM profile p
                    WHERE p.profile_type = 'project'
                      AND p.takedown_status = 'taken_down'
                      AND p.did IN (
                        l.product_did,
                        l.profile_did,
                        l.legacy_profile_did
                      )
                  )
              )
            )
          )
      `,
      args: [
        now,
        input.adminDid,
        reason,
        nextReviewRevision,
        now,
        input.clientId,
        expectedRevision,
      ],
    });
    return Number(result.rowsAffected ?? 0) === 1;
  }

  const status: LoginApp["status"] = input.action === "block"
    ? "blocked"
    : "unverified";
  const result = await c.execute({
    sql: `
      UPDATE login_app
      SET status = ?,
          review_status = 'rejected',
          review_decision_at = ?,
          review_decision_by = ?,
          review_decision_reason = ?,
          review_revision = ?,
          updated_at = ?
      WHERE client_id = ?
        AND COALESCE(review_revision, '') = ?
        AND review_status = 'requested'
        AND status <> 'blocked'
    `,
    args: [
      status,
      now,
      input.adminDid,
      reason,
      nextReviewRevision,
      now,
      input.clientId,
      expectedRevision,
    ],
  });
  return Number(result.rowsAffected ?? 0) === 1;
}

export async function moderateLoginAppTrustReview(
  input: LoginAppTrustReviewDecisionInput,
): Promise<LoginApp> {
  const current = await getLoginApp(input.clientId);
  if (!current) {
    throw new LoginRequestError("App registration not found", 404);
  }
  if (
    input.action === "approve" &&
    (!current.identityAvailable ||
      current.loginAvailability !== "available" ||
      (current.registered && current.linkStatus === "relink_required"))
  ) {
    throw new LoginRequestError(
      "This login environment is not linked to a live app profile and cannot be trusted.",
      409,
    );
  }
  const changed = await withDb((c) =>
    applyLoginAppTrustReviewDecisionWithClient(c, input)
  );
  if (!changed) {
    throw new LoginRequestError(
      input.action === "approve"
        ? "This login environment changed after it was reviewed. Reload it before approving."
        : "This login environment changed before the decision was saved.",
      409,
    );
  }
  const updated = await getLoginApp(input.clientId);
  if (!updated) throw new LoginRequestError("App registration not found", 404);
  return updated;
}

export function loginAppDetailPath(clientId: string): string {
  return `/account/developer/apps/${encodeURIComponent(clientId)}`;
}

export function splitAllowedReturnUris(raw: string): string[] {
  return raw.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean);
}

export function loginAppStatusLabel(status: LoginApp["status"]): string {
  switch (status) {
    case "development":
      return "Development app";
    case "trusted":
      return "Trusted";
    case "blocked":
      return "Blocked";
    case "unverified":
    default:
      return "Unverified app";
  }
}

function normalizeReviewNotes(value: string): string {
  const notes = value.trim();
  if (!notes) {
    throw new LoginRequestError("Review notes are required");
  }
  if (notes.length > MAX_REVIEW_NOTES_LEN) {
    throw new LoginRequestError(
      `Review notes must be ${MAX_REVIEW_NOTES_LEN} characters or fewer`,
    );
  }
  return notes;
}

function normalizeDecisionReason(value: string): string | null {
  const reason = value.trim();
  if (!reason) return null;
  return reason.slice(0, MAX_REVIEW_NOTES_LEN);
}

function registrationChanged(
  app: LoginApp,
  next: {
    allowedReturnUris: string[];
  },
): boolean {
  return JSON.stringify(app.allowedReturnUris) !==
    JSON.stringify(next.allowedReturnUris);
}

function loginEnvironmentMatchesRegistration(
  app: LoginApp,
  desired: {
    ownerDid: string;
    profileUri: string;
    allowedReturnUris: string[];
    preferredAccountHost: string | null;
  },
): boolean {
  return app.identityAvailable && app.linkStatus === "linked" &&
    app.appDid === desired.ownerDid &&
    app.appProfileUri === desired.profileUri &&
    app.allowedOrigins.length === 0 &&
    JSON.stringify(app.allowedReturnUris) ===
      JSON.stringify(desired.allowedReturnUris) &&
    app.preferredAccountHost === desired.preferredAccountHost;
}

export const loginEnvironmentMatchesRegistrationForTest =
  loginEnvironmentMatchesRegistration;

export async function resetLoginAppReviewStateWithClient(
  c: DbClient,
  clientId: string,
  now = Date.now(),
): Promise<boolean> {
  const reviewRevision = randomB64u(18);
  const result = await c.execute({
    sql: `
        UPDATE login_app
        SET review_status = 'none',
            review_requested_at = NULL,
            review_notes = NULL,
            review_decision_at = NULL,
            review_decision_by = NULL,
            review_decision_reason = NULL,
            review_revision = ?,
            updated_at = ?
        WHERE client_id = ?
          AND status <> 'blocked'
      `,
    args: [reviewRevision, now, clientId],
  });
  return Number(result.rowsAffected ?? 0) === 1;
}

function normalizeRegistrationUrl(
  value: string,
  label: string,
  required: true,
): string;
function normalizeRegistrationUrl(
  value: string,
  label: string,
  required: false,
): string | null;
function normalizeRegistrationUrl(
  value: string,
  label: string,
  required: boolean,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new LoginRequestError(`${label} is required`);
    return null;
  }
  if (trimmed.length > MAX_URL_LEN) {
    throw new LoginRequestError(
      `${label} must be shorter than ${MAX_URL_LEN} characters`,
    );
  }
  const url = parseAbsoluteUrl(trimmed, label);
  assertSafeWebUrl(url, label);
  return normalizeHref(url);
}

function normalizeAllowedReturnUris(values: string[]): string[] {
  if (values.length > MAX_ALLOWED_RETURN_URIS) {
    throw new LoginRequestError(
      `Use ${MAX_ALLOWED_RETURN_URIS} or fewer allowed return URIs`,
    );
  }
  const out = new Set<string>();
  for (const value of values) {
    const normalized = normalizeRegistrationUrl(value, "return URI", true);
    out.add(normalized);
  }
  if (out.size === 0) {
    throw new LoginRequestError("At least one allowed return URI is required");
  }
  return [...out];
}

function defaultRegistrationStatus(
  clientId: string,
  allowedReturnUris: string[],
): LoginApp["status"] {
  const client = new URL(clientId);
  const loopbackDev = IS_DEV && client.protocol === "http:" &&
    isLoopbackHostname(client.hostname) &&
    allowedReturnUris.every((value) => {
      const url = new URL(value);
      return url.protocol === "http:" && isLoopbackHostname(url.hostname);
    });
  return loopbackDev ? "development" : "unverified";
}

interface AtmosphereLoginManifestApp {
  clientId: string;
  appName: string | null;
  homepage: string | null;
  logoUri: string | null;
  allowedReturnUris: string[];
}

interface FetchLoginManifestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function manifestValue(
  value: Record<string, unknown>,
  snake: string,
  camel: string,
): unknown {
  return value[snake] ?? value[camel];
}

function manifestString(
  value: Record<string, unknown>,
  snake: string,
  camel: string,
): string | null {
  const raw = manifestValue(value, snake, camel);
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function manifestStringArray(
  value: Record<string, unknown>,
  snake: string,
  camel: string,
): string[] {
  const raw = manifestValue(value, snake, camel);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string =>
    typeof item === "string" && item.trim().length > 0
  ).map((item) => item.trim());
}

function parseManifestApp(
  value: unknown,
): AtmosphereLoginManifestApp | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const clientId = manifestString(record, "client_id", "clientId");
  if (!clientId) return null;
  return {
    clientId,
    appName: manifestString(record, "app_name", "appName"),
    homepage: manifestString(record, "homepage", "homepage") ??
      manifestString(record, "app_uri", "appUri"),
    logoUri: manifestString(record, "logo_uri", "logoUri"),
    allowedReturnUris: manifestStringArray(
      record,
      "allowed_return_uris",
      "allowedReturnUris",
    ),
  };
}

function normalizeUrlForManifest(value: string): string | null {
  try {
    return normalizeHref(new URL(value));
  } catch {
    return null;
  }
}

function sameNormalizedUrl(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const normalizedLeft = normalizeUrlForManifest(left);
  const normalizedRight = normalizeUrlForManifest(right);
  return !!normalizedLeft && normalizedLeft === normalizedRight;
}

function selectManifestApp(
  manifest: unknown,
  app: LoginApp,
): { version: string | null; manifestApp: AtmosphereLoginManifestApp | null } {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { version: null, manifestApp: null };
  }
  const record = manifest as Record<string, unknown>;
  const version = typeof record.version === "string" ? record.version : null;
  const topLevel = parseManifestApp(record);
  if (topLevel && sameNormalizedUrl(topLevel.clientId, app.clientId)) {
    return { version, manifestApp: topLevel };
  }

  const apps = Array.isArray(record.apps) ? record.apps : [];
  for (const item of apps) {
    const candidate = parseManifestApp(item);
    if (candidate && sameNormalizedUrl(candidate.clientId, app.clientId)) {
      return { version, manifestApp: candidate };
    }
  }
  return { version, manifestApp: null };
}

export function loginAppManifestUrl(app: LoginApp): string | null {
  if (!app.appUri) return null;
  const homepage = safeUrl(app.appUri);
  if (!homepage || homepage.protocol !== "https:") return null;
  if (isPrivateNetworkHostname(homepage.hostname)) return null;
  return new URL(ATMOSPHERE_LOGIN_MANIFEST_PATH, homepage.origin).toString();
}

export function evaluateLoginAppDomainManifest(
  app: LoginApp,
  manifest: unknown,
  manifestUrl: string,
): LoginAppIdentityCheck {
  const { version, manifestApp } = selectManifestApp(manifest, app);
  const failures: string[] = [];

  if (version !== ATMOSPHERE_LOGIN_MANIFEST_VERSION) {
    failures.push(
      `version must be ${ATMOSPHERE_LOGIN_MANIFEST_VERSION}`,
    );
  }
  if (!manifestApp) {
    failures.push("manifest does not include this client ID");
  }

  if (manifestApp) {
    if (!sameNormalizedUrl(manifestApp.clientId, app.clientId)) {
      failures.push("client_id does not match this registration");
    }
    if (!sameNormalizedUrl(manifestApp.homepage, app.appUri)) {
      failures.push("homepage does not match this registration");
    }
    if (manifestApp.appName !== app.appName) {
      failures.push("app_name does not match this registration");
    }
    if (app.logoUri && !sameNormalizedUrl(manifestApp.logoUri, app.logoUri)) {
      failures.push("logo_uri does not match this registration");
    }
    const manifestReturnUris = new Set(
      manifestApp.allowedReturnUris.map(normalizeUrlForManifest).filter((
        value,
      ): value is string => !!value),
    );
    for (const returnUri of app.allowedReturnUris) {
      const normalized = normalizeUrlForManifest(returnUri);
      if (!normalized || !manifestReturnUris.has(normalized)) {
        failures.push("allowed_return_uris is missing a registered callback");
        break;
      }
    }
  }

  if (failures.length > 0) {
    return {
      key: "domain-manifest",
      label: "Domain manifest",
      status: "fail",
      body:
        `Host ${ATMOSPHERE_LOGIN_MANIFEST_PATH} at the app homepage origin. ${
          failures.join("; ")
        }.`,
      href: manifestUrl,
      hrefLabel: "Open manifest",
    };
  }

  return {
    key: "domain-manifest",
    label: "Domain manifest",
    status: "pass",
    body:
      `Verified ${manifestUrl}. The domain confirms this client ID, app identity, and registered return URI allow-list.`,
    href: manifestUrl,
    hrefLabel: "Open manifest",
  };
}

export async function verifyLoginAppDomainManifest(
  app: LoginApp,
  options: FetchLoginManifestOptions = {},
): Promise<LoginAppIdentityCheck> {
  const manifestUrl = loginAppManifestUrl(app);
  if (!manifestUrl) {
    return {
      key: "domain-manifest",
      label: "Domain manifest",
      status: app.status === "development" ? "warn" : "fail",
      body: app.status === "development"
        ? "Local development apps do not need a production domain manifest yet."
        : "Production apps must host /.well-known/atmosphere-login.json on their HTTPS homepage origin.",
      href: null,
      hrefLabel: null,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? ATMOSPHERE_LOGIN_MANIFEST_TIMEOUT_MS,
  );
  try {
    const response = await fetchImpl(manifestUrl, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        key: "domain-manifest",
        label: "Domain manifest",
        status: "fail",
        body:
          `Could not fetch ${manifestUrl}. The server returned HTTP ${response.status}.`,
        href: manifestUrl,
        hrefLabel: "Open manifest",
      };
    }
    const body = await readResponseTextWithLimit(
      response,
      MAX_ATMOSPHERE_LOGIN_MANIFEST_BYTES,
    );
    if (!body.ok) {
      return {
        key: "domain-manifest",
        label: "Domain manifest",
        status: "fail",
        body: `Could not read ${manifestUrl}: ${body.error}.`,
        href: manifestUrl,
        hrefLabel: "Open manifest",
      };
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(body.text);
    } catch (err) {
      return {
        key: "domain-manifest",
        label: "Domain manifest",
        status: "fail",
        body: `Manifest is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }.`,
        href: manifestUrl,
        hrefLabel: "Open manifest",
      };
    }
    return evaluateLoginAppDomainManifest(app, manifest, manifestUrl);
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return {
      key: "domain-manifest",
      label: "Domain manifest",
      status: "fail",
      body: aborted
        ? `Timed out fetching ${manifestUrl}.`
        : `Could not fetch ${manifestUrl}.`,
      href: manifestUrl,
      hrefLabel: "Open manifest",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildLoginAppIdentityChecks(
  app: LoginApp,
): LoginAppIdentityCheck[] {
  const checks: LoginAppIdentityCheck[] = [];
  const client = safeUrl(app.clientId);
  const homepage = app.appUri ? safeUrl(app.appUri) : null;
  const logo = app.logoUri ? safeUrl(app.logoUri) : null;
  const clientDev = !!client && client.protocol === "http:" &&
    isLoopbackHostname(client.hostname);
  const returnUris = app.allowedReturnUris.map(safeUrl);
  const validReturnUris = returnUris.filter((url): url is URL => !!url);
  const allUrls = [client, homepage, logo, ...validReturnUris].filter((
    url,
  ): url is URL => !!url);
  const hasLoopbackUrl = allUrls.some(isLoopbackHttpUrl);
  const hasUnsafeHttpUrl = allUrls.some((url) =>
    url.protocol === "http:" && !isLoopbackHostname(url.hostname)
  );
  const hasPrivateHttpsUrl = allUrls.some((url) =>
    url.protocol === "https:" && isPrivateNetworkHostname(url.hostname)
  );

  checks.push({
    key: "client-id",
    label: "Client ID",
    status: client
      ? client.protocol === "https:" || clientDev ? "pass" : "fail"
      : "fail",
    body: client
      ? clientDev
        ? "Loopback HTTP is allowed for local development."
        : client.protocol === "https:"
        ? "Uses HTTPS."
        : "Production client IDs must use HTTPS."
      : "Client ID is not a valid absolute URL.",
  });

  checks.push({
    key: "homepage",
    label: "Homepage",
    status: homepage
      ? homepage.protocol === "https:" || isLoopbackHttpUrl(homepage)
        ? "pass"
        : "fail"
      : "fail",
    body: homepage
      ? homepage.protocol === "https:"
        ? "Homepage uses HTTPS."
        : isLoopbackHttpUrl(homepage)
        ? "Loopback HTTP homepage is only suitable for local development."
        : "Production homepages must use HTTPS."
      : "Add a valid homepage so people can identify the app.",
  });

  checks.push({
    key: "domain-alignment",
    label: "Domain alignment",
    status: client && homepage
      ? hostsRelated(client.hostname, homepage.hostname) ? "pass" : "warn"
      : "fail",
    body: client && homepage
      ? hostsRelated(client.hostname, homepage.hostname)
        ? `Homepage ${homepage.hostname} matches the client ID domain.`
        : `Homepage ${homepage.hostname} does not obviously match ${client.hostname}.`
      : "Add a valid homepage so the picker can show a trustworthy app identity.",
  });

  const allProductionHttps = validReturnUris.length > 0 &&
    validReturnUris.every((url) => url.protocol === "https:");
  const allDevLoopback = validReturnUris.length > 0 &&
    validReturnUris.every(isLoopbackHttpUrl);

  checks.push({
    key: "exact-return-uris",
    label: "Exact return URIs",
    status: app.allowedReturnUris.length > 0 &&
        validReturnUris.length === app.allowedReturnUris.length
      ? "pass"
      : "fail",
    body: app.allowedReturnUris.length > 0 &&
        validReturnUris.length === app.allowedReturnUris.length
      ? `${app.allowedReturnUris.length} exact callback${
        app.allowedReturnUris.length === 1 ? "" : "s"
      } registered. Matching includes scheme, host, port, path, and query.`
      : "Register at least one valid absolute return URI.",
  });

  checks.push({
    key: "https",
    label: "HTTPS",
    status: hasUnsafeHttpUrl || hasPrivateHttpsUrl
      ? "fail"
      : hasLoopbackUrl
      ? "warn"
      : allUrls.every((url) => url.protocol === "https:")
      ? "pass"
      : "fail",
    body: hasUnsafeHttpUrl
      ? "Non-loopback HTTP URLs are not safe for production."
      : hasPrivateHttpsUrl
      ? "Production URLs must use public HTTPS hosts, not private network or loopback hosts."
      : hasLoopbackUrl
      ? "Loopback HTTP is accepted in local development only."
      : "Client ID, homepage, logo, and return URIs use HTTPS.",
  });

  checks.push({
    key: "return-uri-mode",
    label: "Loopback/dev URLs",
    status: hasLoopbackUrl ? "warn" : "pass",
    body: hasLoopbackUrl
      ? "This app has loopback URLs, so it should stay in local development until production HTTPS URLs are registered."
      : "No loopback URLs are present in this registration.",
  });

  checks.push({
    key: "production-uris",
    label: "Production callbacks",
    status: allProductionHttps || (clientDev && allDevLoopback)
      ? "pass"
      : "fail",
    body: allProductionHttps
      ? "All return URIs use HTTPS."
      : clientDev && allDevLoopback
      ? "All return URIs are loopback-only for local development."
      : "Production return URIs must use HTTPS.",
  });

  checks.push({
    key: "logo",
    label: "Logo URL",
    status: logo
      ? logo.protocol === "https:" || isLoopbackHttpUrl(logo) ? "pass" : "fail"
      : "warn",
    body: logo
      ? logo.protocol === "https:"
        ? "Logo URL uses HTTPS."
        : "Loopback logo URLs are only suitable for local development."
      : "Add a logo URL so the picker can show a recognizable app mark.",
  });

  checks.push({
    key: "review-status",
    label: "Review status",
    status: app.loginAvailability !== "available"
      ? "fail"
      : app.status === "trusted"
      ? "pass"
      : app.status === "blocked"
      ? "fail"
      : "warn",
    body: app.loginAvailability !== "available"
      ? "Login with Atmosphere is unavailable for this app profile. The owner can still manage its settings."
      : app.status === "trusted"
      ? "This app is trusted in the picker."
      : app.status === "blocked"
      ? "This app cannot use Login with Atmosphere."
      : app.reviewStatus === "requested"
      ? "Trusted review has been requested."
      : app.reviewStatus === "rejected"
      ? "The last trusted review request needs changes."
      : "Request trusted review when production checks are ready.",
  });

  return checks;
}

export async function buildLoginAppProductionChecks(
  app: LoginApp,
  options: FetchLoginManifestOptions = {},
): Promise<LoginAppIdentityCheck[]> {
  const checks = buildLoginAppIdentityChecks(app);
  const manifestCheck = await verifyLoginAppDomainManifest(app, options);
  const reviewIndex = checks.findIndex((check) =>
    check.key === "review-status"
  );
  if (reviewIndex >= 0) {
    checks.splice(reviewIndex, 0, manifestCheck);
  } else {
    checks.push(manifestCheck);
  }
  return checks;
}

export function buildLoginAppReadiness(
  app: LoginApp,
  checks = buildLoginAppIdentityChecks(app),
): LoginAppReadiness {
  if (app.loginAvailability !== "available") {
    return {
      state: "unavailable",
      label: "Login unavailable",
      tone: "fail",
      body:
        "This app profile cannot use Login with Atmosphere right now. Its owner can still manage the app and its login settings.",
    };
  }
  if (app.status === "blocked") {
    return {
      state: "blocked",
      label: "Blocked",
      tone: "fail",
      body: "This app cannot use Login with Atmosphere until it is unblocked.",
    };
  }
  if (app.status === "trusted") {
    return {
      state: "trusted",
      label: "Trusted",
      tone: "pass",
      body:
        "This app is trusted in the picker and can use its registered return URIs.",
    };
  }
  const hasDevUrls = checks.some((check) =>
    check.key === "return-uri-mode" && check.status === "warn"
  );
  if (app.status === "development" || hasDevUrls) {
    return {
      state: "development",
      label: "Local development only",
      tone: "warn",
      body:
        "Loopback URLs are present. Keep testing locally, then use an HTTPS client ID and callbacks and publish an HTTPS homepage and logo in the app profile before review.",
    };
  }
  const hasBlockingFixes = checks.some((check) =>
    check.status === "fail" && check.key !== "review-status"
  );
  if (hasBlockingFixes) {
    return {
      state: "needs_fixes",
      label: "Needs production fixes",
      tone: "fail",
      body:
        "Fix the failing production checks before requesting trusted review.",
    };
  }
  return {
    state: "ready",
    label: "Ready to request trusted review",
    tone: "pass",
    body: app.reviewStatus === "requested"
      ? "Production checks look ready and trusted review has been requested."
      : "Production checks look ready. Add review notes and request trust when this identity is final.",
  };
}

function isLoopbackHttpUrl(url: URL): boolean {
  return url.protocol === "http:" && isLoopbackHostname(url.hostname);
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function hostsRelated(a: string, b: string): boolean {
  const left = normalizeHost(a);
  const right = normalizeHost(b);
  return left === right || left.endsWith(`.${right}`) ||
    right.endsWith(`.${left}`);
}

export async function resolveLoginAppForRequest(
  req: LoginRequest,
  options: {
    getLoginApp?: typeof getLoginApp;
  } = {},
): Promise<{ app: LoginApp; returnUri: URL }> {
  const client = parseAbsoluteUrl(req.clientId, "client_id");
  const returnUri = parseAbsoluteUrl(req.returnUri, "return_uri");
  const normalizedClientId = normalizeHref(client);
  const normalizedReturn = normalizeHref(returnUri);
  assertSafeWebUrl(client, "client_id");
  assertSafeWebUrl(returnUri, "return_uri");

  const foundApp = await (options.getLoginApp ?? getLoginApp)(
    normalizedClientId,
  );
  const registered = foundApp ? withExampleLoginAppLogo(foundApp) : null;
  if (registered && !registered.identityAvailable) {
    throw new LoginRequestError(
      "This Login with Atmosphere environment is not linked to a live app profile.",
      403,
    );
  }
  const app = registered ?? appFromClientId(normalizedClientId);
  if (app.loginAvailability !== "available") {
    throw new LoginRequestError(
      "This app is not available for Login with Atmosphere.",
      403,
    );
  }
  if (app.status === "blocked") {
    throw new LoginRequestError(
      "This app is blocked and cannot use Login with Atmosphere.",
      403,
    );
  }

  const exactAllowed = app.allowedReturnUris.some((value) => {
    try {
      return normalizeHref(new URL(value)) === normalizedReturn;
    } catch {
      return false;
    }
  });
  const dynamicAllowed = !registered &&
    loopbackDevClientAllowsReturn(client, returnUri);

  if (!exactAllowed && !dynamicAllowed) {
    throw new LoginRequestError(
      registered
        ? "return_uri must exactly match an allowed return URI for this registered app"
        : "return_uri is not allowed for this client_id",
      403,
    );
  }

  return { app, returnUri };
}

export async function signLoginSelection(input: {
  app: LoginApp;
  did: string;
  handle: string;
  issuer?: string;
  pdsUrl?: string | null;
  returnUri: string;
  state: string;
  scope?: string | null;
}): Promise<{ token: string; payload: LoginSelectionPayload }> {
  if (
    !input.app.identityAvailable ||
    input.app.loginAvailability !== "available" ||
    input.app.status === "blocked"
  ) {
    throw new LoginRequestError(
      "This app cannot use Login with Atmosphere.",
      403,
    );
  }
  if (!OAUTH_PRIVATE_JWK || !OAUTH_KID) {
    throw new LoginRequestError(
      "Login with Atmosphere signing is not configured",
      503,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const issuer = input.issuer ?? siteOrigin();
  const payload: LoginSelectionPayload = {
    iss: issuer,
    aud: input.app.clientId,
    sub: input.did,
    handle: input.handle,
    return_uri: input.returnUri,
    state: input.state,
    app_name: input.app.appName,
    iat: now,
    exp: now + SELECTION_TOKEN_TTL_SEC,
    jti: randomB64u(16),
  };
  if (input.scope) payload.scope = input.scope;
  if (input.pdsUrl) payload.pds_url = input.pdsUrl;
  const privateKey = await loadClientPrivateKey(OAUTH_PRIVATE_JWK);
  const token = await signEs256({
    header: { typ: "atmosphere-login+jwt", kid: OAUTH_KID },
    payload: payload as unknown as Record<string, unknown>,
    privateKey,
  });
  return { token, payload };
}

export async function verifyLoginSelectionToken(
  token: string,
): Promise<LoginSelectionPayload | null> {
  const result = await verifyLoginSelectionTokenDetailed(token);
  return result.ok ? result.claims : null;
}

export async function verifyLoginSelectionTokenDetailed(
  token: string,
  expected?: {
    expectedIssuer?: string;
    expectedAudience?: string;
    expectedState?: string;
    expectedReturnUri?: string;
    replayStore?: AtmosphereSelectionReplayStore;
  },
): Promise<AtmosphereSelectionVerificationResult> {
  if (!OAUTH_PUBLIC_JWK) {
    return {
      ok: false,
      error: "Login with Atmosphere verification is not configured",
    };
  }
  const publicJwk = parseJwkEnv("OAUTH_PUBLIC_JWK", OAUTH_PUBLIC_JWK);
  const replayStore = expected?.replayStore;
  const result = await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    expectedIssuer: expected?.expectedIssuer,
    expectedAudience: expected?.expectedAudience,
    expectedState: expected?.expectedState,
    expectedReturnUri: expected?.expectedReturnUri,
  });
  if (!result.ok) return result;
  if (
    !expected?.expectedIssuer && !isTrustedAtmosphereOrigin(result.claims.iss)
  ) {
    return {
      ok: false,
      error: "issuer mismatch",
      claims: result.claims,
    };
  }
  if (replayStore) {
    const consumed = replayStore.consume
      ? await replayStore.consume(result.claims.jti, result.claims.exp)
      : !await replayStore.has(result.claims.jti);
    if (!consumed) {
      return {
        ok: false,
        error: "replayed token",
        claims: result.claims,
      };
    }
    if (!replayStore.consume) {
      await replayStore.add(result.claims.jti, result.claims.exp);
    }
  }
  return result;
}

export async function recordLoginSelection(input: {
  clientId: string;
  did: string;
  handle: string;
}): Promise<void> {
  const now = Date.now();
  await withDb(async (c) => {
    await c.execute({
      sql: `
        INSERT INTO login_app_connection (
          client_id, did, handle, selected_count, first_selected_at,
          last_selected_at
        ) VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT(client_id, did) DO UPDATE SET
          handle = excluded.handle,
          selected_count = login_app_connection.selected_count + 1,
          last_selected_at = excluded.last_selected_at
      `,
      args: [input.clientId, input.did, input.handle, now, now],
    });
  });
}

export async function listLoginConnectionsForAccount(
  did: string,
): Promise<LoginConnection[]> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT
          conn.client_id,
          conn.handle,
          conn.selected_count,
          conn.first_selected_at,
          conn.last_selected_at,
          app.*,
          profile.id AS live_profile_id,
          profile.canonical_uri AS live_profile_uri,
          profile.slug AS live_profile_slug,
          profile.name AS live_profile_name,
          profile.primary_url AS live_profile_homepage,
          profile.icon_url AS live_profile_logo_uri,
          profile.updated_at AS live_profile_updated_at
        FROM login_app_connection conn
        LEFT JOIN login_app app ON app.client_id = conn.client_id
        LEFT JOIN app_listing profile
          ON app.link_status = 'linked'
          AND profile.canonical_uri = app.app_profile_uri
          AND profile.deleted_at IS NULL
          AND (
            profile.product_did = app.app_did OR
            profile.profile_did = app.app_did OR
            profile.legacy_profile_did = app.app_did
          )
        WHERE conn.did = ?
        ORDER BY conn.last_selected_at DESC
        LIMIT 25
      `,
      args: [did],
    });
    return result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      const fallback = appFromClientId(String(r.client_id));
      const profile = typeof r.live_profile_id === "string" &&
          typeof r.app_did === "string" &&
          typeof r.live_profile_uri === "string" &&
          typeof r.live_profile_slug === "string" &&
          typeof r.live_profile_name === "string"
        ? loginAppProfileIdentityFromListing(r.app_did, {
          id: r.live_profile_id,
          canonicalUri: r.live_profile_uri,
          slug: r.live_profile_slug,
          name: r.live_profile_name,
          primaryUrl: typeof r.live_profile_homepage === "string"
            ? r.live_profile_homepage
            : null,
          iconUrl: typeof r.live_profile_logo_uri === "string"
            ? r.live_profile_logo_uri
            : null,
          updatedAt: Number(r.live_profile_updated_at) || 0,
        })
        : null;
      const registered = typeof r.app_name === "string"
        ? rowToLoginApp(
          profile && rowIdentityChanged(r, profile)
            ? {
              ...r,
              status: loginAppStatusAfterProfileIdentityChange(
                readStatus(r.status),
                String(r.client_id),
                jsonArray(r.allowed_return_uris),
              ),
            }
            : r,
          profile,
        )
        : null;
      return {
        clientId: String(r.client_id),
        appName: registered?.identityAvailable
          ? registered.appName
          : fallback.appName,
        appUri: registered?.identityAvailable
          ? registered.appUri
          : fallback.appUri,
        logoUri: registered?.identityAvailable ? registered.logoUri : null,
        status: registered?.identityAvailable
          ? registered.status
          : fallback.status,
        handle: String(r.handle),
        selectedCount: Number(r.selected_count) || 1,
        firstSelectedAt: Number(r.first_selected_at) || 0,
        lastSelectedAt: Number(r.last_selected_at) || 0,
      };
    });
  });
}

export async function deleteLoginConnectionForAccount(
  did: string,
  clientId: string,
): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql: `DELETE FROM login_app_connection WHERE did = ? AND client_id = ?`,
      args: [did, clientId],
    });
  });
}

export function appendSelectionToReturnUri(input: {
  returnUri: URL;
  clientId: string;
  did: string;
  handle: string;
  issuer?: string;
  state: string;
  token: string;
}): string {
  const url = new URL(input.returnUri);
  url.searchParams.set("iss", input.issuer ?? siteOrigin());
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("did", input.did);
  url.searchParams.set("handle", input.handle);
  url.searchParams.set("state", input.state);
  url.searchParams.set("selection_token", input.token);
  return url.toString();
}

export function decodeSelectionTokenUnsafe(token: string): unknown {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64uDecode(parts[1])));
  } catch {
    return null;
  }
}

export function atmosphereLoginClientId(): string {
  return atmosphereClientId();
}
