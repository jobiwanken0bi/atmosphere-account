import { verifyEs256 } from "./jose.ts";

export interface AtmosphereSelectionClaims {
  iss: string;
  aud: string;
  sub: string;
  handle: string;
  return_uri: string;
  state: string;
  scope?: string;
  pds_url?: string;
  app_name: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface AtmosphereSelectionReplayStore {
  has(jti: string): boolean | Promise<boolean>;
  add(jti: string, expiresAtSec: number): void | Promise<void>;
  /**
   * Atomically records a token ID if it has not been seen yet. Return false
   * when the token has already been consumed. Stores that run across multiple
   * app instances should implement this to avoid has/add race windows.
   */
  consume?(jti: string, expiresAtSec: number): boolean | Promise<boolean>;
}

export type AtmosphereSelectionVerificationResult =
  | { ok: true; claims: AtmosphereSelectionClaims }
  | { ok: false; error: string; claims?: unknown };

export interface VerifyAtmosphereSelectionOptions {
  token: string;
  publicJwk: JsonWebKey;
  expectedIssuer?: string;
  expectedAudience?: string;
  expectedState?: string;
  expectedReturnUri?: string;
  nowSec?: number;
  maxTokenAgeSec?: number;
  replayStore?: AtmosphereSelectionReplayStore;
}

const DEFAULT_MAX_TOKEN_AGE_SEC = 5 * 60;

export function parseAtmosphereSelectionClaims(
  value: Record<string, unknown>,
): AtmosphereSelectionClaims | null {
  if (
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
  return value as unknown as AtmosphereSelectionClaims;
}

export async function verifyAtmosphereSelectionToken(
  options: VerifyAtmosphereSelectionOptions,
): Promise<AtmosphereSelectionVerificationResult> {
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

  const now = options.nowSec ?? Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    return { ok: false, error: "expired token", claims };
  }
  if (claims.iat > now + 30) {
    return { ok: false, error: "token issued in the future", claims };
  }
  const maxAge = options.maxTokenAgeSec ?? DEFAULT_MAX_TOKEN_AGE_SEC;
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
    if (options.replayStore.consume) {
      const consumed = await options.replayStore.consume(
        claims.jti,
        claims.exp,
      );
      if (!consumed) return { ok: false, error: "replayed token", claims };
    } else {
      const seen = await options.replayStore.has(claims.jti);
      if (seen) return { ok: false, error: "replayed token", claims };
      await options.replayStore.add(claims.jti, claims.exp);
    }
  }
  return { ok: true, claims };
}

export function buildAtmosphereLoginUrl(options: {
  atmosphereOrigin: string;
  clientId: string;
  returnUri: string;
  state: string;
  scope?: string | null;
}): string {
  const url = new URL("/login/select", options.atmosphereOrigin);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("return_uri", options.returnUri);
  url.searchParams.set("state", options.state);
  if (options.scope) url.searchParams.set("scope", options.scope);
  return url.toString();
}

function isSafeAbsoluteUrl(value: string): boolean {
  let url: URL;
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

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
