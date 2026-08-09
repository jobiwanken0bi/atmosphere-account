import {
  type AccountHostClaim,
  getAccountHostClaim,
  verifiedAccountHostClaimOwnerDid,
} from "./account-hosts.ts";
import { sessionSecret } from "./env.ts";
import { isDid } from "./identity.ts";
import {
  b64uDecode,
  b64uEncode,
  hmacSign,
  hmacVerify,
  randomB64u,
} from "./jose.ts";

const VERSION = "v1";
const DEFAULT_TTL_MS = 24 * 60 * 60_000;
const MAX_TTL_MS = 24 * 60 * 60_000;
const MAX_FUTURE_SKEW_MS = 60_000;
const MAX_TOKEN_LENGTH = 2_048;
const JTI_BYTES = 24;
const JTI_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export interface HostOwnerTransferIntent {
  host: string;
  previousOwnerDid: string;
  previousOwnerUpdatedAt: number;
  jti: string;
  issuedAt: number;
  expiresAt: number;
}

declare const RESOLVED_HOST_OWNER_TRANSFER: unique symbol;

/** A signed, live-owner-checked transfer context. */
export interface ResolvedHostOwnerTransferContext {
  token: string;
  intent: HostOwnerTransferIntent;
  readonly [RESOLVED_HOST_OWNER_TRANSFER]: true;
}

export type HostOwnerTransferClaimLoader = (
  host: string,
) => Promise<
  Pick<AccountHostClaim, "host" | "claimantDid" | "method" | "updatedAt"> | null
>;

export type HostOwnerTransferIntentFailureReason =
  | "missing"
  | "invalid"
  | "expired"
  | "host_mismatch"
  | "not_owner"
  | "owner_changed";

export type HostOwnerTransferIntentCreationResult =
  | {
    ok: true;
    value: { token: string; intent: HostOwnerTransferIntent };
  }
  | { ok: false; reason: "invalid" | "not_owner" };

export type HostOwnerTransferIntentReadResult =
  | {
    ok: true;
    value: { token: string; intent: HostOwnerTransferIntent };
  }
  | { ok: false; reason: "missing" | "invalid" | "expired" };

export type HostOwnerTransferIntentResolution =
  | {
    ok: true;
    value: ResolvedHostOwnerTransferContext;
  }
  | {
    ok: false;
    reason:
      | "missing"
      | "invalid"
      | "expired"
      | "host_mismatch"
      | "owner_changed";
  };

export interface HostOwnerTransferIntentOptions {
  now?: number;
  ttlMs?: number;
  signingSecret?: string;
  randomJti?: () => string;
  loadClaim?: HostOwnerTransferClaimLoader;
}

/** Mint a short-lived transfer capability only for the verified owner. */
export async function createHostOwnerTransferIntent(
  input: { host: string; authenticatedOwnerDid: string },
  options: HostOwnerTransferIntentOptions = {},
): Promise<HostOwnerTransferIntentCreationResult> {
  const host = normalizeTransferHost(input.host);
  const previousOwnerDid = input.authenticatedOwnerDid.trim();
  if (!host || !isDid(previousOwnerDid)) {
    return { ok: false, reason: "invalid" };
  }

  const claim = await (options.loadClaim ?? getAccountHostClaim)(host);
  const verifiedOwnerDid = claim
    ? await verifiedAccountHostClaimOwnerDid(host, claim)
    : null;
  if (!claim || verifiedOwnerDid !== previousOwnerDid) {
    return { ok: false, reason: "not_owner" };
  }

  const issuedAt = options.now ?? Date.now();
  const ttlMs = boundedTtl(options.ttlMs);
  const intent: HostOwnerTransferIntent = {
    host,
    previousOwnerDid,
    previousOwnerUpdatedAt: claim.updatedAt,
    jti: (options.randomJti ?? (() => randomB64u(JTI_BYTES)))(),
    issuedAt,
    expiresAt: issuedAt + ttlMs,
  };
  if (!validIntentShape(intent)) {
    return { ok: false, reason: "invalid" };
  }

  const payload = b64uEncode(JSON.stringify(intent));
  const tokenBody = `${VERSION}.${payload}`;
  const signature = await hmacSign(
    options.signingSecret ?? sessionSecret(),
    signingInput(tokenBody),
  );
  return {
    ok: true,
    value: { token: `${tokenBody}.${signature}`, intent },
  };
}

export async function readHostOwnerTransferIntent(
  token: string | null | undefined,
  options: Pick<HostOwnerTransferIntentOptions, "now" | "signingSecret"> = {},
): Promise<HostOwnerTransferIntentReadResult> {
  const raw = token?.trim() ?? "";
  if (!raw) return { ok: false, reason: "missing" };
  if (raw.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "invalid" };

  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    return { ok: false, reason: "invalid" };
  }
  const [version, payload, signature] = parts;
  if (
    !payload || !signature || !/^[A-Za-z0-9_-]+$/.test(payload) ||
    !/^[A-Za-z0-9_-]+$/.test(signature)
  ) {
    return { ok: false, reason: "invalid" };
  }

  const signatureIsValid = await hmacVerify(
    options.signingSecret ?? sessionSecret(),
    signingInput(`${version}.${payload}`),
    signature,
  ).catch(() => false);
  if (!signatureIsValid) return { ok: false, reason: "invalid" };

  let intent: unknown;
  try {
    intent = JSON.parse(new TextDecoder().decode(b64uDecode(payload)));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!validIntentShape(intent)) return { ok: false, reason: "invalid" };

  const now = options.now ?? Date.now();
  if (intent.expiresAt <= now) return { ok: false, reason: "expired" };
  if (
    intent.issuedAt > now + MAX_FUTURE_SKEW_MS ||
    intent.expiresAt <= intent.issuedAt ||
    intent.expiresAt - intent.issuedAt > MAX_TTL_MS
  ) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, value: { token: raw, intent } };
}

/** Resolve against the live owner immediately before accepting the transfer. */
export async function resolveHostOwnerTransferIntent(
  token: string | null | undefined,
  expectedHost: string,
  options: HostOwnerTransferIntentOptions = {},
): Promise<HostOwnerTransferIntentResolution> {
  const read = await readHostOwnerTransferIntent(token, options);
  if (!read.ok) return read;

  const host = normalizeTransferHost(expectedHost);
  if (!host || host !== read.value.intent.host) {
    return { ok: false, reason: "host_mismatch" };
  }

  const claim = await (options.loadClaim ?? getAccountHostClaim)(host);
  const verifiedOwnerDid = claim
    ? await verifiedAccountHostClaimOwnerDid(host, claim)
    : null;
  if (
    !claim ||
    verifiedOwnerDid !== read.value.intent.previousOwnerDid ||
    claim.updatedAt !== read.value.intent.previousOwnerUpdatedAt
  ) {
    return { ok: false, reason: "owner_changed" };
  }
  return {
    ok: true,
    value: read.value as ResolvedHostOwnerTransferContext,
  };
}

function signingInput(tokenBody: string): string {
  return `atmosphere-account:host-owner-transfer-intent\n${tokenBody}`;
}

function validIntentShape(value: unknown): value is HostOwnerTransferIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (
    keys.length !== 6 ||
    keys[0] !== "expiresAt" ||
    keys[1] !== "host" ||
    keys[2] !== "issuedAt" ||
    keys[3] !== "jti" ||
    keys[4] !== "previousOwnerDid" ||
    keys[5] !== "previousOwnerUpdatedAt"
  ) return false;
  return typeof input.host === "string" &&
    normalizeTransferHost(input.host) === input.host &&
    typeof input.previousOwnerDid === "string" &&
    isDid(input.previousOwnerDid) &&
    input.previousOwnerDid.trim() === input.previousOwnerDid &&
    typeof input.previousOwnerUpdatedAt === "number" &&
    Number.isSafeInteger(input.previousOwnerUpdatedAt) &&
    input.previousOwnerUpdatedAt >= 0 &&
    typeof input.jti === "string" && JTI_PATTERN.test(input.jti) &&
    typeof input.issuedAt === "number" &&
    Number.isSafeInteger(input.issuedAt) && input.issuedAt >= 0 &&
    typeof input.expiresAt === "number" &&
    Number.isSafeInteger(input.expiresAt) && input.expiresAt >= 0;
}

function normalizeTransferHost(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (host.length < 3 || host.length > 253 || !host.includes(".")) return null;
  return host.split(".").every((label) =>
      label.length > 0 && label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
    ? host
    : null;
}

function boundedTtl(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(1, Math.floor(value)));
}
