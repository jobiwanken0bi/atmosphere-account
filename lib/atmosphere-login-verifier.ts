import type {
  AtmosphereSelectionClaims,
  AtmosphereSelectionReplayStore,
  AtmosphereSelectionVerificationResult,
} from "./atmosphere-login-sdk.ts";
import { verifyAtmosphereSelectionToken } from "./atmosphere-login-sdk.ts";
import { b64uDecode } from "./jose.ts";

const DEFAULT_JWKS_TIMEOUT_MS = 3000;
const DEFAULT_JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_JWKS_MAX_BYTES = 64 * 1024;
const MAX_SELECTION_TOKEN_BYTES = 8 * 1024;
const jwksCache = new Map<string, { jwks: unknown; expiresAtMs: number }>();

export interface FetchAtmosphereLoginPublicJwkOptions {
  kid?: string | null;
  timeoutMs?: number;
  cache?: boolean;
  cacheTtlMs?: number;
  maxResponseBytes?: number;
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
    throw new Error(
      "Login with Atmosphere selection token did not include a kid",
    );
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
      throw new Error("Login with Atmosphere JWKS request timed out");
    }
    throw new Error(
      `Login with Atmosphere JWKS request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
  if (!response.ok) {
    throw new Error(
      `Login with Atmosphere JWKS request failed with ${response.status}`,
    );
  }
  const contentType = (response.headers.get("content-type") ?? "")
    .toLowerCase();
  if (
    !contentType.includes("application/json") &&
    !contentType.includes("application/jwk-set+json")
  ) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Atmosphere Login JWKS response was not JSON");
  }
  const bodyTimeoutId =
    controller && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
  let text: string;
  try {
    text = await readBoundedResponseText(
      response,
      options.maxResponseBytes ?? DEFAULT_JWKS_MAX_BYTES,
      controller?.signal,
    );
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error("Atmosphere Login JWKS request timed out");
    }
    throw error;
  } finally {
    if (bodyTimeoutId !== null) clearTimeout(bodyTimeoutId);
  }
  let jwks: unknown;
  try {
    jwks = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Login with Atmosphere JWKS was not valid JSON");
  }
  if (cacheEnabled) {
    jwksCache.set(cacheKey, {
      jwks,
      expiresAtMs: nowMs + cacheTtlMs,
    });
  }
  return jwks;
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
        ? `Login with Atmosphere JWKS did not include key ${kid}`
        : "Login with Atmosphere JWKS did not include a key",
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
  if (
    typeof token !== "string" ||
    new TextEncoder().encode(token).byteLength > MAX_SELECTION_TOKEN_BYTES
  ) {
    throw new Error("Atmosphere Login selection token is malformed");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0]) {
    throw new Error("Login with Atmosphere selection token is malformed");
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
    throw new Error("Login with Atmosphere selection token header is invalid");
  }
}

export interface VerifyAtmosphereLoginCallbackOptions {
  url: string | URL;
  publicJwk: JsonWebKey;
  expectedIssuer: string;
  expectedClientId: string;
  expectedReturnUri: string;
  /** State retained by the relying app before opening the picker. It must not
   * be copied from the callback URL, or the callback would be self-validating
   * an attacker-selected value instead of detecting login CSRF. */
  expectedState: string;
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
  if (
    ["selection_token", "client_id", "state"].some((key) =>
      params.getAll(key).length > 1
    )
  ) {
    return { ok: false, error: "duplicate callback parameter", params };
  }
  const token = params.get("selection_token");
  const clientId = params.get("client_id");
  const state = params.get("state");
  if (!token) return { ok: false, error: "missing selection_token", params };
  if (new TextEncoder().encode(token).byteLength > MAX_SELECTION_TOKEN_BYTES) {
    return { ok: false, error: "selection_token is too large", params };
  }
  if (clientId !== options.expectedClientId) {
    return { ok: false, error: "client_id parameter mismatch", params };
  }
  if (!options.expectedState) {
    return { ok: false, error: "missing expected state", params };
  }
  if (state !== options.expectedState) {
    return { ok: false, error: "state parameter mismatch", params };
  }

  const result: AtmosphereSelectionVerificationResult =
    await verifyAtmosphereSelectionToken({
      token,
      publicJwk: options.publicJwk,
      expectedIssuer: options.expectedIssuer,
      expectedAudience: options.expectedClientId,
      expectedState: options.expectedState,
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

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Atmosphere Login JWKS response limit was invalid");
  }
  const rawLength = response.headers.get("content-length");
  if (rawLength) {
    const length = Number(rawLength);
    if (Number.isFinite(length) && length > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new Error("Atmosphere Login JWKS response was too large");
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("Atmosphere Login JWKS response was too large");
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
