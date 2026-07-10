import { hmacSign, hmacVerify } from "./jose.ts";
import { reportIpSecret, sessionSecret } from "./env.ts";

export const PROXY_CLIENT_KEY_HEADER = "x-atmosphere-client-key";

const VERSION = "v1";
const MAX_AGE_SECONDS = 120;
const MAX_FUTURE_SKEW_SECONDS = 15;
const OPAQUE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface ProxyClientKeyOptions {
  now?: number;
  identitySecret?: string;
  signingSecret?: string;
}

/** Create a short-lived, opaque caller identity for the Deno -> appview hop. */
export async function createProxyClientKey(
  requestHeaders: Headers,
  options: ProxyClientKeyOptions = {},
): Promise<string> {
  const issuedAt = Math.floor((options.now ?? Date.now()) / 1000);
  const address = bestEffortCallerAddress(requestHeaders);
  const opaqueKey = await hmacSign(
    options.identitySecret ?? reportIpSecret(),
    `${VERSION}\n${address}`,
  );
  const payload = `${VERSION}.${issuedAt}.${opaqueKey}`;
  const signature = await hmacSign(
    options.signingSecret ?? sessionSecret(),
    payload,
  );
  return `${payload}.${signature}`;
}

/** Verify an edge-issued caller identity. Invalid headers are never trusted. */
export async function readProxyClientKey(
  request: Request,
  options: ProxyClientKeyOptions = {},
): Promise<string | null> {
  const raw = request.headers.get(PROXY_CLIENT_KEY_HEADER)?.trim();
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [version, issuedAtRaw, opaqueKey, signature] = parts;
  const issuedAt = Number(issuedAtRaw);
  if (
    version !== VERSION || !Number.isInteger(issuedAt) ||
    !OPAQUE_KEY_PATTERN.test(opaqueKey) || !signature
  ) return null;

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (
    issuedAt > now + MAX_FUTURE_SKEW_SECONDS ||
    now - issuedAt > MAX_AGE_SECONDS
  ) return null;

  const payload = `${version}.${issuedAt}.${opaqueKey}`;
  const valid = await hmacVerify(
    options.signingSecret ?? sessionSecret(),
    payload,
    signature,
  ).catch(() => false);
  return valid ? opaqueKey : null;
}

/**
 * Prefer the verified edge key; direct/local requests retain a best-effort
 * network identity so development and single-process deployments still work.
 */
export async function callerRequestIdentity(
  request: Request,
  options: ProxyClientKeyOptions = {},
): Promise<string> {
  const proxyKey = await readProxyClientKey(request, options);
  return proxyKey
    ? `edge:${proxyKey}`
    : `network:${bestEffortCallerAddress(request.headers)}`;
}

export function bestEffortCallerAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  return real || "anonymous";
}
