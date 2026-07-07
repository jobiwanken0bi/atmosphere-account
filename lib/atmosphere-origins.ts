import {
  clientIdForOrigin,
  IS_DEV,
  jwksUriForOrigin,
  loginOrigin,
  redirectUriForOrigin,
  siteOrigin,
} from "./env.ts";

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "::1" ||
        url.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function trustedAtmosphereOrigins(): string[] {
  return [
    ...new Set(
      [siteOrigin(), loginOrigin()].map((origin) => origin.replace(/\/$/, "")),
    ),
  ];
}

export function isTrustedAtmosphereOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (trustedAtmosphereOrigins().includes(normalized)) return true;
  return IS_DEV && isLoopbackOrigin(normalized);
}

export function trustedRequestOrigin(url: URL): string {
  const normalized = normalizeOrigin(url.origin);
  if (normalized && isTrustedAtmosphereOrigin(normalized)) return normalized;
  return siteOrigin();
}

export function isLoginRequestOrigin(url: URL): boolean {
  return trustedRequestOrigin(url) === loginOrigin();
}

export function loginPickerOriginForRequest(url: URL): string {
  const origin = trustedRequestOrigin(url);
  return origin === siteOrigin() && !IS_DEV ? loginOrigin() : origin;
}

export function loginPickerUrlForRequest(url: URL): string {
  const target = new URL(url.pathname + url.search, loginOrigin());
  return target.toString();
}

export function oauthClientConfigForRequest(url: URL): {
  origin: string;
  clientId: string;
  redirectUri: string;
  jwksUri: string;
} {
  const origin = trustedRequestOrigin(url);
  return {
    origin,
    clientId: clientIdForOrigin(origin),
    redirectUri: redirectUriForOrigin(origin),
    jwksUri: jwksUriForOrigin(origin),
  };
}
