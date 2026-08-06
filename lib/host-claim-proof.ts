import { IS_DEV } from "./env.ts";

export interface HostClaimProofHost {
  host: string;
}

export interface HostClaimProofUser {
  did: string;
  handle: string;
}

export type HostClaimProofMethod = "local-dev";

export type HostClaimProofResult =
  | { ok: true; method: HostClaimProofMethod }
  | { ok: false; reason: "missing_domain_proof" };

export interface HostClaimProofOptions {
  /** Test seam only. Mutating production callers always use the runtime flag. */
  isDev?: boolean;
}

function normalizeHost(value: unknown): string | null {
  const raw = typeof value === "string"
    ? value.trim().replace(/^@/, "").toLowerCase().replace(/\.$/, "")
    : "";
  if (
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(raw)
  ) {
    return raw;
  }
  return null;
}

export function isLocalDevHostClaim(
  host: string,
  options: { isDev?: boolean } = {},
): boolean {
  const normalizedHost = normalizeHost(host);
  return (options.isDev ?? IS_DEV) && !!normalizedHost &&
    normalizedHost.endsWith(".test");
}

/**
 * Production self-service ownership is contact-email only. The sole exception
 * is an explicit local `.test` fixture while the process is actually in dev.
 */
export function hostSelfServiceClaimPolicy(
  host: string,
  options: { isDev?: boolean } = {},
): "contact-email" | "local-dev" {
  return isLocalDevHostClaim(host, options) ? "local-dev" : "contact-email";
}

export function verifyHostClaimDomainProof(
  host: HostClaimProofHost,
  _user: HostClaimProofUser,
  options: HostClaimProofOptions = {},
): HostClaimProofResult {
  // Social handles and host records can describe a host but do not prove who
  // controls its PDS. Production ownership is verified only by the separate
  // contact.email challenge flow.
  if (isLocalDevHostClaim(host.host, options)) {
    return { ok: true, method: "local-dev" };
  }
  return { ok: false, reason: "missing_domain_proof" };
}

export function hostClaimProofMessage(): string {
  return "Configure contact.email in this PDS's live com.atproto.server.describeServer response, then retry. Atmosphere sends that address a one-time verification link; social handles and host records do not prove operator ownership.";
}
