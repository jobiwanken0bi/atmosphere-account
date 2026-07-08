const DEFAULT_MAX_TOKEN_AGE_SEC = 5 * 60;
const DEFAULT_JWKS_TIMEOUT_MS = 3000;
const DEFAULT_JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const jwksCache = new Map();

export async function fetchAtmosphereLoginPublicJwk(
  atmosphereOrigin = "https://login.atmosphereaccount.com",
  options = {},
) {
  const jwks = await fetchAtmosphereLoginJwks(atmosphereOrigin, options);
  try {
    return selectAtmosphereLoginPublicJwk(jwks, options.kid);
  } catch (error) {
    if (!options.kid || options.cache === false) throw error;
    const refreshed = await fetchAtmosphereLoginJwks(atmosphereOrigin, {
      ...options,
      cache: false,
    });
    return selectAtmosphereLoginPublicJwk(refreshed, options.kid);
  }
}

export async function fetchAtmosphereLoginPublicJwkForToken(
  token,
  atmosphereOrigin = "https://login.atmosphereaccount.com",
  options = {},
) {
  const kid = readAtmosphereLoginTokenKid(token);
  if (!kid) {
    throw new Error("Atmosphere Login selection token did not include a kid");
  }
  return await fetchAtmosphereLoginPublicJwk(atmosphereOrigin, {
    ...options,
    kid,
  });
}

export async function fetchAtmosphereLoginJwks(
  atmosphereOrigin = "https://login.atmosphereaccount.com",
  options = {},
) {
  const url = new URL("/oauth/jwks.json", atmosphereOrigin);
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_JWKS_CACHE_TTL_MS;
  const cacheEnabled = options.cache !== false && cacheTtlMs > 0;
  const cacheKey = url.toString();
  const nowMs = Date.now();
  if (cacheEnabled) {
    const cached = jwksCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs) return cached.jwks;
  }
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS;
  const controller = typeof AbortController === "function"
    ? new AbortController()
    : null;
  const timeoutId = controller && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  let response;
  try {
    response = await fetchImpl(url, {
      signal: controller?.signal,
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Atmosphere Login JWKS request timed out");
    }
    throw new Error(
      `Atmosphere Login JWKS request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
  if (!response.ok) {
    throw new Error(
      `Atmosphere Login JWKS request failed with ${response.status}`,
    );
  }
  try {
    const jwks = await response.json();
    if (cacheEnabled) {
      jwksCache.set(cacheKey, {
        jwks,
        expiresAtMs: nowMs + cacheTtlMs,
      });
    }
    return jwks;
  } catch {
    throw new Error("Atmosphere Login JWKS was not valid JSON");
  }
}

export function clearAtmosphereLoginJwksCache() {
  jwksCache.clear();
}

export function selectAtmosphereLoginPublicJwk(jwks, kid = null) {
  const keys = Array.isArray(jwks?.keys)
    ? jwks.keys.filter((key) =>
      key && typeof key === "object" && !Array.isArray(key)
    )
    : [];
  const key = kid ? keys.find((candidate) => candidate.kid === kid) : keys[0];
  if (!key) {
    throw new Error(
      kid
        ? `Atmosphere Login JWKS did not include key ${kid}`
        : "Atmosphere Login JWKS did not include a key",
    );
  }
  return key;
}

export function readAtmosphereLoginTokenKid(token) {
  const header = readAtmosphereLoginTokenHeader(token);
  return typeof header.kid === "string" && header.kid.trim()
    ? header.kid
    : null;
}

export function readAtmosphereLoginTokenHeader(token) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || !parts[0]) {
    throw new Error("Atmosphere Login selection token is malformed");
  }
  try {
    const header = JSON.parse(textDecode(b64uDecode(parts[0])));
    if (!header || typeof header !== "object" || Array.isArray(header)) {
      throw new Error("invalid header");
    }
    return header;
  } catch {
    throw new Error("Atmosphere Login selection token header is invalid");
  }
}

export async function verifyAtmosphereLoginCallback(options) {
  let url;
  try {
    url = typeof options.url === "string"
      ? new URL(options.url)
      : new URL(options.url);
  } catch {
    return {
      ok: false,
      error: "invalid callback URL",
      params: new URLSearchParams(),
    };
  }
  const params = url.searchParams;
  const token = params.get("selection_token");
  const clientId = params.get("client_id");
  const state = params.get("state");
  if (!token) return { ok: false, error: "missing selection_token", params };
  if (clientId !== options.expectedClientId) {
    return { ok: false, error: "client_id parameter mismatch", params };
  }
  if (options.expectedState && state !== options.expectedState) {
    return { ok: false, error: "state parameter mismatch", params };
  }
  const expectedState = options.expectedState || state;
  if (!expectedState) {
    return { ok: false, error: "missing state", params };
  }

  const result = await verifyAtmosphereSelectionToken({
    token,
    publicJwk: options.publicJwk,
    expectedIssuer: options.expectedIssuer,
    expectedAudience: options.expectedClientId,
    expectedState,
    expectedReturnUri: options.expectedReturnUri,
    replayStore: options.replayStore,
    nowSec: options.nowSec,
    maxTokenAgeSec: options.maxTokenAgeSec,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      claims: result.claims,
      params,
    };
  }
  return { ok: true, claims: result.claims, params };
}

export async function verifyAtmosphereSelectionToken(options) {
  const verified = await verifyEs256(options.token, options.publicJwk).catch(
    () => null,
  );
  if (!verified) return { ok: false, error: "invalid signature" };
  if (verified.header.typ !== "atmosphere-login+jwt") {
    return {
      ok: false,
      error: "unexpected token type",
      claims: verified.payload,
    };
  }

  const claims = parseAtmosphereSelectionClaims(verified.payload);
  if (!claims) {
    return { ok: false, error: "invalid claims", claims: verified.payload };
  }

  const now = options.nowSec || Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    return { ok: false, error: "expired token", claims };
  }
  if (claims.iat > now + 30) {
    return { ok: false, error: "token issued in the future", claims };
  }
  const maxAge = options.maxTokenAgeSec || DEFAULT_MAX_TOKEN_AGE_SEC;
  if (claims.iat < now - maxAge) {
    return { ok: false, error: "token is too old", claims };
  }
  if (options.expectedIssuer && claims.iss !== options.expectedIssuer) {
    return { ok: false, error: "issuer mismatch", claims };
  }
  if (options.expectedAudience && claims.aud !== options.expectedAudience) {
    return { ok: false, error: "audience mismatch", claims };
  }
  if (options.expectedState && claims.state !== options.expectedState) {
    return { ok: false, error: "state mismatch", claims };
  }
  if (options.expectedReturnUri) {
    const claimReturnUri = normalizeUrl(claims.return_uri);
    const expectedReturnUri = normalizeUrl(options.expectedReturnUri);
    if (!claimReturnUri || !expectedReturnUri) {
      return { ok: false, error: "return URI mismatch", claims };
    }
    if (claimReturnUri !== expectedReturnUri) {
      return { ok: false, error: "return URI mismatch", claims };
    }
  }
  if (options.replayStore) {
    const seen = await options.replayStore.has(claims.jti);
    if (seen) return { ok: false, error: "replayed token", claims };
    await options.replayStore.add(claims.jti, claims.exp);
  }
  return { ok: true, claims };
}

function parseAtmosphereSelectionClaims(value) {
  if (
    !value ||
    typeof value.iss !== "string" ||
    typeof value.aud !== "string" ||
    typeof value.sub !== "string" ||
    typeof value.handle !== "string" ||
    typeof value.return_uri !== "string" ||
    typeof value.state !== "string" ||
    typeof value.app_name !== "string" ||
    typeof value.iat !== "number" ||
    typeof value.exp !== "number" ||
    typeof value.jti !== "string"
  ) {
    return null;
  }
  if (!value.sub.startsWith("did:")) return null;
  if (!value.handle.trim() || value.handle.startsWith("@")) return null;
  if (!value.state.trim()) return null;
  if (value.exp <= value.iat) return null;
  if (value.jti.length < 12) return null;
  if (!isSafeAbsoluteUrl(value.iss)) return null;
  if (!isSafeAbsoluteUrl(value.aud)) return null;
  if (!isSafeAbsoluteUrl(value.return_uri)) return null;
  if (value.scope !== undefined && typeof value.scope !== "string") {
    return null;
  }
  if (value.pds_url !== undefined) {
    if (typeof value.pds_url !== "string") return null;
    if (!isSafeAbsoluteUrl(value.pds_url)) return null;
  }
  return value;
}

async function verifyEs256(jwt, publicJwk) {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(textDecode(b64uDecode(encodedHeader)));
    payload = JSON.parse(textDecode(b64uDecode(encodedPayload)));
  } catch {
    return null;
  }
  if (header.alg !== "ES256") return null;
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    b64uDecode(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  return ok ? { header, payload } : null;
}

function b64uDecode(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "====".slice(padded.length % 4);
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function textDecode(bytes) {
  return new TextDecoder().decode(bytes);
}

function isSafeAbsoluteUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" ||
    host === "::1" || host === "[::1]";
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
