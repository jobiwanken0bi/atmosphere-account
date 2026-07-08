import type {
  AtmosphereSelectionClaims,
  AtmosphereSelectionReplayStore,
  AtmosphereSelectionVerificationResult,
} from "./atmosphere-login-sdk.ts";
import { verifyAtmosphereSelectionToken } from "./atmosphere-login-sdk.ts";
import { b64uDecode } from "./jose.ts";

const DEFAULT_JWKS_TIMEOUT_MS = 3000;
const DEFAULT_JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const jwksCache = new Map<string, { jwks: unknown; expiresAtMs: number }>();

export interface FetchAtmosphereLoginPublicJwkOptions {
  kid?: string | null;
  timeoutMs?: number;
  cache?: boolean;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchAtmosphereLoginPublicJwk(
  atmosphereOrigin = "https://login.atmosphereaccount.com",
  options: FetchAtmosphereLoginPublicJwkOptions = {},
): Promise<JsonWebKey> {
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
  token: string,
  atmosphereOrigin = "https://login.atmosphereaccount.com",
  options: FetchAtmosphereLoginPublicJwkOptions = {},
): Promise<JsonWebKey> {
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
  options: FetchAtmosphereLoginPublicJwkOptions = {},
): Promise<unknown> {
  const url = new URL("/oauth/jwks.json", atmosphereOrigin);
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_JWKS_CACHE_TTL_MS;
  const cacheEnabled = options.cache !== false && cacheTtlMs > 0;
  const cacheKey = url.toString();
  const nowMs = Date.now();
  if (cacheEnabled) {
    const cached = jwksCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs) return cached.jwks;
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS;
  const controller = typeof AbortController === "function"
    ? new AbortController()
    : null;
  const timeoutId = controller && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: controller?.signal,
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
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

export function clearAtmosphereLoginJwksCache(): void {
  jwksCache.clear();
}

export function selectAtmosphereLoginPublicJwk(
  jwks: unknown,
  kid?: string | null,
): JsonWebKey {
  const keys = isJwksObject(jwks)
    ? jwks.keys.filter((key): key is JsonWebKey => isJsonWebKey(key))
    : [];
  const key = kid
    ? keys.find((candidate) => getJwkKid(candidate) === kid)
    : keys[0];
  if (!key) {
    throw new Error(
      kid
        ? `Atmosphere Login JWKS did not include key ${kid}`
        : "Atmosphere Login JWKS did not include a key",
    );
  }
  return key;
}

export function readAtmosphereLoginTokenKid(token: string): string | null {
  const header = readAtmosphereLoginTokenHeader(token);
  return typeof header.kid === "string" && header.kid.trim()
    ? header.kid
    : null;
}

export function readAtmosphereLoginTokenHeader(
  token: string,
): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0]) {
    throw new Error("Atmosphere Login selection token is malformed");
  }
  try {
    const header = JSON.parse(
      new TextDecoder().decode(b64uDecode(parts[0])),
    ) as unknown;
    if (!header || typeof header !== "object" || Array.isArray(header)) {
      throw new Error("invalid header");
    }
    return header as Record<string, unknown>;
  } catch {
    throw new Error("Atmosphere Login selection token header is invalid");
  }
}

export interface VerifyAtmosphereLoginCallbackOptions {
  url: string | URL;
  publicJwk: JsonWebKey;
  expectedIssuer: string;
  expectedClientId: string;
  expectedReturnUri: string;
  expectedState?: string | null;
  replayStore?: AtmosphereSelectionReplayStore;
}

function isJwksObject(value: unknown): value is { keys: unknown[] } {
  return !!value && typeof value === "object" &&
    Array.isArray((value as { keys?: unknown }).keys);
}

function isJsonWebKey(value: unknown): value is JsonWebKey {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getJwkKid(value: JsonWebKey): string | undefined {
  const kid = (value as { kid?: unknown }).kid;
  return typeof kid === "string" ? kid : undefined;
}

export type AtmosphereLoginCallbackVerification =
  | {
    ok: true;
    claims: AtmosphereSelectionClaims;
    params: URLSearchParams;
  }
  | {
    ok: false;
    error: string;
    claims?: unknown;
    params: URLSearchParams;
  };

export async function verifyAtmosphereLoginCallback(
  options: VerifyAtmosphereLoginCallbackOptions,
): Promise<AtmosphereLoginCallbackVerification> {
  let url: URL;
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
  const expectedState = options.expectedState ?? state;
  if (!expectedState) {
    return { ok: false, error: "missing state", params };
  }

  const result: AtmosphereSelectionVerificationResult =
    await verifyAtmosphereSelectionToken({
      token,
      publicJwk: options.publicJwk,
      expectedIssuer: options.expectedIssuer,
      expectedAudience: options.expectedClientId,
      expectedState,
      expectedReturnUri: options.expectedReturnUri,
      replayStore: options.replayStore,
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
