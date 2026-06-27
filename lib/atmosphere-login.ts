import { dbBackend, withDb } from "./db.ts";
import {
  b64uDecode,
  loadClientPrivateKey,
  parseJwkEnv,
  randomB64u,
  signEs256,
} from "./jose.ts";
import {
  type AtmosphereSelectionClaims,
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
import {
  isPrivateNetworkHostname,
  readResponseTextWithLimit,
} from "./security.ts";

const SELECTION_TOKEN_TTL_SEC = 2 * 60;
const MAX_STATE_LEN = 500;
const MAX_SCOPE_LEN = 1000;
const MAX_APP_NAME_LEN = 80;
const MAX_URL_LEN = 2048;
const MAX_ALLOWED_RETURN_URIS = 20;
const MAX_REVIEW_NOTES_LEN = 2000;
export const ATMOSPHERE_LOGIN_MANIFEST_VERSION = "atmosphere.login.v0.1";
const ATMOSPHERE_LOGIN_MANIFEST_PATH = "/.well-known/atmosphere-login.json";
const ATMOSPHERE_LOGIN_MANIFEST_TIMEOUT_MS = 3_000;
const MAX_ATMOSPHERE_LOGIN_MANIFEST_BYTES = 64_000;

export interface LoginRequest {
  clientId: string;
  returnUri: string;
  state: string;
  scope: string | null;
}

export interface LoginApp {
  clientId: string;
  appName: string;
  appUri: string | null;
  logoUri: string | null;
  allowedReturnUris: string[];
  allowedOrigins: string[];
  status: "trusted" | "unverified" | "development" | "blocked";
  reviewStatus: LoginAppReviewStatus;
  reviewRequestedAt: number | null;
  reviewNotes: string | null;
  reviewDecisionAt: number | null;
  reviewDecisionBy: string | null;
  reviewDecisionReason: string | null;
  contactDid: string | null;
  registered: boolean;
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
  appName: string;
  clientId: string;
  appUri: string;
  logoUri?: string | null;
  allowedReturnUris: string[];
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
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rowToLoginApp(row: Record<string, unknown>): LoginApp {
  return {
    clientId: String(row.client_id),
    appName: String(row.app_name),
    appUri: typeof row.app_uri === "string" ? row.app_uri : null,
    logoUri: typeof row.logo_uri === "string" ? row.logo_uri : null,
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
    contactDid: typeof row.contact_did === "string" ? row.contact_did : null,
    registered: true,
  };
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
  const isReferenceApp = isDev &&
    client.pathname === "/examples/atmosphere-login/client-metadata.json";
  return {
    clientId,
    appName: isReferenceApp
      ? "Atmosphere Login reference app"
      : isDev
      ? "Development app"
      : client.hostname,
    appUri: isReferenceApp
      ? new URL("/examples/atmosphere-login/app", client.origin).toString()
      : client.origin,
    logoUri: isReferenceApp
      ? new URL("/union.svg", client.origin).toString()
      : null,
    allowedReturnUris: [],
    allowedOrigins: [],
    status: isDev ? "development" : "unverified",
    reviewStatus: "none",
    reviewRequestedAt: null,
    reviewNotes: null,
    reviewDecisionAt: null,
    reviewDecisionBy: null,
    reviewDecisionReason: null,
    contactDid: null,
    registered: false,
  };
}

export function readLoginRequest(url: URL): LoginRequest {
  const clientId = url.searchParams.get("client_id")?.trim();
  const returnUri = url.searchParams.get("return_uri")?.trim() ??
    url.searchParams.get("redirect_uri")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const scope = url.searchParams.get("scope")?.trim() || null;
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

export function loginRequestToPath(req: LoginRequest): string {
  const params = new URLSearchParams({
    client_id: req.clientId,
    return_uri: req.returnUri,
    state: req.state,
  });
  if (req.scope) params.set("scope", req.scope);
  return `/login/select?${params.toString()}`;
}

export async function getLoginApp(
  clientId: string,
): Promise<LoginApp | null> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `SELECT * FROM login_app WHERE client_id = ?`,
      args: [clientId],
    });
    if (result.rows.length === 0) return null;
    return rowToLoginApp(result.rows[0] as Record<string, unknown>);
  });
}

export async function listLoginAppsForOwner(
  ownerDid: string,
): Promise<LoginApp[]> {
  return await withDb(async (c) => {
    const appNameOrder = dbBackend() === "neon"
      ? "lower(app_name)"
      : "app_name COLLATE NOCASE";
    const result = await c.execute({
      sql: `
        SELECT * FROM login_app
        WHERE contact_did = ?
        ORDER BY updated_at DESC, ${appNameOrder}
      `,
      args: [ownerDid],
    });
    return result.rows.map((row) =>
      rowToLoginApp(row as Record<string, unknown>)
    );
  });
}

export async function getLoginAppForOwner(
  ownerDid: string,
  clientId: string,
): Promise<LoginApp | null> {
  const app = await getLoginApp(clientId);
  if (!app || app.contactDid !== ownerDid) return null;
  return app;
}

export async function listLoginAppsForTrustReview(): Promise<LoginApp[]> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT * FROM login_app
        WHERE review_status = 'requested'
        ORDER BY review_requested_at ASC, updated_at ASC
      `,
      args: [],
    });
    return result.rows.map((row) =>
      rowToLoginApp(row as Record<string, unknown>)
    );
  });
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

export async function upsertLoginApp(app: {
  clientId: string;
  appName: string;
  appUri?: string | null;
  logoUri?: string | null;
  allowedReturnUris: string[];
  allowedOrigins?: string[];
  status?: LoginApp["status"];
  contactDid?: string | null;
}): Promise<void> {
  const now = Date.now();
  await withDb(async (c) => {
    await c.execute({
      sql: `
        INSERT INTO login_app (
          client_id, app_name, app_uri, logo_uri, allowed_return_uris,
          allowed_origins, status, contact_did, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(client_id) DO UPDATE SET
          app_name = excluded.app_name,
          app_uri = excluded.app_uri,
          logo_uri = excluded.logo_uri,
          allowed_return_uris = excluded.allowed_return_uris,
          allowed_origins = excluded.allowed_origins,
          status = excluded.status,
          contact_did = excluded.contact_did,
          updated_at = excluded.updated_at
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
        now,
        now,
      ],
    });
  });
}

export async function registerLoginAppForOwner(
  ownerDid: string,
  input: LoginAppRegistrationInput,
): Promise<LoginApp> {
  const owner = ownerDid.trim();
  if (!owner) {
    throw new LoginRequestError("signed-in account is required", 401);
  }

  const appName = normalizeAppName(input.appName);
  const clientId = normalizeRegistrationUrl(input.clientId, "client ID", true);
  const appUri = normalizeRegistrationUrl(input.appUri, "homepage URL", true);
  const logoUri = normalizeRegistrationUrl(
    input.logoUri ?? "",
    "logo URL",
    false,
  );
  const allowedReturnUris = normalizeAllowedReturnUris(
    input.allowedReturnUris,
  );

  const existing = await getLoginApp(clientId);
  if (existing && existing.contactDid !== owner) {
    throw new LoginRequestError(
      existing.contactDid
        ? "This client ID is already registered to another account."
        : "This client ID is already registered. Contact Atmosphere if you need ownership moved.",
      409,
    );
  }

  const changed = existing
    ? registrationChanged(existing, {
      appName,
      appUri,
      logoUri,
      allowedReturnUris,
    })
    : false;
  const status = existing?.status === "blocked"
    ? "blocked"
    : existing && !changed
    ? existing.status
    : defaultRegistrationStatus(clientId, allowedReturnUris);

  await upsertLoginApp({
    clientId,
    appName,
    appUri,
    logoUri,
    allowedReturnUris,
    allowedOrigins: [],
    status,
    contactDid: owner,
  });

  if (
    existing && changed &&
    (existing.status === "trusted" || existing.reviewStatus === "approved" ||
      existing.reviewStatus === "rejected")
  ) {
    await resetLoginAppReviewState(clientId);
  }

  const registered = await getLoginApp(clientId);
  if (!registered) {
    throw new LoginRequestError("App registration could not be saved", 500);
  }
  return registered;
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
  const now = Date.now();
  await withDb(async (c) => {
    await c.execute({
      sql: `
        UPDATE login_app
        SET review_status = 'requested',
            review_requested_at = ?,
            review_notes = ?,
            review_decision_at = NULL,
            review_decision_by = NULL,
            review_decision_reason = NULL,
            updated_at = ?
        WHERE client_id = ? AND contact_did = ?
      `,
      args: [now, reviewNotes, now, clientId, ownerDid],
    });
  });
  const updated = await getLoginAppForOwner(ownerDid, clientId);
  if (!updated) throw new LoginRequestError("App registration not found", 404);
  return updated;
}

export async function moderateLoginAppTrustReview(input: {
  clientId: string;
  adminDid: string;
  action: "approve" | "reject" | "block";
  reason?: string | null;
}): Promise<LoginApp> {
  const reason = normalizeDecisionReason(input.reason ?? "");
  const now = Date.now();
  const status: LoginApp["status"] = input.action === "approve"
    ? "trusted"
    : input.action === "block"
    ? "blocked"
    : "unverified";
  const reviewStatus: LoginAppReviewStatus = input.action === "approve"
    ? "approved"
    : "rejected";
  await withDb(async (c) => {
    await c.execute({
      sql: `
        UPDATE login_app
        SET status = ?,
            review_status = ?,
            review_decision_at = ?,
            review_decision_by = ?,
            review_decision_reason = ?,
            updated_at = ?
        WHERE client_id = ?
      `,
      args: [
        status,
        reviewStatus,
        now,
        input.adminDid,
        reason,
        now,
        input.clientId,
      ],
    });
  });
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

function normalizeAppName(value: string): string {
  const appName = value.trim().replace(/\s+/g, " ");
  if (!appName) throw new LoginRequestError("App name is required");
  if (appName.length > MAX_APP_NAME_LEN) {
    throw new LoginRequestError(
      `App name must be ${MAX_APP_NAME_LEN} characters or fewer`,
    );
  }
  return appName;
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
    appName: string;
    appUri: string;
    logoUri: string | null;
    allowedReturnUris: string[];
  },
): boolean {
  return app.appName !== next.appName ||
    app.appUri !== next.appUri ||
    app.logoUri !== next.logoUri ||
    JSON.stringify(app.allowedReturnUris) !==
      JSON.stringify(next.allowedReturnUris);
}

async function resetLoginAppReviewState(clientId: string): Promise<void> {
  const now = Date.now();
  await withDb(async (c) => {
    await c.execute({
      sql: `
        UPDATE login_app
        SET review_status = 'none',
            review_requested_at = NULL,
            review_notes = NULL,
            review_decision_at = NULL,
            review_decision_by = NULL,
            review_decision_reason = NULL,
            updated_at = ?
        WHERE client_id = ?
      `,
      args: [now, clientId],
    });
  });
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
    status: app.status === "trusted"
      ? "pass"
      : app.status === "blocked"
      ? "fail"
      : "warn",
    body: app.status === "trusted"
      ? "This app is trusted in the picker."
      : app.status === "blocked"
      ? "This app cannot use Atmosphere Login."
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
  if (app.status === "blocked") {
    return {
      state: "blocked",
      label: "Blocked",
      tone: "fail",
      body: "This app cannot use Atmosphere Login until it is unblocked.",
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
        "Loopback URLs are present. Keep testing locally, then switch client ID, homepage, logo, and callbacks to HTTPS before review.",
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
): Promise<{ app: LoginApp; returnUri: URL }> {
  const client = parseAbsoluteUrl(req.clientId, "client_id");
  const returnUri = parseAbsoluteUrl(req.returnUri, "return_uri");
  assertSafeWebUrl(client, "client_id");
  assertSafeWebUrl(returnUri, "return_uri");

  const registered = await getLoginApp(req.clientId);
  const app = registered ?? appFromClientId(req.clientId);
  if (app.status === "blocked") {
    throw new LoginRequestError(
      "This app is blocked and cannot use Atmosphere Login.",
      403,
    );
  }

  const normalizedReturn = normalizeHref(new URL(returnUri));
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
  pdsUrl?: string | null;
  returnUri: string;
  state: string;
  scope?: string | null;
}): Promise<{ token: string; payload: LoginSelectionPayload }> {
  if (!OAUTH_PRIVATE_JWK || !OAUTH_KID) {
    throw new LoginRequestError(
      "Atmosphere Login signing is not configured",
      503,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: LoginSelectionPayload = {
    iss: siteOrigin(),
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
  },
): Promise<AtmosphereSelectionVerificationResult> {
  if (!OAUTH_PUBLIC_JWK) {
    return {
      ok: false,
      error: "Atmosphere Login verification is not configured",
    };
  }
  const publicJwk = parseJwkEnv("OAUTH_PUBLIC_JWK", OAUTH_PUBLIC_JWK);
  return await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    expectedIssuer: expected?.expectedIssuer ?? siteOrigin(),
    expectedAudience: expected?.expectedAudience,
    expectedState: expected?.expectedState,
    expectedReturnUri: expected?.expectedReturnUri,
  });
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
          app.app_name,
          app.app_uri,
          app.logo_uri,
          app.status
        FROM login_app_connection conn
        LEFT JOIN login_app app ON app.client_id = conn.client_id
        WHERE conn.did = ?
        ORDER BY conn.last_selected_at DESC
        LIMIT 25
      `,
      args: [did],
    });
    return result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      const fallback = appFromClientId(String(r.client_id));
      return {
        clientId: String(r.client_id),
        appName: typeof r.app_name === "string" ? r.app_name : fallback.appName,
        appUri: typeof r.app_uri === "string" ? r.app_uri : fallback.appUri,
        logoUri: typeof r.logo_uri === "string" ? r.logo_uri : null,
        status: readStatus(r.status ?? fallback.status),
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
  state: string;
  token: string;
}): string {
  const url = new URL(input.returnUri);
  url.searchParams.set("iss", siteOrigin());
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
