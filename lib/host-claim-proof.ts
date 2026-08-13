import { IS_DEV } from "./env.ts";
import {
  authoritativeHandleFromDidDocument,
  type DidDocument,
  findPdsEndpoint,
  resolveDidDocument,
  resolveHandleAuthority,
} from "./identity.ts";

export interface HostClaimProofHost {
  host: string;
}

export interface HostClaimProofUser {
  did: string;
  handle: string;
}

export type HostClaimProofMethod = "local-dev" | "atproto_handle";

export type HostClaimProofResult =
  | { ok: true; method: HostClaimProofMethod }
  | { ok: false; reason: "missing_domain_proof" };

export interface HostClaimProofOptions {
  /** Test seam only. Mutating production callers always use the runtime flag. */
  isDev?: boolean;
}

export interface AtprotoHostClaimProofOptions {
  resolveHandleAuthority?: (handle: string) => Promise<string>;
  resolveDidDocument?: (did: string) => Promise<DidDocument>;
}

export type AtprotoHostClaimProofResult =
  | {
    ok: true;
    method: "atproto_handle";
    did: string;
    handle: string;
    pdsUrl: string;
  }
  | { ok: false; reason: "missing_domain_proof" };

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
 * Production self-service ownership uses the dedicated DNS challenge flow.
 * The sole bypass is an explicit local `.test` fixture while the process is
 * actually in dev.
 */
export function hostSelfServiceClaimPolicy(
  host: string,
  options: { isDev?: boolean } = {},
): "dns" | "local-dev" {
  return isLocalDevHostClaim(host, options) ? "local-dev" : "dns";
}

export function verifyHostClaimDomainProof(
  host: HostClaimProofHost,
  _user: HostClaimProofUser,
  options: HostClaimProofOptions = {},
): HostClaimProofResult {
  // Social handles and host records can describe a host but do not prove who
  // controls its PDS. Production ownership is verified only by the separate
  // DNS challenge flow.
  if (isLocalDevHostClaim(host.host, options)) {
    return { ok: true, method: "local-dev" };
  }
  return { ok: false, reason: "missing_domain_proof" };
}

/**
 * Verify that the active AT Protocol identity itself proves control of the
 * exact account-host domain. The handle is resolved only through the domain's
 * own DNS TXT or HTTPS well-known authority (never a public resolver cache),
 * then checked against the active DID and that DID document's exact handle.
 * The account may legitimately be hosted by a different PDS origin.
 */
export async function verifyAtprotoHostClaimDomainProof(
  host: HostClaimProofHost,
  user: HostClaimProofUser,
  options: AtprotoHostClaimProofOptions = {},
): Promise<AtprotoHostClaimProofResult> {
  const normalizedHost = normalizeHost(host.host);
  if (
    !normalizedHost || !user.did.trim() ||
    normalizeHost(user.handle) !== normalizedHost
  ) {
    return { ok: false, reason: "missing_domain_proof" };
  }

  try {
    const did = await (
      options.resolveHandleAuthority ?? resolveHandleAuthority
    )(
      normalizedHost,
    );
    if (did !== user.did.trim()) {
      return { ok: false, reason: "missing_domain_proof" };
    }
    const doc = await (options.resolveDidDocument ?? resolveDidDocument)(did);
    if (
      doc.id !== did ||
      authoritativeHandleFromDidDocument(doc) !== normalizedHost
    ) {
      return { ok: false, reason: "missing_domain_proof" };
    }
    const pdsUrl = findPdsEndpoint(doc);
    return {
      ok: true,
      method: "atproto_handle",
      did,
      handle: normalizedHost,
      pdsUrl,
    };
  } catch {
    return { ok: false, reason: "missing_domain_proof" };
  }
}

export function hostClaimProofMessage(): string {
  return "Verify the host with a temporary DNS record. The identity shortcut requires a live, bidirectionally verified AT Protocol handle that exactly matches the host domain.";
}
