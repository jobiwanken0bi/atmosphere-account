/**
 * Centralised environment-variable access. Returns `undefined` instead of
 * throwing when a permission denied error occurs, so server modules that
 * are eagerly imported in dev (without --allow-env) don't crash startup.
 */

function safeGet(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

export const SITE_URL = safeGet("FRESH_PUBLIC_SITE_URL") ??
  "https://atmosphereaccount.com";

export const IS_DEV = safeGet("DENO_ENV") !== "production" &&
  safeGet("VERCEL_ENV") !== "production" &&
  !SITE_URL.startsWith("https://atmosphereaccount.com");

export const OAUTH_PRIVATE_JWK = safeGet("OAUTH_PRIVATE_JWK");
export const OAUTH_PUBLIC_JWK = safeGet("OAUTH_PUBLIC_JWK");
export const OAUTH_KID = safeGet("OAUTH_KID");

export const SESSION_SECRET = safeGet("SESSION_SECRET") ??
  "dev-only-not-secret";

export const ATMOSPHERE_DID = safeGet("ATMOSPHERE_DID");

export const TURSO_DATABASE_URL = safeGet("TURSO_DATABASE_URL");
export const TURSO_AUTH_TOKEN = safeGet("TURSO_AUTH_TOKEN");

export const JETSTREAM_URL = safeGet("JETSTREAM_URL") ??
  "wss://jetstream2.us-east.bsky.network/subscribe";

export function siteOrigin(): string {
  return SITE_URL.replace(/\/$/, "");
}

export function clientId(): string {
  return `${siteOrigin()}/oauth/client-metadata.json`;
}

export function redirectUri(): string {
  return `${siteOrigin()}/oauth/callback`;
}

export function jwksUri(): string {
  return `${siteOrigin()}/oauth/jwks.json`;
}
