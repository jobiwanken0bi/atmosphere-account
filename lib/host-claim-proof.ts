import { IS_DEV } from "./env.ts";
import { HOST_SERVICE_NSID } from "./lexicons.ts";
import { readResponseTextWithLimit } from "./security.ts";

export interface HostClaimProofHost {
  host: string;
  source?: string | null;
  claimHandle?: string | null;
  profileHandle?: string | null;
  serviceRecordUri?: string | null;
  serviceRecordCid?: string | null;
}

export interface HostClaimProofUser {
  did: string;
  handle: string;
}

export type HostClaimProofMethod =
  | "prebound"
  | "handle-domain"
  | "well-known"
  | "local-dev";

export type HostClaimProofResult =
  | { ok: true; method: HostClaimProofMethod }
  | { ok: false; reason: "missing_domain_proof" };

const WELL_KNOWN_PATH = "/.well-known/atmosphere-host.json";
const WELL_KNOWN_TIMEOUT_MS = 2500;
const WELL_KNOWN_MAX_BYTES = 32_000;

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

function normalizeDid(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(raw) ? raw : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function hostHandleMatchesDomain(
  host: string,
  handle: string | null | undefined,
): boolean {
  const normalizedHost = normalizeHost(host);
  const normalizedHandle = normalizeHost(handle);
  return !!normalizedHost && normalizedHost === normalizedHandle;
}

export function hostServiceRecordMatchesUser(
  host: string,
  serviceRecordUri: string | null | undefined,
  serviceRecordCid: string | null | undefined,
  user: HostClaimProofUser,
): boolean {
  const normalizedHost = normalizeHost(host);
  if (
    !normalizedHost || !serviceRecordUri?.trim() || !serviceRecordCid?.trim()
  ) {
    return false;
  }
  const expectedUri = `at://${user.did}/${HOST_SERVICE_NSID}/${normalizedHost}`;
  return serviceRecordUri.trim() === expectedUri;
}

export function hasPreboundHostAuthority(host: HostClaimProofHost): boolean {
  return host.source === "seeded" && !!normalizeHost(host.claimHandle);
}

export function isLocalDevHostClaim(host: string): boolean {
  const normalizedHost = normalizeHost(host);
  return IS_DEV && !!normalizedHost && normalizedHost.endsWith(".test");
}

export function wellKnownHostClaimMatchesUser(
  value: unknown,
  host: string,
  user: HostClaimProofUser,
): boolean {
  const record = asRecord(value);
  if (!record) return false;
  const manifestHost = normalizeHost(record.host) ??
    normalizeHost(record.domain);
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost || manifestHost !== normalizedHost) return false;

  const owner = asRecord(record.owner) ?? asRecord(record.claim) ?? record;
  const claimDid = normalizeDid(owner.claimDid) ?? normalizeDid(owner.did);
  const claimHandle = normalizeHost(owner.claimHandle) ??
    normalizeHost(owner.handle);
  return claimDid === user.did ||
    (!!claimHandle && claimHandle === normalizeHost(user.handle));
}

export async function fetchWellKnownHostClaimProof(
  host: string,
  user: HostClaimProofUser,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(`https://${normalizedHost}${WELL_KNOWN_PATH}`);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(
        Math.max(500, options.timeoutMs ?? WELL_KNOWN_TIMEOUT_MS),
      ),
    });
    if (!response.ok) return false;
    const text = await readResponseTextWithLimit(
      response,
      WELL_KNOWN_MAX_BYTES,
    );
    if (!text.ok) return false;
    const parsed = JSON.parse(text.text);
    return wellKnownHostClaimMatchesUser(parsed, normalizedHost, user);
  } catch {
    return false;
  }
}

export async function verifyHostClaimDomainProof(
  host: HostClaimProofHost,
  user: HostClaimProofUser,
): Promise<HostClaimProofResult> {
  if (hasPreboundHostAuthority(host)) {
    return { ok: true, method: "prebound" };
  }
  if (hostHandleMatchesDomain(host.host, user.handle)) {
    return { ok: true, method: "handle-domain" };
  }
  if (isLocalDevHostClaim(host.host)) {
    return { ok: true, method: "local-dev" };
  }
  if (await fetchWellKnownHostClaimProof(host.host, user)) {
    return { ok: true, method: "well-known" };
  }
  return { ok: false, reason: "missing_domain_proof" };
}

export function hostClaimProofMessage(): string {
  return "To claim a new host, sign in with the account whose handle matches the host domain, or add /.well-known/atmosphere-host.json to the host domain.";
}
