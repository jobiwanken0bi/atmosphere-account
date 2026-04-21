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
  resolveIdentity,
} from "./identity.ts";
import {
  clientId,
  IS_DEV,
  OAUTH_KID,
  OAUTH_PRIVATE_JWK,
  redirectUri,
} from "./env.ts";

/**
 * Minimum-permission scope.
 *
 * Composed of three parts:
 *   - `atproto`                                                  - identity
 *   - `include:com.atmosphereaccount.registry.fullPermissions`  - repo writes
 *                                                                 to our
 *                                                                 profile +
 *                                                                 featured
 *                                                                 collections
 *                                                                 (resolved
 *                                                                 dynamically
 *                                                                 from the
 *                                                                 published
 *                                                                 permission-set
 *                                                                 lexicon)
 *   - `blob:image/*`                                            - avatar +
 *                                                                 SVG icon
 *                                                                 uploads
 *
 * The `blob` scope is intentionally NOT bundled into the permission set
 * because the atproto permission spec explicitly disallows blob permissions
 * inside permission sets — they must always be requested separately.
 * See https://atproto.com/specs/permission ("Permission Sets").
 *
 * The permission-set lexicon must be published to the DID that holds DNS
 * authority for `_lexicon.registry.atmosphereaccount.com` before this scope
 * will resolve. See `docs/PUBLISHING_LEXICONS.md` for setup steps.
 *
 * MUST stay in sync with `routes/oauth/client-metadata.json.ts`.
 */
const DEFAULT_SCOPE =
  "atproto include:com.atmosphereaccount.registry.fullPermissions blob:image/*";
const STATE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_THRESHOLD_MS = 60 * 1000;

export class OAuthNotConfiguredError extends Error {
  constructor() {
    super(
      "OAuth is not configured. Set OAUTH_PRIVATE_JWK and OAUTH_KID (run `deno task gen:oauth-key`).",
    );
    this.name = "OAuthNotConfiguredError";
  }
}

export function isOAuthConfigured(): boolean {
  return !!(OAUTH_PRIVATE_JWK && OAUTH_KID);
}

function ensureConfigured(): void {
  if (!isOAuthConfigured()) throw new OAuthNotConfiguredError();
}

interface FlowState {
  state: string;
  pkceVerifier: string;
  dpopPrivateJwk: JsonWebKey;
  dpopPublicJwk: JsonWebKey;
  asMeta: AuthServerMetadata;
  did: string;
  handle: string;
  pdsUrl: string;
  asNonce?: string;
}

interface SessionData {
  did: string;
  handle: string;
  pdsUrl: string;
  asIssuer: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms epoch
  dpopPrivateJwk: JsonWebKey;
  dpopPublicJwk: JsonWebKey;
  asNonce?: string;
  pdsNonce?: string;
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

async function buildDpopProof(opts: DpopProofOptions): Promise<string> {
  const privateKey = await importEs256PrivateKey(opts.privateJwk);
  const payload: Record<string, unknown> = {
    jti: randomB64u(16),
    htm: opts.htm,
    htu: opts.htu,
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

async function buildClientAssertion(audience: string): Promise<string> {
  ensureConfigured();
  const privateKey = await loadClientPrivateKey(OAUTH_PRIVATE_JWK!);
  return signEs256({
    header: { kid: OAUTH_KID! },
    payload: {
      iss: clientId(),
      sub: clientId(),
      aud: audience,
      jti: randomB64u(16),
      iat: Math.floor(Date.now() / 1000),
    },
    privateKey,
  });
}

/* ---------------- DB-backed flow + session storage ---------------- */

async function saveFlowState(state: FlowState): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql:
        `INSERT OR REPLACE INTO oauth_state (key, value, expires_at) VALUES (?, ?, ?)`,
      args: [state.state, JSON.stringify(state), Date.now() + STATE_TTL_MS],
    });
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
    return JSON.parse(row.value as string) as FlowState;
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

async function saveSession(session: SessionData): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql:
        `INSERT OR REPLACE INTO oauth_session (did, value, expires_at) VALUES (?, ?, ?)`,
      args: [session.did, JSON.stringify(session), session.expiresAt],
    });
  });
}

export async function loadSession(did: string): Promise<SessionData | null> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `SELECT value FROM oauth_session WHERE did = ?`,
      args: [did],
    });
    if (r.rows.length === 0) return null;
    return JSON.parse(
      (r.rows[0] as Record<string, unknown>).value as string,
    ) as SessionData;
  });
}

export async function deleteSession(did: string): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql: `DELETE FROM oauth_session WHERE did = ?`,
      args: [did],
    });
  });
}

/* ---------------- Login (PAR) ---------------- */

export async function startLogin(
  handleOrDid: string,
): Promise<{ redirectUrl: string }> {
  ensureConfigured();
  const id = await resolveIdentity(handleOrDid);
  const asMeta = await discoverAuthServer(id.pdsUrl);

  const dpop = await generateEs256KeyPair();
  const state = randomB64u(24);
  const pkceVerifier = randomB64u(48);

  const flow: FlowState = {
    state,
    pkceVerifier,
    dpopPrivateJwk: dpop.privateJwk,
    dpopPublicJwk: dpop.publicJwk,
    asMeta,
    did: id.did,
    handle: id.handle,
    pdsUrl: id.pdsUrl,
  };
  await saveFlowState(flow);

  const parRes = await pushParRequest(flow);
  const authUrl = new URL(asMeta.authorization_endpoint);
  authUrl.searchParams.set("client_id", clientId());
  authUrl.searchParams.set("request_uri", parRes.requestUri);

  return { redirectUrl: authUrl.toString() };
}

interface ParResponse {
  requestUri: string;
  expiresIn: number;
}

async function pushParRequest(
  flow: FlowState,
  attempt = 0,
): Promise<ParResponse> {
  const body = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: redirectUri(),
    scope: DEFAULT_SCOPE,
    state: flow.state,
    code_challenge: await sha256B64u(flow.pkceVerifier),
    code_challenge_method: "S256",
    login_hint: flow.handle,
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await buildClientAssertion(flow.asMeta.issuer),
  });

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
  });

  const newNonce = res.headers.get("dpop-nonce");
  if (newNonce && newNonce !== flow.asNonce) {
    flow.asNonce = newNonce;
    await saveFlowState(flow);
  }

  if (res.status === 400 || res.status === 401) {
    const errBody = await res.json().catch(() => ({})) as { error?: string };
    if (errBody.error === "use_dpop_nonce" && attempt === 0) {
      return await pushParRequest(flow, 1);
    }
    throw new Error(`PAR error: ${JSON.stringify(errBody)}`);
  }
  if (!res.ok) {
    throw new Error(`PAR failed: HTTP ${res.status}`);
  }

  const json = await res.json() as { request_uri: string; expires_in: number };
  return { requestUri: json.request_uri, expiresIn: json.expires_in };
}

/* ---------------- Callback / token exchange ---------------- */

export interface CallbackResult {
  did: string;
  handle: string;
  pdsUrl: string;
}

export async function completeCallback(params: {
  state: string;
  code: string;
  iss: string;
}): Promise<CallbackResult> {
  ensureConfigured();
  const flow = await loadFlowState(params.state);
  if (!flow) throw new Error("invalid or expired state");
  if (flow.asMeta.issuer !== params.iss) {
    throw new Error(`issuer mismatch: ${params.iss} vs ${flow.asMeta.issuer}`);
  }

  const tokenRes = await tokenRequest(flow, {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: redirectUri(),
    code_verifier: flow.pkceVerifier,
  });

  if (tokenRes.sub !== flow.did) {
    throw new Error(
      `sub mismatch: token sub=${tokenRes.sub} flow did=${flow.did}`,
    );
  }

  const session: SessionData = {
    did: flow.did,
    handle: flow.handle,
    pdsUrl: flow.pdsUrl,
    asIssuer: flow.asMeta.issuer,
    accessToken: tokenRes.access_token,
    refreshToken: tokenRes.refresh_token,
    expiresAt: Date.now() + tokenRes.expires_in * 1000,
    dpopPrivateJwk: flow.dpopPrivateJwk,
    dpopPublicJwk: flow.dpopPublicJwk,
    asNonce: flow.asNonce,
  };
  await saveSession(session);
  await deleteFlowState(params.state);

  return { did: session.did, handle: session.handle, pdsUrl: session.pdsUrl };
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  sub: string;
}

async function tokenRequest(
  flow: {
    asMeta: AuthServerMetadata;
    dpopPrivateJwk: JsonWebKey;
    dpopPublicJwk: JsonWebKey;
    asNonce?: string;
  },
  bodyParams: Record<string, string>,
  attempt = 0,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    ...bodyParams,
    client_id: clientId(),
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await buildClientAssertion(flow.asMeta.issuer),
  });

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
  });

  const newNonce = res.headers.get("dpop-nonce");
  if (newNonce && newNonce !== flow.asNonce) {
    flow.asNonce = newNonce;
  }

  if (res.status === 400 || res.status === 401) {
    const errBody = await res.json().catch(() => ({})) as { error?: string };
    if (errBody.error === "use_dpop_nonce" && attempt === 0) {
      return tokenRequest(flow, bodyParams, 1);
    }
    throw new Error(`token error: ${JSON.stringify(errBody)}`);
  }
  if (!res.ok) {
    throw new Error(`token request failed: HTTP ${res.status}`);
  }

  return await res.json() as TokenResponse;
}

/* ---------------- Refresh + valid-session retrieval ---------------- */

async function refreshSession(session: SessionData): Promise<SessionData> {
  const asMeta = await discoverAuthServer(session.pdsUrl);
  const tokenRes = await tokenRequest(
    {
      asMeta,
      dpopPrivateJwk: session.dpopPrivateJwk,
      dpopPublicJwk: session.dpopPublicJwk,
      asNonce: session.asNonce,
    },
    { grant_type: "refresh_token", refresh_token: session.refreshToken },
  );
  const updated: SessionData = {
    ...session,
    accessToken: tokenRes.access_token,
    refreshToken: tokenRes.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + tokenRes.expires_in * 1000,
    asNonce: session.asNonce,
  };
  await saveSession(updated);
  return updated;
}

export async function getValidSession(
  did: string,
): Promise<SessionData | null> {
  let session = await loadSession(did);
  if (!session) return null;
  if (session.expiresAt - ACCESS_TOKEN_REFRESH_THRESHOLD_MS > Date.now()) {
    return session;
  }
  try {
    session = await refreshSession(session);
    return session;
  } catch (err) {
    if (IS_DEV) console.warn("session refresh failed:", err);
    return null;
  }
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
    headers: {
      ...(init.headers ?? {}),
      authorization: `DPoP ${session.accessToken}`,
      dpop,
    },
  });

  const newNonce = res.headers.get("dpop-nonce");
  if (newNonce && newNonce !== session.pdsNonce) {
    session.pdsNonce = newNonce;
    await saveSession(session);
    if (res.status === 401 && attempt === 0) {
      return await authedFetch(did, url, init, 1);
    }
  }

  return res;
}
