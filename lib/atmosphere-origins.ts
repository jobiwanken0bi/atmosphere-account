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
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" ||
        url.hostname === "::1" ||
        url.hostname === "[::1]");
  } catch {
    return false;
  }
}

function equivalentLoopbackOrigin(
  requestOrigin: string,
  candidateOrigin: string,
): boolean {
  if (!IS_DEV) return false;
  try {
    const request = new URL(requestOrigin);
    const candidate = new URL(candidateOrigin);
    return isLoopbackOrigin(request.origin) &&
      isLoopbackOrigin(candidate.origin) &&
      request.protocol === candidate.protocol &&
      request.port === candidate.port;
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

function forwardedTrustedOrigin(headers?: Headers): string | null {
  const forwarded = headers?.get("x-atmosphere-public-origin");
  const normalized = forwarded ? normalizeOrigin(forwarded) : null;
  return normalized && isTrustedAtmosphereOrigin(normalized)
    ? normalized
    : null;
}

export function trustedRequestOrigin(url: URL, headers?: Headers): string {
  const normalized = normalizeOrigin(url.origin);
  if (normalized && IS_DEV) {
    const browserOrigin = normalizeOrigin(headers?.get("origin") ?? "");
    if (
      browserOrigin && equivalentLoopbackOrigin(normalized, browserOrigin)
    ) {
      return browserOrigin;
    }
    const referer = headers?.get("referer");
    const refererOrigin = referer ? normalizeOrigin(referer) : null;
    if (
      refererOrigin && equivalentLoopbackOrigin(normalized, refererOrigin)
    ) {
      return refererOrigin;
    }
  }
  if (normalized && isTrustedAtmosphereOrigin(normalized)) return normalized;
  const forwarded = forwardedTrustedOrigin(headers);
  if (forwarded) return forwarded;
  return siteOrigin();
}

export function isLoginRequestOrigin(url: URL, headers?: Headers): boolean {
  return trustedRequestOrigin(url, headers) === loginOrigin();
}

export function loginPickerOriginForRequest(
  url: URL,
  headers?: Headers,
): string {
  const origin = trustedRequestOrigin(url, headers);
  return origin === siteOrigin() && !IS_DEV ? loginOrigin() : origin;
}

export function loginPickerUrlForRequest(url: URL): string {
  const target = new URL(url.pathname + url.search, loginOrigin());
  return target.toString();
}

export function oauthClientConfigForRequest(url: URL, headers?: Headers): {
  origin: string;
  clientId: string;
  redirectUri: string;
  jwksUri: string;
} {
  const origin = trustedRequestOrigin(url, headers);
  return {
    origin,
    clientId: clientIdForOrigin(origin),
    redirectUri: redirectUriForOrigin(origin),
    jwksUri: jwksUriForOrigin(origin),
  };
}
