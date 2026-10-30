/**
 * atproto OAuth confidential web client. Implements PAR + PKCE + DPoP +
 * private_key_jwt client authentication per the atproto OAuth spec.
 *
 * https://atproto.com/specs/oauth
 *
 * Usage from routes:
 *   - startLogin(handle)         -> { redirectUrl, stateKey }
 *   - completeCallback(params)   -> session bound to a DID
 *   - getValidSession(did)       -> tokens (auto-refreshes if needed)
 *   - authedFetch(did, url, init) -> calls PDS with DPoP-bound access token
 *
 * Stores all flow + session state in Turso.
 */
import { withDb } from "./db.ts";
import {
  generateEs256KeyPair,
  importEs256PrivateKey,
  loadClientPrivateKey,
  publicJwkOnly,
  randomB64u,
  sha256B64u,
  signEs256,
} from "./jose.ts";
import {
  type AuthServerMetadata,
  discoverAuthServer,
  normalizeServiceEndpoint,
  resolveIdentity,
} from "./identity.ts";
import {
  ATPROTO_FETCH_TIMEOUT_MS,
  clientId as defaultMetadataClientId,
  IS_DEV,
  OAUTH_KID,
  OAUTH_PRIVATE_JWK,
  redirectUri as defaultRedirectUri,
} from "./env.ts";
import {
  DEFAULT_OAUTH_SCOPE,
  hasOAuthCapabilities,
  IDENTITY_OAUTH_SCOPE,
  type OAuthCapability,
  scopeCoversScope,
  scopeForCapabilities,
  scopeSafelyCoversScope,
  scopeTokens,
} from "./oauth-scopes.ts";
import type { OAuthAction } from "./oauth-action.ts";
import { hasValidLoginSelectionContinuationBinding } from "./oauth-continuation.ts";
import { readResponseTextWithLimit } from "./security.ts";
import { currentOAuthGrantContext } from "./oauth-grant-context.ts";
import { decryptStoredSecret, encryptStoredSecret } from "./secret-storage.ts";
import { OAuthStateCleanup } from "./oauth-state-cleanup.ts";

const STATE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_THRESHOLD_MS = 60 * 1000;
const IDENTITY_RECHECK_INTERVAL_MS = 10 * 60 * 1000;
const MAX_OAUTH_SERVER_RESPONSE_BYTES = 64 * 1024;
const oauthStateCleanup = new OAuthStateCleanup();

export class OAuthNotConfiguredError extends Error {
  constructor() {
    super(
      "OAuth is not configured. Set OAUTH_PRIVATE_JWK and OAUTH_KID (run `deno task gen:oauth-key`).",
    );
    this.name = "OAuthNotConfiguredError";
  }
}

export interface OAuthClientOptions {
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  /** Allowlisted product capabilities attached to the action that started
   * authorization. Existing granted scopes are retained during upgrades. */
  capabilities?: readonly OAuthCapability[];
  /** Defaults to true for capability-driven site authorization. The hosted
   * login picker sets an explicit identity-only scope and does not use this. */
  preserveExistingScopes?: boolean;
  persistSession?: boolean;
  continuation?: "login_selection";
  /** Restore the alternate-account chooser if authorization is interrupted. */
  chooseAnotherAccount?: boolean;
  /** Context retained only to explain a partial/conflicting grant on retry. */
  action?: OAuthAction;
  targetName?: string;
  /** Server-derived browser grant to upgrade. Never accept this from a form
   * or query parameter; routes derive it from the active or signed remembered
   * account. */
  grantId?: string;
}

interface OAuthClientConfig {
  metadataClientId: string;
  redirectUri: string;
  scope: string;
}

function shouldPersistOAuthSession(
  requested: boolean | undefined,
  continuation: "login_selection" | undefined,
): boolean {
  return requested !== false && continuation !== "login_selection";
}

export function shouldPersistOAuthSessionForTest(
  requested: boolean | undefined,
  continuation: "login_selection" | undefined,
): boolean {
  return shouldPersistOAuthSession(requested, continuation);
}

function persistentExistingSessionPolicy(
  capabilities: readonly OAuthCapability[] | undefined,
  persistSession: boolean,
  preserveExistingScopes: boolean | undefined,
): { validateForReplacement: boolean; unionValidScope: boolean } {
  const addsProductCapability =
    capabilities?.some((capability) => capability !== "identity") ?? false;
  return {
    // Even an identity-only callback needs a baseline for replacing the exact
    // stale row it observed. Otherwise downgrade protection can retain a
    // revoked broader grant forever.
    validateForReplacement: persistSession,
    // Identity-only login stays truly identity-only. Existing scopes are
    // carried forward solely for product-capability upgrades.
    unionValidScope: persistSession && addsProductCapability &&
      preserveExistingScopes !== false,
  };
}

export function persistentExistingSessionPolicyForTest(
  capabilities: readonly OAuthCapability[] | undefined,
  persistSession: boolean,
  preserveExistingScopes: boolean | undefined,
): { validateForReplacement: boolean; unionValidScope: boolean } {
  return persistentExistingSessionPolicy(
    capabilities,
    persistSession,
    preserveExistingScopes,
  );
}

function oauthClientConfig(
  options: OAuthClientOptions | null = null,
): OAuthClientConfig {
  return {
    metadataClientId: options?.clientId ?? defaultMetadataClientId(),
    redirectUri: options?.redirectUri ?? defaultRedirectUri(),
    scope: options?.scope ?? DEFAULT_OAUTH_SCOPE,
  };
}

function isLoopbackRedirectUri(uri: string): boolean {
  if (!IS_DEV) return false;
  try {
    const url = new URL(uri);
    return url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "::1" ||
        url.hostname === "[::1]");
  } catch {
    return false;
  }
}

function isPublicLocalhostOAuthClient(config: OAuthClientConfig): boolean {
  return isLoopbackRedirectUri(config.redirectUri);
}

function isPublicLocalhostOAuthClientId(clientId: string): boolean {
  try {
    const id = new URL(clientId);
    return id.protocol === "http:" && id.hostname === "localhost";
  } catch {
    return false;
  }
}

function oauthClientId(config: OAuthClientConfig): string {
  if (!isPublicLocalhostOAuthClient(config)) return config.metadataClientId;

  /**
   * AT Protocol has a special development-only client_id escape hatch:
   * `http://localhost` with no port/path, plus query params declaring
   * redirect URI and scope. The redirect URI itself should be loopback IP
   * based (`127.0.0.1`) to satisfy RFC 8252.
   *
   * This is a public/native OAuth client, so PAR and token requests must not
   * include private_key_jwt client assertions in this mode.
   */
  const id = new URL("http://localhost/");
  id.searchParams.set("redirect_uri", config.redirectUri);
  id.searchParams.set("scope", config.scope);
  return id.toString();
}

export function isOAuthConfigured(
  options: OAuthClientOptions | null = null,
): boolean {
  const config = oauthClientConfig(options);
  return isPublicLocalhostOAuthClient(config) ||
    !!(OAUTH_PRIVATE_JWK && OAUTH_KID);
}

function ensureConfigured(options: OAuthClientOptions | null = null): void {
  if (!isOAuthConfigured(options)) throw new OAuthNotConfiguredError();
}

/**
 * Intent carried through the OAuth dance — tells the callback whether
 * the user clicked a generic "Sign in" CTA (default = user account) or
 * a "Submit your project" CTA (= project account). The callback uses
 * this to auto-classify a freshly-signed-in DID instead of bouncing
 * the user through a separate chooser screen.
 *
 * If the DID already has a type assigned, the intent is ignored.
 */
export type SignInIntent = "user" | "project";

interface FlowState {
  state: string;
  /** SHA-256 of the secret held only in the initiating browser's short-lived
   * state-specific cookie. This prevents login CSRF/session swapping when an
   * otherwise valid authorization response is replayed in another browser. */
  browserBindingHash: string;
  pkceVerifier: string;
  dpopPrivateJwk: JsonWebKey;
  dpopPublicJwk: JsonWebKey;
  oauthClientId?: string;
  redirectUri?: string;
  scope?: string;
  requiredScope?: string;
  capabilities?: OAuthCapability[];
  /** Hash of an unusable stored session observed when this upgrade began.
   * A sufficient callback may replace that exact stale row without allowing
   * an unrelated concurrent authorization to be overwritten. */
  replaceableSessionHash?: string;
  persistSession?: boolean;
  asMeta: AuthServerMetadata;
  did?: string;
  handle?: string;
  pdsUrl: string;
  prompt?: "create";
  continuation?: "login_selection";
  chooseAnotherAccount?: boolean;
  returnTo?: string;
  intent?: SignInIntent;
  action?: OAuthAction;
  targetName?: string;
  asNonce?: string;
  /** Browser/device grant being created or upgraded. */
  grantId?: string;
}

export interface SessionData {
  /** Opaque browser/device grant identifier. Legacy fixtures may omit it. */
  grantId?: string;
  did: string;
  handle: string;
  pdsUrl: string;
  asIssuer: string;
  /** Exact OAuth client_id that received this refresh token. Older rows were
   * issued by the site's default client before per-origin clients existed. */
  oauthClientId?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms epoch
  dpopPrivateJwk: JsonWebKey;
  dpopPublicJwk: JsonWebKey;
  asNonce?: string;
  pdsNonce?: string;
  identityCheckedAt?: number;
  /** Actual scopes returned by the authorization server. Rows created before
   * progressive authorization omit this field. Those grants are treated as
   * identity-only because older picker flows could also request `atproto`
   * alone; a write action will safely request a one-time upgrade. */
  scope?: string;
}

/* ---------------- DPoP ---------------- */

interface DpopProofOptions {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  htm: string;
  htu: string;
  nonce?: string;
  accessToken?: string;
}

/** RFC 9449 binds a proof to the request URI without its query or fragment. */
export function normalizeDpopHtu(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function buildDpopProof(opts: DpopProofOptions): Promise<string> {
  const privateKey = await importEs256PrivateKey(opts.privateJwk);
  const payload: Record<string, unknown> = {
    jti: randomB64u(16),
    htm: opts.htm,
    htu: normalizeDpopHtu(opts.htu),
    iat: Math.floor(Date.now() / 1000),
  };
  if (opts.nonce) payload.nonce = opts.nonce;
  if (opts.accessToken) payload.ath = await sha256B64u(opts.accessToken);
  return signEs256({
    header: { typ: "dpop+jwt", jwk: publicJwkOnly(opts.publicJwk) },
    payload,
    privateKey,
  });
}

/* ---------------- Client assertion (private_key_jwt) ---------------- */

async function buildClientAssertion(
  audience: string,
  clientId: string,
): Promise<string> {
  if (isPublicLocalhostOAuthClientId(clientId)) {
    throw new Error("local OAuth client does not use client assertions");
  }
  if (!OAUTH_PRIVATE_JWK || !OAUTH_KID) throw new OAuthNotConfiguredError();
  const privateKey = await loadClientPrivateKey(OAUTH_PRIVATE_JWK!);
  const iat = Math.floor(Date.now() / 1000);
  return signEs256({
    header: { kid: OAUTH_KID! },
    payload: {
      iss: clientId,
      sub: clientId,
      aud: audience,
      jti: randomB64u(16),
      iat,
      exp: iat + 300,
    },
    privateKey,
  });
}

/* ---------------- DB-backed flow + session storage ---------------- */

async function saveFlowState(state: FlowState): Promise<void> {
  const value = await encryptStoredSecret(
    JSON.stringify(state),
    `oauth_state:${state.state}`,
  );
  await withDb(async (c) => {
    await c.execute({
      sql: `INSERT INTO oauth_state (key, value, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           expires_at = excluded.expires_at`,
      args: [state.state, value, Date.now() + STATE_TTL_MS],
    });
    await oauthStateCleanup.run(c);
  });
}

async function loadFlowState(stateKey: string): Promise<FlowState | null> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `SELECT value, expires_at FROM oauth_state WHERE key = ?`,
      args: [stateKey],
    });
    if (r.rows.length === 0) return null;
    const row = r.rows[0] as Record<string, unknown>;
    if (Number(row.expires_at) < Date.now()) {
      await c.execute({
        sql: `DELETE FROM oauth_state WHERE key = ?`,
        args: [stateKey],
      });
      return null;
    }
    const stored = String(row.value);
    const decrypted = await decryptStoredSecret(
      stored,
      `oauth_state:${stateKey}`,
    );
    if (decrypted.needsUpgrade) {
      const upgraded = await encryptStoredSecret(
        decrypted.plaintext,
        `oauth_state:${stateKey}`,
      );
      await c.execute({
        sql: `UPDATE oauth_state SET value = ? WHERE key = ? AND value = ?`,
        args: [upgraded, stateKey, stored],
      });
    }
    return JSON.parse(decrypted.plaintext) as FlowState;
  });
}

async function deleteFlowState(stateKey: string): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql: `DELETE FROM oauth_state WHERE key = ?`,
      args: [stateKey],
    });
  });
}

interface StoredSession {
  session: SessionData;
  grantId: string;
  storedValue: string;
}

export interface OAuthSessionLookupOptions {
  grantId?: string | null;
  quiet?: boolean;
}

const storedValueBySession = new WeakMap<SessionData, string>();

function requestedGrantId(options: OAuthSessionLookupOptions): string | null {
  if (options.grantId) return options.grantId;
  return currentOAuthGrantContext()?.grantId ?? null;
}

export function requestedGrantIdForTest(
  options: OAuthSessionLookupOptions = {},
): string | null {
  return requestedGrantId(options);
}

async function legacyGrantId(did: string): Promise<string> {
  return `legacy_${(await sha256B64u(`oauth-grant:${did}`)).slice(0, 32)}`;
}

async function loadGrantRow(
  c: {
    execute: (query: { sql: string; args: unknown[] }) => Promise<{
      rows: unknown[];
      rowsAffected?: number | bigint;
    }>;
  },
  did: string,
  grantId: string,
): Promise<StoredSession | null> {
  const result = await c.execute({
    sql: `SELECT value FROM oauth_grant WHERE grant_id = ? AND did = ?`,
    args: [grantId, did],
  });
  if (result.rows.length === 0) return null;
  const storedValue = String(
    (result.rows[0] as Record<string, unknown>).value,
  );
  const decrypted = await decryptStoredSecret(
    storedValue,
    `oauth_grant:${grantId}`,
  );
  let currentStoredValue = storedValue;
  if (decrypted.needsUpgrade) {
    const upgraded = await encryptStoredSecret(
      decrypted.plaintext,
      `oauth_grant:${grantId}`,
    );
    const changed = await c.execute({
      sql: `UPDATE oauth_grant SET value = ?, updated_at = ?
        WHERE grant_id = ? AND did = ? AND value = ?`,
      args: [upgraded, Date.now(), grantId, did, storedValue],
    });
    if (Number(changed.rowsAffected ?? 0) === 1) currentStoredValue = upgraded;
  }
  const session = JSON.parse(decrypted.plaintext) as SessionData;
  session.grantId = grantId;
  storedValueBySession.set(session, currentStoredValue);
  return { session, grantId, storedValue: currentStoredValue };
}

async function migrateLegacySession(
  c: Parameters<typeof loadGrantRow>[0],
  did: string,
  appSessionId: string | null,
): Promise<StoredSession | null> {
  if (!legacyGrantMigrationPurpose(appSessionId)) {
    // Pre-grant-ID browser sessions all shared one DID row. Reusing it would
    // preserve that cross-device coupling, so browsers reconnect once and
    // receive independent grants. Only explicit service callers may migrate.
    return null;
  }
  const legacy = await c.execute({
    sql: `SELECT value, expires_at FROM oauth_session WHERE did = ?`,
    args: [did],
  });
  if (legacy.rows.length === 0) return null;
  const row = legacy.rows[0] as Record<string, unknown>;
  const legacyValue = String(row.value);
  const decrypted = await decryptStoredSecret(
    legacyValue,
    `oauth_session:${did}`,
  );
  const grantId = await legacyGrantId(did);
  const session = JSON.parse(decrypted.plaintext) as SessionData;
  session.grantId = grantId;
  const encrypted = await encryptStoredSecret(
    JSON.stringify(session),
    `oauth_grant:${grantId}`,
  );
  const now = Date.now();
  await c.execute({
    sql: `INSERT INTO oauth_grant
      (grant_id, did, purpose, value, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(grant_id) DO NOTHING`,
    args: [
      grantId,
      did,
      "service",
      encrypted,
      Number(row.expires_at),
      now,
      now,
    ],
  });
  const purposeRow = await c.execute({
    sql: `SELECT purpose FROM oauth_grant WHERE grant_id = ? AND did = ?`,
    args: [grantId, did],
  });
  if (
    purposeRow.rows.length === 0 ||
    String((purposeRow.rows[0] as Record<string, unknown>).purpose) !==
      "service"
  ) return null;
  await c.execute({
    sql: `DELETE FROM oauth_session WHERE did = ? AND value = ?`,
    args: [did, legacyValue],
  });
  return await loadGrantRow(c, did, grantId);
}

export function legacyGrantMigrationPurposeForTest(
  appSessionId: string | null,
): "service" | null {
  return legacyGrantMigrationPurpose(appSessionId);
}

function legacyGrantMigrationPurpose(
  appSessionId: string | null,
): "service" | null {
  return appSessionId ? null : "service";
}

async function loadStoredSession(
  did: string,
  options: OAuthSessionLookupOptions = {},
): Promise<StoredSession | null> {
  return await withDb(async (c) => {
    const explicitGrantId = requestedGrantId(options);
    if (explicitGrantId) {
      return await loadGrantRow(c, did, explicitGrantId);
    }
    const context = currentOAuthGrantContext();
    if (context?.appSessionId) {
      return await migrateLegacySession(c, did, context.appSessionId);
    }
    const service = await c.execute({
      sql: `SELECT grant_id FROM oauth_grant
        WHERE did = ? AND purpose = 'service'
        ORDER BY updated_at DESC LIMIT 1`,
      args: [did],
    });
    if (service.rows.length > 0) {
      return await loadGrantRow(
        c,
        did,
        String((service.rows[0] as Record<string, unknown>).grant_id),
      );
    }
    return await migrateLegacySession(c, did, null);
  });
}

export async function loadSession(
  did: string,
  options: OAuthSessionLookupOptions = {},
): Promise<SessionData | null> {
  return (await loadStoredSession(did, options))?.session ?? null;
}

async function insertSessionIfAbsent(session: SessionData): Promise<boolean> {
  if (!session.grantId) throw new Error("OAuth session is missing a grant ID");
  const value = await encryptStoredSecret(
    JSON.stringify(session),
    `oauth_grant:${session.grantId}`,
  );
  return await withDb(async (c) => {
    const now = Date.now();
    const r = await c.execute({
      sql: `INSERT INTO oauth_grant
        (grant_id, did, purpose, value, expires_at, created_at, updated_at)
        VALUES (?, ?, 'browser', ?, ?, ?, ?)
        ON CONFLICT(grant_id) DO NOTHING`,
      args: [
        session.grantId,
        session.did,
        value,
        session.expiresAt,
        now,
        now,
      ],
    });
    if (Number(r.rowsAffected ?? 0) === 1) {
      storedValueBySession.set(session, value);
    }
    return Number(r.rowsAffected ?? 0) === 1;
  });
}

async function replaceSessionIfUnchanged(
  session: SessionData,
  expectedStoredValue: string,
): Promise<boolean> {
  if (!session.grantId) return false;
  const value = await encryptStoredSecret(
    JSON.stringify(session),
    `oauth_grant:${session.grantId}`,
  );
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `UPDATE oauth_grant
         SET value = ?, expires_at = ?, updated_at = ?
         WHERE grant_id = ? AND did = ? AND value = ?`,
      args: [
        value,
        session.expiresAt,
        Date.now(),
        session.grantId,
        session.did,
        expectedStoredValue,
      ],
    });
    const replaced = Number(result.rowsAffected ?? 0) === 1;
    if (replaced) storedValueBySession.set(session, value);
    return replaced;
  });
}

async function deleteSessionIfUnchangedOnClient(
  c: {
    execute: (query: { sql: string; args: unknown[] }) => Promise<{
      rowsAffected?: number | bigint;
    }>;
  },
  grantId: string,
  did: string,
  expectedStoredValue: string,
): Promise<boolean> {
  const result = await c.execute({
    sql: `DELETE FROM oauth_grant
      WHERE grant_id = ? AND did = ? AND value = ?`,
    args: [grantId, did, expectedStoredValue],
  });
  const deleted = Number(result.rowsAffected ?? 0) === 1;
  if (deleted) {
    await c.execute({
      sql: `DELETE FROM app_session_grant WHERE grant_id = ?`,
      args: [grantId],
    });
  }
  return deleted;
}

async function deleteSessionIfUnchanged(
  session: SessionData,
): Promise<boolean> {
  if (!session.grantId) return false;
  const expectedStoredValue = storedValueBySession.get(session) ??
    JSON.stringify(session);
  return await withDb(async (c) =>
    await deleteSessionIfUnchangedOnClient(
      c,
      session.grantId!,
      session.did,
      expectedStoredValue,
    )
  );
}

export async function deleteSessionIfUnchangedForTest(
  c: {
    execute: (query: { sql: string; args: unknown[] }) => Promise<{
      rowsAffected?: number | bigint;
    }>;
  },
  session: SessionData,
): Promise<boolean> {
  return await deleteSessionIfUnchangedOnClient(
    c,
    session.grantId ?? "test-grant",
    session.did,
    JSON.stringify(session),
  );
}

function oauthClientIdForSession(session: SessionData): string {
  if (session.oauthClientId) return session.oauthClientId;
  // Production's legacy default is the site metadata URL. In local loopback
  // mode the virtual client_id also embeds the granted scope, so retain it
  // when reconstructing the safest available default for an older row.
  return oauthClientId(oauthClientConfig({
    scope: grantedScopeForSession(session),
  }));
}

export function oauthClientIdForSessionForTest(session: SessionData): string {
  return oauthClientIdForSession(session);
}

function sameRefreshAuthorization(
  left: SessionData,
  right: SessionData,
): boolean {
  return left.refreshToken === right.refreshToken &&
    left.asIssuer === right.asIssuer &&
    oauthClientIdForSession(left) === oauthClientIdForSession(right) &&
    JSON.stringify(left.dpopPublicJwk) === JSON.stringify(right.dpopPublicJwk);
}

export function sameRefreshAuthorizationForTest(
  left: SessionData,
  right: SessionData,
): boolean {
  return sameRefreshAuthorization(left, right);
}

async function saveRefreshedSession(
  previous: SessionData,
  refreshed: SessionData,
): Promise<SessionData> {
  let expected = previous;
  let next = refreshed;
  for (let attempt = 0; attempt < 4; attempt++) {
    const expectedStoredValue = storedValueBySession.get(expected) ??
      JSON.stringify(expected);
    if (await replaceSessionIfUnchanged(next, expectedStoredValue)) {
      return next;
    }
    const current = await loadStoredSession(previous.did, {
      grantId: previous.grantId,
    });
    if (!current) throw new Error("OAuth session was removed during refresh");
    if (!sameRefreshAuthorization(current.session, previous)) {
      // A callback or another refresh installed newer authorization. Never
      // replace it with the result of this now-stale refresh request.
      return current.session;
    }
    expected = current.session;
    next = {
      ...current.session,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      asNonce: refreshed.asNonce,
      scope: refreshed.scope,
      oauthClientId: refreshed.oauthClientId,
    };
  }
  return (await loadSession(previous.did, { grantId: previous.grantId })) ??
    next;
}

type CallbackSessionSaveResult = "saved" | "narrower" | "conflict";

function classifySessionScopeReplacement(
  currentScope: string,
  incomingScope: string,
): "replace" | "narrower" | "conflict" {
  if (scopeSafelyCoversScope(incomingScope, currentScope)) return "replace";
  if (scopeSafelyCoversScope(currentScope, incomingScope)) return "narrower";
  return "conflict";
}

export function classifySessionScopeReplacementForTest(
  currentScope: string,
  incomingScope: string,
): "replace" | "narrower" | "conflict" {
  return classifySessionScopeReplacement(currentScope, incomingScope);
}

/**
 * Install a callback's token grant without letting two simultaneous upgrades
 * overwrite each other. The serialized row is the compare-and-swap version,
 * so this remains atomic on every supported database without a schema change.
 */
async function saveCallbackSession(
  session: SessionData,
  replaceableSessionHash?: string,
): Promise<CallbackSessionSaveResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await loadStoredSession(session.did, {
      grantId: session.grantId,
    });
    if (!current) {
      if (await insertSessionIfAbsent(session)) return "saved";
      continue;
    }
    if (
      replaceableSessionHash &&
      await sha256B64u(current.storedValue) === replaceableSessionHash
    ) {
      if (await replaceSessionIfUnchanged(session, current.storedValue)) {
        return "saved";
      }
      continue;
    }
    const currentScope = grantedScopeForSession(current.session);
    const decision = classifySessionScopeReplacement(
      currentScope,
      session.scope ?? IDENTITY_OAUTH_SCOPE,
    );
    if (decision === "replace") {
      if (await replaceSessionIfUnchanged(session, current.storedValue)) {
        return "saved";
      }
      continue;
    }
    if (decision === "narrower") return "narrower";
    return "conflict";
  }
  // Sustained churn is handled like an incomparable grant: retain whichever
  // session won and ask the user to authorize the fresh union once more.
  return "conflict";
}

export function grantedScopeForSession(session: SessionData): string {
  return session.scope?.trim() || IDENTITY_OAUTH_SCOPE;
}

export async function deleteSession(
  did: string,
  options: OAuthSessionLookupOptions = {},
): Promise<void> {
  const stored = await loadStoredSession(did, options);
  if (!stored) return;
  await withDb(async (c) => {
    await c.execute({
      sql: `DELETE FROM app_session_grant WHERE grant_id = ?`,
      args: [stored.grantId],
    });
    await c.execute({
      sql: `DELETE FROM oauth_grant WHERE grant_id = ? AND did = ?`,
      args: [stored.grantId, did],
    });
  });
}

interface ExistingScopeUpgradeGrant {
  session: SessionData | null;
  grantId?: string;
  replaceableSessionHash?: string;
}

/**
 * Validate an existing authorization before carrying its scopes into a new
 * request. `getValidSession` may refresh the row but never calls startLogin,
 * so this does not recurse through OAuth initiation.
 *
 * If the exact row remains unusable, retain only a hash in the flow. A later
 * sufficient callback may replace that stale baseline, while a concurrent
 * callback that installs a different row remains protected by the hash.
 */
async function existingGrantForScopeUpgrade(
  did: string,
  grantId?: string,
): Promise<ExistingScopeUpgradeGrant> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await loadStoredSession(did, { grantId }).catch(() => null);
    if (!before) return { session: null };
    const valid = await getValidSession(did, {
      quiet: true,
      grantId: before.grantId,
    }).catch(() => null);
    if (valid) return { session: valid, grantId: before.grantId };
    const after = await loadStoredSession(did, {
      grantId: before.grantId,
    }).catch(() => null);
    if (!after) return { session: null };
    if (after.storedValue === before.storedValue) {
      return {
        session: null,
        grantId: after.grantId,
        replaceableSessionHash: await sha256B64u(after.storedValue),
      };
    }
  }
  // Sustained concurrent churn is not a safe source for a scope union.
  return { session: null };
}

/* ---------------- Login (PAR) ---------------- */

export async function startLogin(
  handleOrDid: string,
  returnTo?: string | null,
  intent?: SignInIntent | null,
  options: OAuthClientOptions | null = null,
): Promise<{ redirectUrl: string; state: string; browserBinding: string }> {
  ensureConfigured(options);
  const capabilities = options?.capabilities
    ? [...options.capabilities]
    : undefined;
  if (
    !hasValidLoginSelectionContinuationBinding(
      returnTo ?? null,
      options?.continuation,
      intent ?? null,
      options?.action ?? null,
      capabilities ?? ["identity"],
    )
  ) {
    throw new Error("invalid OAuth continuation binding");
  }
  const id = await resolveIdentity(handleOrDid);
  const persistSession = shouldPersistOAuthSession(
    options?.persistSession,
    options?.continuation,
  );
  // Identity-only flows must remain a true `atproto` login even when this DID
  // already has broader grants. The callback's downgrade protection retains
  // that stored broader session without re-requesting its permissions.
  const existingPolicy = persistentExistingSessionPolicy(
    capabilities,
    persistSession,
    options?.preserveExistingScopes,
  );
  const existingGrant = existingPolicy.validateForReplacement
    ? await existingGrantForScopeUpgrade(id.did, options?.grantId)
    : null;
  const existing = existingPolicy.unionValidScope
    ? existingGrant?.session ?? null
    : null;
  const requiredScope = capabilities
    ? scopeForCapabilities(capabilities)
    : undefined;
  const requestedScope = options?.scope ?? (capabilities
    ? scopeForCapabilities(
      capabilities,
      existing ? grantedScopeForSession(existing) : null,
    )
    : DEFAULT_OAUTH_SCOPE);
  const config = oauthClientConfig({ ...options, scope: requestedScope });
  const asMeta = await discoverAuthServer(id.pdsUrl);
  const clientId = oauthClientId(config);

  const dpop = await generateEs256KeyPair();
  const state = randomB64u(24);
  const browserBinding = randomB64u(32);
  const pkceVerifier = randomB64u(48);
  const grantId = persistSession
    ? existingGrant?.grantId ?? randomB64u(24)
    : undefined;

  const flow: FlowState = {
    state,
    browserBindingHash: await sha256B64u(browserBinding),
    pkceVerifier,
    dpopPrivateJwk: dpop.privateJwk,
    dpopPublicJwk: dpop.publicJwk,
    oauthClientId: clientId,
    redirectUri: config.redirectUri,
    scope: config.scope,
    requiredScope,
    capabilities,
    replaceableSessionHash: existingGrant?.replaceableSessionHash,
    persistSession,
    asMeta,
    did: id.did,
    handle: id.handle,
    pdsUrl: id.pdsUrl,
    continuation: options?.continuation,
    chooseAnotherAccount: options?.chooseAnotherAccount,
    returnTo: returnTo ?? undefined,
    intent: intent ?? undefined,
    action: options?.action,
    targetName: options?.targetName,
    grantId,
  };
  await saveFlowState(flow);

  const parRes = await pushParRequest(flow);
  const authUrl = new URL(asMeta.authorization_endpoint);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("request_uri", parRes.requestUri);

  return { redirectUrl: authUrl.toString(), state, browserBinding };
}

export class OAuthAccountCreationUnsupportedError extends Error {
  constructor(host: string) {
    super(`${host} does not advertise OAuth account creation`);
    this.name = "OAuthAccountCreationUnsupportedError";
  }
}

/**
 * Start OAuth from a host rather than an existing handle. Hosts that advertise
 * the optional OAuth `prompt=create` capability can create the account inside
 * their authorization interface and finish the same redirect flow.
 */
export async function startHostAccountCreation(
  serviceEndpoint: string,
  returnTo?: string | null,
  intent?: SignInIntent | null,
  options: OAuthClientOptions | null = null,
  continuation?: "login_selection" | null,
): Promise<{ redirectUrl: string; state: string; browserBinding: string }> {
  ensureConfigured(options);
  const capabilities = options?.capabilities
    ? [...options.capabilities]
    : undefined;
  if (
    !hasValidLoginSelectionContinuationBinding(
      returnTo ?? null,
      continuation,
      intent ?? null,
      options?.action ?? null,
      capabilities ?? ["identity"],
    )
  ) {
    throw new Error("invalid OAuth continuation binding");
  }
  const requiredScope = capabilities
    ? scopeForCapabilities(capabilities)
    : undefined;
  const requestedScope = options?.scope ?? requiredScope ??
    DEFAULT_OAUTH_SCOPE;
  const config = oauthClientConfig({ ...options, scope: requestedScope });
  const pdsUrl = normalizeServiceEndpoint(serviceEndpoint);
  const asMeta = await discoverAuthServer(pdsUrl);
  if (!asMeta.prompt_values_supported?.includes("create")) {
    throw new OAuthAccountCreationUnsupportedError(
      new URL(pdsUrl).hostname,
    );
  }
  const clientId = oauthClientId(config);
  const dpop = await generateEs256KeyPair();
  const state = randomB64u(24);
  const browserBinding = randomB64u(32);
  const pkceVerifier = randomB64u(48);
  const flow: FlowState = {
    state,
    browserBindingHash: await sha256B64u(browserBinding),
    pkceVerifier,
    dpopPrivateJwk: dpop.privateJwk,
    dpopPublicJwk: dpop.publicJwk,
    oauthClientId: clientId,
    redirectUri: config.redirectUri,
    scope: config.scope,
    requiredScope,
    capabilities,
    persistSession: shouldPersistOAuthSession(
      options?.persistSession,
      continuation ?? undefined,
    ),
    asMeta,
    pdsUrl,
    prompt: "create",
    continuation: continuation ?? undefined,
    returnTo: returnTo ?? undefined,
    intent: intent ?? undefined,
    action: options?.action,
    targetName: options?.targetName,
    grantId: shouldPersistOAuthSession(
        options?.persistSession,
        continuation ?? undefined,
      )
      ? randomB64u(24)
      : undefined,
  };
  await saveFlowState(flow);

  const parRes = await pushParRequest(flow);
  const authUrl = new URL(asMeta.authorization_endpoint);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("request_uri", parRes.requestUri);
  return { redirectUrl: authUrl.toString(), state, browserBinding };
}

interface ParResponse {
  requestUri: string;
  expiresIn: number;
}

async function pushParRequest(
  flow: FlowState,
  attempt = 0,
): Promise<ParResponse> {
  const clientId = flow.oauthClientId ?? oauthClientId(oauthClientConfig());
  const flowRedirectUri = flow.redirectUri ?? defaultRedirectUri();
  const scope = flow.scope ?? DEFAULT_OAUTH_SCOPE;
  const body = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: flowRedirectUri,
    scope,
    state: flow.state,
    code_challenge: await sha256B64u(flow.pkceVerifier),
    code_challenge_method: "S256",
  });
  if (flow.handle) body.set("login_hint", flow.handle);
  if (flow.prompt) body.set("prompt", flow.prompt);
  if (!isPublicLocalhostOAuthClientId(clientId)) {
    body.set(
      "client_assertion_type",
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    );
    body.set(
      "client_assertion",
      await buildClientAssertion(flow.asMeta.issuer, clientId),
    );
  }

  const dpopProof = await buildDpopProof({
    privateJwk: flow.dpopPrivateJwk,
    publicJwk: flow.dpopPublicJwk,
    htm: "POST",
    htu: flow.asMeta.pushed_authorization_request_endpoint,
    nonce: flow.asNonce,
  });

  const res = await fetch(flow.asMeta.pushed_authorization_request_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      dpop: dpopProof,
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(ATPROTO_FETCH_TIMEOUT_MS),
  });

  const newNonce = res.headers.get("dpop-nonce");
  if (newNonce && newNonce !== flow.asNonce) {
    flow.asNonce = newNonce;
    await saveFlowState(flow);
  }

  if (res.status === 400 || res.status === 401) {
    const errBody = await readOAuthServerJson(res).catch(() => ({})) as {
      error?: string;
    };
    if (
      errBody.error === "use_dpop_nonce" && attempt === 0 && newNonce
    ) {
      return await pushParRequest(flow, 1);
    }
    throw new Error(`PAR error: ${oauthServerErrorCode(errBody.error)}`);
  }
  if (!res.ok) {
    throw new Error(`PAR failed: HTTP ${res.status}`);
  }
  requireDpopNonce(newNonce, "PAR");
  const json = await readOAuthServerJson(res) as Record<string, unknown>;
  if (
    typeof json.request_uri !== "string" || !json.request_uri ||
    json.request_uri.length > 2_048 ||
    typeof json.expires_in !== "number" ||
    !Number.isFinite(json.expires_in) || json.expires_in <= 0
  ) {
    throw new Error("PAR response was invalid");
  }
  return { requestUri: json.request_uri, expiresIn: json.expires_in };
}

/* ---------------- Callback / token exchange ---------------- */

export interface CallbackResult {
  did: string;
  handle: string;
  pdsUrl: string;
  returnTo?: string;
  intent?: SignInIntent;
  continuation?: "login_selection";
  chooseAnotherAccount?: boolean;
  mode?: "create";
  capabilities?: OAuthCapability[];
  grantedScope: string;
  authorizationSufficient: boolean;
  scopeConflict: boolean;
  action?: OAuthAction;
  targetName?: string;
  /** Undefined only for intentionally non-persistent login-picker flows. */
  grantId?: string;
}

export interface CancelledOAuthFlow {
  returnTo?: string;
  intent?: SignInIntent;
  continuation?: "login_selection";
  chooseAnotherAccount?: boolean;
  mode?: "create";
  capabilities?: OAuthCapability[];
  action?: OAuthAction;
  targetName?: string;
  handle?: string;
}

export interface OAuthCallbackClientBinding {
  clientId: string;
  redirectUri: string;
}

function flowMatchesCallbackClient(
  flow: Pick<FlowState, "oauthClientId" | "redirectUri" | "scope">,
  expected: OAuthCallbackClientBinding,
): boolean {
  const flowClientId = flow.oauthClientId ?? oauthClientId(oauthClientConfig({
    scope: flow.scope,
  }));
  const flowRedirectUri = flow.redirectUri ?? defaultRedirectUri();
  return flowClientId === expected.clientId &&
    flowRedirectUri === expected.redirectUri;
}

export function flowMatchesCallbackClientForTest(
  flow: { oauthClientId?: string; redirectUri?: string; scope?: string },
  expected: OAuthCallbackClientBinding,
): boolean {
  return flowMatchesCallbackClient(flow, expected);
}

export function oauthRecoveryModeForPrompt(
  prompt: "create" | undefined,
): "create" | undefined {
  return prompt === "create" ? "create" : undefined;
}

async function flowMatchesBrowserBinding(
  flow: Pick<FlowState, "browserBindingHash">,
  browserBinding: string | undefined,
): Promise<boolean> {
  return typeof browserBinding === "string" && browserBinding.length > 0 &&
    await sha256B64u(browserBinding) === flow.browserBindingHash;
}

export async function flowMatchesBrowserBindingForTest(
  browserBindingHash: string,
  browserBinding: string | undefined,
): Promise<boolean> {
  return await flowMatchesBrowserBinding(
    { browserBindingHash },
    browserBinding,
  );
}

/** Consume a denied authorization flow while retaining only the safe context
 * needed to restore the action that initiated it. */
export async function cancelOAuthFlow(
  state: string,
  expectedClient?: OAuthCallbackClientBinding,
  browserBinding?: string,
): Promise<CancelledOAuthFlow | null> {
  const flow = await loadFlowState(state);
  if (!flow) return null;
  if (expectedClient && !flowMatchesCallbackClient(flow, expectedClient)) {
    return null;
  }
  if (!await flowMatchesBrowserBinding(flow, browserBinding)) return null;
  await deleteFlowState(state);
  return {
    returnTo: flow.returnTo,
    intent: flow.intent,
    continuation: flow.continuation,
    chooseAnotherAccount: flow.chooseAnotherAccount,
    mode: oauthRecoveryModeForPrompt(flow.prompt),
    capabilities: flow.capabilities,
    action: flow.action,
    targetName: flow.targetName,
    handle: flow.handle,
  };
}

export async function completeCallback(
  params: {
    state: string;
    code: string;
    iss: string;
  },
  expectedClient?: OAuthCallbackClientBinding,
  browserBinding?: string,
): Promise<CallbackResult> {
  const flow = await loadFlowState(params.state);
  if (!flow) throw new Error("invalid or expired state");
  if (expectedClient && !flowMatchesCallbackClient(flow, expectedClient)) {
    throw new Error("OAuth callback client mismatch");
  }
  if (!await flowMatchesBrowserBinding(flow, browserBinding)) {
    throw new Error("OAuth callback browser mismatch");
  }
  if (
    !hasValidLoginSelectionContinuationBinding(
      flow.returnTo ?? null,
      flow.continuation,
      flow.intent ?? null,
      flow.action ?? null,
      flow.capabilities ?? ["identity"],
    )
  ) {
    throw new Error("invalid OAuth continuation binding");
  }
  ensureConfigured({
    clientId: flow.oauthClientId,
    redirectUri: flow.redirectUri,
    scope: flow.scope,
  });
  let callbackIssuer: string;
  try {
    callbackIssuer = normalizeServiceEndpoint(params.iss);
  } catch {
    throw new Error("invalid callback issuer");
  }
  if (flow.asMeta.issuer !== callbackIssuer) {
    throw new Error(
      `issuer mismatch: ${callbackIssuer} vs ${flow.asMeta.issuer}`,
    );
  }

  const tokenRes = await tokenRequest(flow, {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: flow.redirectUri ?? defaultRedirectUri(),
    code_verifier: flow.pkceVerifier,
  });
  const requestedScope = flow.scope ?? DEFAULT_OAUTH_SCOPE;
  if (!scopeSafelyCoversScope(requestedScope, tokenRes.scope)) {
    throw new Error("token response scope exceeds requested authorization");
  }

  if (flow.did && tokenRes.sub !== flow.did) {
    throw new Error(
      `sub mismatch: token sub=${tokenRes.sub} flow did=${flow.did}`,
    );
  }

  let did = flow.did;
  let handle = flow.handle;
  let pdsUrl = flow.pdsUrl;
  if (!did || !handle) {
    const identity = await resolveIdentity(tokenRes.sub);
    const identityAuthServer = await discoverAuthServer(identity.pdsUrl);
    if (identityAuthServer.issuer !== flow.asMeta.issuer) {
      throw new Error(
        "created account is not authoritative for the selected host",
      );
    }
    did = identity.did;
    handle = identity.handle;
    pdsUrl = identity.pdsUrl;
  }

  const authorizationSufficient = !flow.requiredScope ||
    scopeCoversScope(tokenRes.scope, flow.requiredScope);
  let scopeConflict = false;
  let persistedGrantId: string | undefined;
  if (flow.persistSession !== false && authorizationSufficient) {
    if (!tokenRes.refresh_token) {
      throw new Error("token response missing refresh_token");
    }
    persistedGrantId = flow.grantId ?? randomB64u(24);
    const session: SessionData = {
      grantId: persistedGrantId,
      did,
      handle,
      pdsUrl,
      asIssuer: flow.asMeta.issuer,
      oauthClientId: flow.oauthClientId ?? oauthClientId(oauthClientConfig()),
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token,
      expiresAt: Date.now() + tokenRes.expires_in * 1000,
      dpopPrivateJwk: flow.dpopPrivateJwk,
      dpopPublicJwk: flow.dpopPublicJwk,
      asNonce: flow.asNonce,
      identityCheckedAt: Date.now(),
      scope: tokenRes.scope,
    };
    const saved = await saveCallbackSession(
      session,
      flow.replaceableSessionHash,
    );
    // Two capability upgrades may have started from the same older grant.
    // Neither token can be merged with the other, so preserve the winner and
    // have the callback restart authorization for the fresh union.
    scopeConflict = saved === "conflict";
    // A narrower identity-only callback never replaces a more capable stored
    // session. The current tokens remain valid for this account.
  }
  await deleteFlowState(params.state);

  return {
    did,
    handle,
    pdsUrl,
    returnTo: flow.returnTo,
    intent: flow.intent,
    continuation: flow.continuation,
    chooseAnotherAccount: flow.chooseAnotherAccount,
    mode: oauthRecoveryModeForPrompt(flow.prompt),
    capabilities: flow.capabilities,
    grantedScope: tokenRes.scope,
    authorizationSufficient,
    scopeConflict,
    action: flow.action,
    targetName: flow.targetName,
    grantId: persistedGrantId,
  };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
  sub: string;
}

function parseTokenResponse(
  value: unknown,
  options: { requireRefreshToken: boolean },
): TokenResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("token response was not a JSON object");
  }
  const record = value as Record<string, unknown>;
  const accessToken = record.access_token;
  const refreshToken = record.refresh_token;
  const tokenType = record.token_type;
  const expiresIn = record.expires_in;
  const scope = typeof record.scope === "string" ? record.scope.trim() : null;
  const sub = record.sub;

  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("token response missing access_token");
  }
  if (
    options.requireRefreshToken &&
    (typeof refreshToken !== "string" || !refreshToken)
  ) {
    throw new Error("token response missing refresh_token");
  }
  if (
    refreshToken !== undefined &&
    (typeof refreshToken !== "string" || !refreshToken)
  ) {
    throw new Error("token response has invalid refresh_token");
  }
  if (typeof tokenType !== "string" || tokenType.toLowerCase() !== "dpop") {
    throw new Error("token response token_type must be DPoP");
  }
  if (
    typeof expiresIn !== "number" || !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error("token response missing expires_in");
  }
  if (typeof sub !== "string" || !sub.startsWith("did:")) {
    throw new Error("token response missing account DID");
  }
  if (!scope) {
    throw new Error("token response missing scope");
  }
  if (!scopeTokens(scope).includes("atproto")) {
    throw new Error("token response scope must include atproto");
  }
  if (
    record.scopes !== undefined &&
    (typeof record.scopes !== "string" ||
      !sameScopeTokenSet(scope, record.scopes))
  ) {
    throw new Error("token response has inconsistent scope fields");
  }

  return {
    access_token: accessToken,
    refresh_token: typeof refreshToken === "string" ? refreshToken : undefined,
    token_type: tokenType,
    expires_in: expiresIn,
    scope,
    sub,
  };
}

export function tokenResponseScopeForTest(
  value: unknown,
  requireRefreshToken = true,
): string {
  return parseTokenResponse(value, { requireRefreshToken }).scope;
}

function sameScopeTokenSet(left: string, right: string): boolean {
  const leftTokens = scopeTokens(left);
  const rightTokens = new Set(scopeTokens(right));
  return leftTokens.length === rightTokens.size &&
    leftTokens.every((token) => rightTokens.has(token));
}

async function tokenRequest(
  flow: {
    asMeta: AuthServerMetadata;
    dpopPrivateJwk: JsonWebKey;
    dpopPublicJwk: JsonWebKey;
    oauthClientId?: string;
    asNonce?: string;
  },
  bodyParams: Record<string, string>,
  attempt = 0,
): Promise<TokenResponse> {
  const clientId = flow.oauthClientId ?? oauthClientId(oauthClientConfig());
  const body = new URLSearchParams({
    ...bodyParams,
    client_id: clientId,
  });
  if (!isPublicLocalhostOAuthClientId(clientId)) {
    body.set(
      "client_assertion_type",
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    );
    body.set(
      "client_assertion",
      await buildClientAssertion(flow.asMeta.issuer, clientId),
    );
  }

  const dpopProof = await buildDpopProof({
    privateJwk: flow.dpopPrivateJwk,
    publicJwk: flow.dpopPublicJwk,
    htm: "POST",
    htu: flow.asMeta.token_endpoint,
    nonce: flow.asNonce,
  });

  const res = await fetch(flow.asMeta.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      dpop: dpopProof,
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(ATPROTO_FETCH_TIMEOUT_MS),
  });

  const newNonce = res.headers.get("dpop-nonce");
  if (newNonce && newNonce !== flow.asNonce) {
    flow.asNonce = newNonce;
  }

  if (res.status === 400 || res.status === 401) {
    const errBody = await readOAuthServerJson(res).catch(() => ({})) as {
      error?: string;
    };
    if (
      errBody.error === "use_dpop_nonce" && attempt === 0 && newNonce
    ) {
      return tokenRequest(flow, bodyParams, 1);
    }
    throw new Error(`token error: ${oauthServerErrorCode(errBody.error)}`);
  }
  if (!res.ok) {
    throw new Error(`token request failed: HTTP ${res.status}`);
  }
  requireDpopNonce(newNonce, "token");
  const tokenBody = await readOAuthServerJson(res).catch(() => null);
  return parseTokenResponse(tokenBody, {
    requireRefreshToken: bodyParams.grant_type === "authorization_code",
  });
}

/* ---------------- Refresh + valid-session retrieval ---------------- */

async function refreshSession(session: SessionData): Promise<SessionData> {
  const asMeta = await discoverAuthServer(session.pdsUrl);
  if (asMeta.issuer !== session.asIssuer) {
    await deleteSessionIfUnchanged(session);
    throw new Error("authorization server issuer changed for session");
  }
  const tokenFlow = {
    asMeta,
    dpopPrivateJwk: session.dpopPrivateJwk,
    dpopPublicJwk: session.dpopPublicJwk,
    oauthClientId: oauthClientIdForSession(session),
    asNonce: session.asNonce,
  };
  const tokenRes = await tokenRequest(
    tokenFlow,
    { grant_type: "refresh_token", refresh_token: session.refreshToken },
  );
  if (tokenRes.sub !== session.did) {
    await deleteSessionIfUnchanged(session);
    throw new Error(
      `sub mismatch on refresh: token sub=${tokenRes.sub} session did=${session.did}`,
    );
  }
  if (
    !scopeSafelyCoversScope(grantedScopeForSession(session), tokenRes.scope)
  ) {
    throw new Error("refreshed token scope exceeds existing authorization");
  }
  const updated: SessionData = {
    ...session,
    accessToken: tokenRes.access_token,
    refreshToken: tokenRes.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + tokenRes.expires_in * 1000,
    asNonce: tokenFlow.asNonce,
    scope: tokenRes.scope,
    oauthClientId: tokenFlow.oauthClientId,
  };
  return await saveRefreshedSession(session, updated);
}

async function refreshSessionIdentity(
  session: SessionData,
): Promise<SessionData | null> {
  if (
    session.identityCheckedAt &&
    Date.now() - session.identityCheckedAt < IDENTITY_RECHECK_INTERVAL_MS
  ) {
    return session;
  }
  try {
    const identity = await resolveIdentity(session.did);
    let asIssuer = session.asIssuer;
    if (identity.pdsUrl !== session.pdsUrl) {
      const asMeta = await discoverAuthServer(identity.pdsUrl);
      if (asMeta.issuer !== session.asIssuer) {
        await deleteSessionIfUnchanged(session);
        return null;
      }
      asIssuer = asMeta.issuer;
    }
    const updated: SessionData = {
      ...session,
      handle: identity.handle,
      pdsUrl: identity.pdsUrl,
      asIssuer,
      identityCheckedAt: Date.now(),
    };
    const expectedStoredValue = storedValueBySession.get(session) ??
      JSON.stringify(session);
    if (await replaceSessionIfUnchanged(updated, expectedStoredValue)) {
      return updated;
    }
    return (await loadSession(session.did, { grantId: session.grantId })) ??
      null;
  } catch {
    // Discovery errors can retain authorization/session details in causes.
    if (IS_DEV) console.warn("session identity refresh failed");
    return session;
  }
}

export async function getValidSession(
  did: string,
  options: OAuthSessionLookupOptions = {},
): Promise<SessionData | null> {
  let session = await loadSession(did, options);
  if (!session) return null;
  session = await refreshSessionIdentity(session);
  if (!session) return null;
  if (session.expiresAt - ACCESS_TOKEN_REFRESH_THRESHOLD_MS > Date.now()) {
    return session;
  }
  try {
    session = await refreshSession(session);
    return await refreshSessionIdentity(session);
  } catch {
    // Refresh errors can include access, refresh, DPoP, or private-key data.
    if (IS_DEV && !options.quiet) console.warn("session refresh failed");
    return null;
  }
}

export async function getSessionForCapabilities(
  did: string,
  capabilities: readonly OAuthCapability[],
  options: OAuthSessionLookupOptions = {},
): Promise<SessionData | null> {
  const session = await getValidSession(did, options);
  if (!session) return null;
  return hasOAuthCapabilities(
      grantedScopeForSession(session),
      capabilities,
    )
    ? session
    : null;
}

/* ---------------- Authed PDS request ---------------- */

export interface AuthedFetchInit extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

export async function authedFetch(
  did: string,
  url: string,
  init: AuthedFetchInit = {},
  attempt = 0,
): Promise<Response> {
  const session = await getValidSession(did);
  if (!session) throw new Error(`no session for ${did}`);
  if (!isAuthedPdsTargetForSession(session.pdsUrl, url)) {
    throw new Error("authenticated request target does not match session PDS");
  }

  const method = (init.method ?? "GET").toUpperCase();
  const dpop = await buildDpopProof({
    privateJwk: session.dpopPrivateJwk,
    publicJwk: session.dpopPublicJwk,
    htm: method,
    htu: url,
    nonce: session.pdsNonce,
    accessToken: session.accessToken,
  });

  const res = await fetch(url, {
    ...init,
    method,
    redirect: "manual",
    signal: init.signal ?? AbortSignal.timeout(ATPROTO_FETCH_TIMEOUT_MS),
    headers: {
      ...(init.headers ?? {}),
      authorization: `DPoP ${session.accessToken}`,
      dpop,
    },
  });

  const newNonce = res.headers.get("dpop-nonce");
  requireDpopNonce(newNonce, "PDS");
  if (newNonce && newNonce !== session.pdsNonce) {
    const updated = { ...session, pdsNonce: newNonce };
    const expectedStoredValue = storedValueBySession.get(session) ??
      JSON.stringify(session);
    await replaceSessionIfUnchanged(updated, expectedStoredValue);
    if (res.status === 401 && attempt === 0) {
      return await authedFetch(did, url, init, 1);
    }
  }

  return res;
}

function isAuthedPdsTargetForSession(pdsUrl: string, target: string): boolean {
  try {
    const pds = new URL(normalizeServiceEndpoint(pdsUrl));
    const url = new URL(target);
    return !url.username && !url.password && url.origin === pds.origin;
  } catch {
    return false;
  }
}

export function isAuthedPdsTargetForSessionForTest(
  pdsUrl: string,
  target: string,
): boolean {
  return isAuthedPdsTargetForSession(pdsUrl, target);
}

function requireDpopNonce(
  nonce: string | null,
  source: "PAR" | "token" | "PDS",
): asserts nonce is string {
  if (!nonce) throw new Error(`${source} response missing DPoP nonce`);
}

function oauthServerErrorCode(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value)
    ? value
    : "unknown_error";
}

async function readOAuthServerJson(response: Response): Promise<unknown> {
  const contentType = (response.headers.get("content-type") ?? "")
    .toLowerCase();
  if (!contentType.includes("application/json")) {
    await response.body?.cancel().catch(() => {});
    throw new Error("OAuth server returned a non-JSON response");
  }
  const body = await readResponseTextWithLimit(
    response,
    MAX_OAUTH_SERVER_RESPONSE_BYTES,
  );
  if (!body.ok) throw new Error(`OAuth server ${body.error}`);
  try {
    return JSON.parse(body.text);
  } catch {
    throw new Error("OAuth server returned invalid JSON");
  }
}

export async function readOAuthServerJsonForTest(
  response: Response,
): Promise<unknown> {
  return await readOAuthServerJson(response);
}
