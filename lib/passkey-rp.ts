import { IS_DEV, loginOrigin, PASSKEY_RP_ID } from "./env.ts";
import {
  isTrustedAtmosphereOrigin,
  trustedAtmosphereOrigins,
} from "./atmosphere-origins.ts";
import { readProxyClientKey } from "./proxy-client-key.ts";

export interface PasskeyRelyingParty {
  name: string;
  id: string;
  origin: string;
}

function normalizedRpId(value: string): string | null {
  const candidate = value.trim().toLowerCase().replace(/\.$/, "");
  if (!candidate || candidate.includes(":") || candidate.includes("/")) {
    return null;
  }
  return candidate;
}

function originAllowsRpId(origin: URL, rpId: string): boolean {
  const host = origin.hostname.toLowerCase();
  return host === rpId || host.endsWith(`.${rpId}`);
}

function productionRpId(
  canonicalLoginOrigin: string,
  configuredRpId?: string | null,
): string {
  const canonicalHost = new URL(canonicalLoginOrigin).hostname.toLowerCase();
  const configured = configuredRpId ? normalizedRpId(configuredRpId) : null;
  if (configuredRpId && !configured) {
    throw new Error(
      "PASSKEY_RP_ID must be a hostname without a scheme or port",
    );
  }
  if (configured && configured !== canonicalHost) {
    throw new Error(
      "PASSKEY_RP_ID must exactly match the dedicated login hostname",
    );
  }
  return canonicalHost;
}

async function verifiedRequestOrigin(
  url: URL,
  headers?: Headers,
): Promise<string> {
  const actualOrigin = url.origin.replace(/\/$/, "");

  // A request that arrived on a configured public origin needs no forwarding
  // metadata. Ignore any caller-supplied forwarding headers in that case.
  if (trustedAtmosphereOrigins().includes(actualOrigin)) return actualOrigin;

  const rawForwarded = headers?.get("x-atmosphere-public-origin");
  const forwarded = rawForwarded
    ? (() => {
      try {
        return new URL(rawForwarded).origin.replace(/\/$/, "");
      } catch {
        return null;
      }
    })()
    : null;
  if (forwarded && isTrustedAtmosphereOrigin(forwarded)) {
    // The public edge signs this hop. Without that proof, a caller hitting the
    // appview service directly could spoof the public login origin.
    const proxyKey = await readProxyClientKey(
      new Request(url, { headers: new Headers(headers) }),
    );
    if (!proxyKey) throw new Error("untrusted passkey proxy request");
    return forwarded;
  }

  // Local single-process development remains usable without the edge proxy.
  if (IS_DEV && isTrustedAtmosphereOrigin(actualOrigin)) return actualOrigin;
  throw new Error("passkey request did not arrive on a trusted login origin");
}

export async function passkeyRelyingPartyForRequest(
  url: URL,
  headers?: Headers,
): Promise<PasskeyRelyingParty> {
  const origin = await verifiedRequestOrigin(url, headers);
  const originUrl = new URL(origin);
  const configured = PASSKEY_RP_ID ? normalizedRpId(PASSKEY_RP_ID) : null;
  if (PASSKEY_RP_ID && !configured) {
    throw new Error(
      "PASSKEY_RP_ID must be a hostname without a scheme or port",
    );
  }

  const canonicalLogin = new URL(loginOrigin());
  const id = IS_DEV
    ? configured ?? originUrl.hostname.toLowerCase()
    : productionRpId(canonicalLogin.origin, PASSKEY_RP_ID);
  if (!originAllowsRpId(originUrl, id)) {
    throw new Error("passkey RP ID does not match the login origin");
  }
  if (!IS_DEV && origin !== canonicalLogin.origin) {
    throw new Error(
      "passkey ceremonies must run on the dedicated login origin",
    );
  }
  if (!IS_DEV && originUrl.protocol !== "https:") {
    throw new Error("passkey ceremonies require HTTPS");
  }
  return { name: "Atmosphere Account", id, origin };
}

export function productionPasskeyRpIdForTest(
  canonicalLoginOrigin: string,
  configuredRpId?: string | null,
): string {
  return productionRpId(canonicalLoginOrigin, configuredRpId);
}

export function passkeyRelyingPartyForTest(
  origin: string,
  rpId: string,
): PasskeyRelyingParty {
  const url = new URL(origin);
  const normalized = normalizedRpId(rpId);
  if (!normalized || !originAllowsRpId(url, normalized)) {
    throw new Error("invalid test passkey relying party");
  }
  return { name: "Atmosphere Account", id: normalized, origin: url.origin };
}
