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

/** True when this process is running on hosted infrastructure.
 *  Used to reject dev fallbacks that would silently create local-only state
 *  in production. */
export const IS_HOSTED_RUNTIME = !!(safeGet("DENO_DEPLOYMENT_ID") ??
  safeGet("DENO_REGION") ??
  safeGet("VERCEL") ??
  safeGet("FLY_APP_NAME") ??
  safeGet("RAILWAY_PROJECT_ID") ??
  safeGet("RAILWAY_ENVIRONMENT_ID") ??
  safeGet("RENDER") ??
  safeGet("NETLIFY") ??
  safeGet("K_SERVICE"));

const RAW_SITE_URL = safeGet("FRESH_PUBLIC_SITE_URL");
const RAW_LOGIN_SITE_URL = safeGet("FRESH_PUBLIC_LOGIN_URL") ??
  safeGet("LOGIN_SITE_URL");

/** atproto / RFC 8252 forbid `localhost` as a redirect host for confidential
 *  clients (only loopback IPs like 127.0.0.1 are allowed, and even then only
 *  in dev). If a hosted deployment ends up with a localhost-shaped SITE_URL,
 *  ignore it and fall back to the canonical production origin so we don't
 *  publish a broken client_id / redirect_uri. */
function isLocalhostUrl(u: string | undefined): boolean {
  if (!u) return false;
  try {
    const host = new URL(u).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export const SITE_URL: string = (() => {
  if (RAW_SITE_URL && !(IS_HOSTED_RUNTIME && isLocalhostUrl(RAW_SITE_URL))) {
    return RAW_SITE_URL;
  }
  if (IS_HOSTED_RUNTIME && isLocalhostUrl(RAW_SITE_URL)) {
    console.warn(
      `[env] FRESH_PUBLIC_SITE_URL is set to ${RAW_SITE_URL} on a hosted ` +
        `deployment. Ignoring and falling back to https://atmosphereaccount.com. ` +
        `Update the env var in your hosting provider's dashboard to remove ` +
        `this warning (and to support custom domains).`,
    );
  }
  return "https://atmosphereaccount.com";
})();

export const LOGIN_SITE_URL: string = (() => {
  if (
    RAW_LOGIN_SITE_URL &&
    !(IS_HOSTED_RUNTIME && isLocalhostUrl(RAW_LOGIN_SITE_URL))
  ) {
    return RAW_LOGIN_SITE_URL;
  }
  if (IS_HOSTED_RUNTIME && isLocalhostUrl(RAW_LOGIN_SITE_URL)) {
    console.warn(
      `[env] FRESH_PUBLIC_LOGIN_URL/LOGIN_SITE_URL is set to ${RAW_LOGIN_SITE_URL} ` +
        `on a hosted deployment. Ignoring and falling back to ` +
        `https://login.atmosphereaccount.com.`,
    );
  }
  return IS_HOSTED_RUNTIME ? "https://login.atmosphereaccount.com" : SITE_URL;
})();

export const IS_DEV = !IS_HOSTED_RUNTIME &&
  safeGet("DENO_ENV") !== "production" &&
  (!RAW_SITE_URL || !SITE_URL.startsWith("https://atmosphereaccount.com"));

export const OAUTH_PRIVATE_JWK = safeGet("OAUTH_PRIVATE_JWK");
export const OAUTH_PUBLIC_JWK = safeGet("OAUTH_PUBLIC_JWK");
export const OAUTH_KID = safeGet("OAUTH_KID");

function hostedSecret(key: string, devFallback: string): string {
  const value = safeGet(key);
  if (value) return value;
  if (IS_HOSTED_RUNTIME || safeGet("DENO_ENV") === "production") {
    throw new Error(`${key} is required in hosted/production environments.`);
  }
  return devFallback;
}

export function sessionSecret(): string {
  return hostedSecret("SESSION_SECRET", "dev-only-not-secret");
}

export const ATMOSPHERE_DID = safeGet("ATMOSPHERE_DID");

/**
 * Comma-separated list of DIDs allowed to access /admin and the
 * /api/admin/* endpoints. The signed-in OAuth session DID must match
 * one of these for admin middleware to let the request through. If
 * unset, /admin is effectively unreachable (good default for forks).
 */
export const ADMIN_DIDS: string[] = (safeGet("ADMIN_DIDS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/**
 * Server-side secret used to hash reporter IPs before storing them.
 * The hashes are used for 24h dedup + soft rate-limit only — they
 * never leave the server. Falls back to `SESSION_SECRET` so deployments
 * still get *some* salt instead of an empty key, but operators should
 * set a dedicated value so rotating one secret doesn't break the
 * other.
 */
export function reportIpSecret(): string {
  return safeGet("REPORT_IP_SECRET") ?? sessionSecret();
}

export const TURSO_DATABASE_URL = safeGet("TURSO_DATABASE_URL");
export const TURSO_AUTH_TOKEN = safeGet("TURSO_AUTH_TOKEN");

export const JETSTREAM_URL = safeGet("JETSTREAM_URL") ??
  "wss://jetstream2.us-east.bsky.network/subscribe";

function positiveIntEnv(key: string, fallback: number): number {
  const value = safeGet(key);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const ATPROTO_FETCH_TIMEOUT_MS = positiveIntEnv(
  "ATPROTO_FETCH_TIMEOUT_MS",
  10_000,
);

export const ATSTORE_REPO_DID = safeGet("ATSTORE_REPO_DID");

export const ATSTORE_SOCIAL_REPO_DIDS: string[] =
  (safeGet("ATSTORE_SOCIAL_REPO_DIDS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

export const COMMUNITY_APP_LEXICON_ENABLED =
  safeGet("COMMUNITY_APP_LEXICON_ENABLED") === "1" ||
  safeGet("COMMUNITY_APP_LEXICON_ENABLED") === "true";

export function siteOrigin(): string {
  return SITE_URL.replace(/\/$/, "");
}

export function loginOrigin(): string {
  return LOGIN_SITE_URL.replace(/\/$/, "");
}

export function clientId(): string {
  return `${siteOrigin()}/oauth/client-metadata.json`;
}

export function clientIdForOrigin(origin: string): string {
  return `${origin.replace(/\/$/, "")}/oauth/client-metadata.json`;
}

export function redirectUri(): string {
  return `${siteOrigin()}/oauth/callback`;
}

export function redirectUriForOrigin(origin: string): string {
  return `${origin.replace(/\/$/, "")}/oauth/callback`;
}

export function jwksUri(): string {
  return `${siteOrigin()}/oauth/jwks.json`;
}

export function jwksUriForOrigin(origin: string): string {
  return `${origin.replace(/\/$/, "")}/oauth/jwks.json`;
}
