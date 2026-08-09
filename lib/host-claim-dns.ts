import type { DbClient } from "./db.ts";
import {
  consumeHostClaimChallenge,
  dbHostClaimChallengeStore,
  type HostClaimChallengeConsumeInput,
  type HostClaimChallengeStore,
} from "./host-claim-challenge.ts";
import { isHandle } from "./identity.ts";
import { randomB64u, sha256B64u } from "./jose.ts";
import { isPrivateNetworkHostname } from "./security.ts";

const CHALLENGE_TTL_MS = 24 * 60 * 60_000;
const CHALLENGE_WINDOW_MS = 60 * 60_000;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DNS_RECORD_LABEL = "_atmosphere-account";
const DNS_VALUE_PREFIX = "atmosphere-account-verification=";
const DNS_LOOKUP_TIMEOUT_MS = 4_000;
const MAX_DNS_RECORDS = 32;
const MAX_DNS_CHUNKS_PER_RECORD = 32;
const MAX_DNS_RECORD_BYTES = 2_048;
const MAX_DNS_RESPONSE_BYTES = 16_384;

/**
 * DNS challenges use the generic challenge table. This method marker is
 * checked before every lookup, so historical tokens from another proof method
 * can never be accepted as DNS proof.
 */
const DNS_PROOF_FINGERPRINT_PREFIX = "dns-v1:";

export interface HostDnsClaimTarget {
  host: string;
}

export interface HostDnsClaimUser {
  did: string;
  handle: string;
}

/** A TXT answer is an array because DNS may split one record into chunks. */
export interface HostDnsTxtResolver {
  resolve(name: string): Promise<readonly (readonly string[])[]>;
}

export interface HostDnsChallengeOptions {
  now?: number;
  store?: HostClaimChallengeStore;
  resolver?: HostDnsTxtResolver;
  /** Test seam only. Production callers use the fixed runtime timeout. */
  lookupTimeoutMs?: number;
}

export type HostDnsChallengeRequestResult =
  | {
    ok: true;
    host: string;
    recordName: string;
    recordValue: string;
    verificationToken: string;
    expiresAt: number;
  }
  | { ok: false; reason: "invalid_host" | "rate_limited" };

export type HostDnsChallengeVerificationFailureReason =
  | "invalid"
  | "expired"
  | "already_used"
  | "account_mismatch"
  | "dns_unavailable"
  | "record_not_found";

export type HostDnsChallengeVerificationResult =
  | { ok: true }
  | { ok: false; reason: HostDnsChallengeVerificationFailureReason };

const HOST_DNS_VERIFICATION_FAILURES = new Set<
  HostDnsChallengeVerificationFailureReason
>([
  "invalid",
  "expired",
  "already_used",
  "account_mismatch",
  "dns_unavailable",
  "record_not_found",
]);

export type PreparedHostDnsChallengeResult =
  | {
    ok: true;
    tokenHash: string;
    host: string;
    claimantDid: string;
  }
  | { ok: false; reason: HostDnsChallengeVerificationFailureReason };

export type InspectedHostDnsChallengeResult =
  | {
    ok: true;
    host: string;
    recordName: string;
    recordValue: string;
    verificationToken: string;
    expiresAt: number;
  }
  | { ok: false; reason: HostDnsChallengeVerificationFailureReason };

export function hostDnsChallengeRecordName(host: string): string | null {
  const normalized = normalizeClaimHost(host);
  return normalized ? `${DNS_RECORD_LABEL}.${normalized}` : null;
}

export function hostDnsChallengeRecordValue(token: string): string | null {
  return TOKEN_PATTERN.test(token) ? `${DNS_VALUE_PREFIX}${token}` : null;
}

export function hostDnsChallengeVerificationFailureMessage(
  reason: HostDnsChallengeVerificationFailureReason,
): string {
  switch (reason) {
    case "invalid":
      return "This DNS verification is invalid. Start a new verification.";
    case "expired":
      return "This DNS verification has expired. Start a new verification and update the TXT record.";
    case "already_used":
      return "This DNS verification has already been used.";
    case "account_mismatch":
      return "This DNS verification belongs to a different account. Switch to the account that started it.";
    case "dns_unavailable":
      return "DNS could not be checked right now. Try again in a moment.";
    case "record_not_found":
      return "The exact TXT value was not found yet. Check the record and try again after DNS has updated.";
  }
}

export function isHostDnsChallengeVerificationFailureReason(
  value: unknown,
): value is HostDnsChallengeVerificationFailureReason {
  return typeof value === "string" &&
    HOST_DNS_VERIFICATION_FAILURES.has(
      value as HostDnsChallengeVerificationFailureReason,
    );
}

const systemDnsTxtResolver: HostDnsTxtResolver = {
  async resolve(name) {
    return await Deno.resolveDns(name, "TXT") as string[][];
  },
};

/** Reserve an account-bound challenge while persisting only its token hash. */
export async function requestHostDnsChallenge(
  target: HostDnsClaimTarget,
  user: HostDnsClaimUser,
  options: HostDnsChallengeOptions = {},
): Promise<HostDnsChallengeRequestResult> {
  const host = normalizeClaimHost(target.host);
  if (!host) return { ok: false, reason: "invalid_host" };

  const ts = options.now ?? Date.now();
  const token = randomB64u(TOKEN_BYTES);
  const tokenHash = await sha256B64u(token);
  const proofFingerprint = await dnsProofFingerprint(host);
  const store = options.store ?? dbHostClaimChallengeStore;
  const expiresAt = ts + CHALLENGE_TTL_MS;
  const reserved = await store.reserve(
    {
      tokenHash,
      host,
      claimantDid: user.did,
      claimantHandle: user.handle,
      methodFingerprint: proofFingerprint,
      createdAt: ts,
      expiresAt,
      consumedAt: null,
    },
    {
      since: ts - CHALLENGE_WINDOW_MS,
      host: 5,
      claimant: 10,
      method: 5,
    },
  );
  if (!reserved) return { ok: false, reason: "rate_limited" };

  return {
    ok: true,
    host,
    recordName: hostDnsChallengeRecordName(host)!,
    recordValue: hostDnsChallengeRecordValue(token)!,
    verificationToken: token,
    expiresAt,
  };
}

/** Restore a challenge for display without performing DNS I/O. */
export async function inspectHostDnsChallenge(
  target: HostDnsClaimTarget,
  user: HostDnsClaimUser,
  token: string,
  options: Pick<HostDnsChallengeOptions, "now" | "store"> = {},
): Promise<InspectedHostDnsChallengeResult> {
  const checked = await readHostDnsChallenge(target, user, token, options);
  if (!checked.ok) return checked;
  const recordName = hostDnsChallengeRecordName(checked.host);
  const recordValue = hostDnsChallengeRecordValue(token);
  if (!recordName || !recordValue) return { ok: false, reason: "invalid" };
  return {
    ok: true,
    host: checked.host,
    recordName,
    recordValue,
    verificationToken: token,
    expiresAt: checked.expiresAt,
  };
}

/** Check live DNS without consuming the proof. Claim completion consumes the
 * returned hash inside the same transaction as the ownership write. */
export async function prepareHostDnsChallenge(
  target: HostDnsClaimTarget,
  user: HostDnsClaimUser,
  token: string,
  options: HostDnsChallengeOptions = {},
): Promise<PreparedHostDnsChallengeResult> {
  const checked = await readHostDnsChallenge(target, user, token, options);
  if (!checked.ok) return checked;

  const recordName = hostDnsChallengeRecordName(checked.host);
  const expectedValue = hostDnsChallengeRecordValue(token);
  if (!recordName || !expectedValue) return { ok: false, reason: "invalid" };
  const lookup = await lookupExactTxtValue(
    recordName,
    expectedValue,
    options.resolver ?? systemDnsTxtResolver,
    options.lookupTimeoutMs ?? DNS_LOOKUP_TIMEOUT_MS,
  );
  if (!lookup.ok) return lookup;

  return {
    ok: true,
    tokenHash: checked.tokenHash,
    host: checked.host,
    claimantDid: checked.claimantDid,
  };
}

/** Convenience verifier for callers that do not need an atomic claim write. */
export async function verifyHostDnsChallenge(
  target: HostDnsClaimTarget,
  user: HostDnsClaimUser,
  token: string,
  options: HostDnsChallengeOptions = {},
): Promise<HostDnsChallengeVerificationResult> {
  const prepared = await prepareHostDnsChallenge(target, user, token, options);
  if (!prepared.ok) return prepared;
  const store = options.store ?? dbHostClaimChallengeStore;
  return await store.consume({
    tokenHash: prepared.tokenHash,
    host: prepared.host,
    claimantDid: prepared.claimantDid,
    consumedAt: options.now ?? Date.now(),
  });
}

export async function consumeHostDnsChallenge(
  client: DbClient,
  input: HostClaimChallengeConsumeInput,
): Promise<HostDnsChallengeVerificationResult> {
  return await consumeHostClaimChallenge(client, input);
}

async function readHostDnsChallenge(
  target: HostDnsClaimTarget,
  user: HostDnsClaimUser,
  token: string,
  options: Pick<HostDnsChallengeOptions, "now" | "store">,
): Promise<
  | {
    ok: true;
    tokenHash: string;
    host: string;
    claimantDid: string;
    expiresAt: number;
  }
  | { ok: false; reason: HostDnsChallengeVerificationFailureReason }
> {
  const host = normalizeClaimHost(target.host);
  if (!host || !TOKEN_PATTERN.test(token)) {
    return { ok: false, reason: "invalid" };
  }
  const tokenHash = await sha256B64u(token);
  const store = options.store ?? dbHostClaimChallengeStore;
  const record = await store.read(tokenHash);
  if (
    !record || record.host !== host ||
    record.methodFingerprint !== await dnsProofFingerprint(host)
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (record.claimantDid !== user.did) {
    return { ok: false, reason: "account_mismatch" };
  }
  if (record.consumedAt !== null) {
    return { ok: false, reason: "already_used" };
  }
  if (record.expiresAt < (options.now ?? Date.now())) {
    return { ok: false, reason: "expired" };
  }
  return {
    ok: true,
    tokenHash,
    host,
    claimantDid: record.claimantDid,
    expiresAt: record.expiresAt,
  };
}

async function lookupExactTxtValue(
  recordName: string,
  expectedValue: string,
  resolver: HostDnsTxtResolver,
  timeoutMs: number,
): Promise<
  | { ok: true }
  | { ok: false; reason: "dns_unavailable" | "record_not_found" }
> {
  let answers: readonly (readonly string[])[];
  let timeout: number | undefined;
  try {
    answers = await Promise.race([
      resolver.resolve(recordName),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("DNS lookup timed out")),
          boundedLookupTimeout(timeoutMs),
        );
      }),
    ]);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Deno.errors.NotFound
        ? "record_not_found"
        : "dns_unavailable",
    };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }

  if (!Array.isArray(answers) || answers.length > MAX_DNS_RECORDS) {
    return { ok: false, reason: "dns_unavailable" };
  }
  let responseBytes = 0;
  const encoder = new TextEncoder();
  for (const chunks of answers) {
    if (!Array.isArray(chunks) || chunks.length > MAX_DNS_CHUNKS_PER_RECORD) {
      return { ok: false, reason: "dns_unavailable" };
    }
    let recordBytes = 0;
    let value = "";
    for (const chunk of chunks) {
      if (typeof chunk !== "string") {
        return { ok: false, reason: "dns_unavailable" };
      }
      const bytes = encoder.encode(chunk).byteLength;
      recordBytes += bytes;
      responseBytes += bytes;
      if (
        recordBytes > MAX_DNS_RECORD_BYTES ||
        responseBytes > MAX_DNS_RESPONSE_BYTES
      ) {
        return { ok: false, reason: "dns_unavailable" };
      }
      value += chunk;
    }
    if (value === expectedValue) return { ok: true };
  }
  return { ok: false, reason: "record_not_found" };
}

function normalizeClaimHost(value: unknown): string | null {
  const host = typeof value === "string"
    ? value.trim().replace(/^@+/, "").toLowerCase().replace(/\.+$/, "")
    : "";
  if (
    !isHandle(host) || isPrivateNetworkHostname(host) ||
    host === "test" || host.endsWith(".test")
  ) return null;
  if (`${DNS_RECORD_LABEL}.${host}`.length > 253) return null;
  return host;
}

async function dnsProofFingerprint(host: string): Promise<string> {
  return `${DNS_PROOF_FINGERPRINT_PREFIX}${await sha256B64u(
    `host-dns-proof\n${host}`,
  )}`;
}

function boundedLookupTimeout(value: number): number {
  if (!Number.isFinite(value)) return DNS_LOOKUP_TIMEOUT_MS;
  return Math.max(1, Math.min(DNS_LOOKUP_TIMEOUT_MS, Math.floor(value)));
}
