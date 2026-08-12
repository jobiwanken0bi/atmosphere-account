import type { DbClient } from "./db.ts";
import { accountHostContactEndpoint } from "./account-host-endpoints.ts";
import {
  COMAIL_API_KEY,
  COMAIL_SENDER_DID,
  HOST_CLAIM_EMAIL_FROM,
  hostClaimEvidenceSecret,
  hostClaimEvidenceSecretIsConfigured,
  IS_DEV,
} from "./env.ts";
import {
  consumeHostClaimChallenge,
  dbHostClaimChallengeStore,
  type HostClaimChallengeConsumeInput,
  type HostClaimChallengeConsumeResult,
  type HostClaimChallengeRecord,
  type HostClaimChallengeReservationLimits,
  type HostClaimChallengeStore,
} from "./host-claim-challenge.ts";
import { assertPublicDnsHostname, isDid } from "./identity.ts";
import { hmacSign, randomB64u, sha256B64u } from "./jose.ts";
import { fetchPdsServerDescription } from "./pds-server-description.ts";
import { isSafeRelativePath, readResponseTextWithLimit } from "./security.ts";

const CHALLENGE_TTL_MS = 20 * 60_000;
const CHALLENGE_WINDOW_MS = 60 * 60_000;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_PROOF_VERSION = "pds-contact-email-v2";
const COMAIL_ENDPOINT = "https://smtp.atmos.email/v1/send";
const DELIVERY_TIMEOUT_MS = 8_000;
const DELIVERY_RESPONSE_MAX_BYTES = 16_000;

export interface HostContactClaimTarget {
  host: string;
  displayName: string;
  /** Directory metadata only. Contact proof never trusts or fetches this. */
  serviceEndpoint: string | null;
}

export interface HostContactClaimUser {
  did: string;
  handle: string;
}

export type HostContactEmailChallengeRecord = HostClaimChallengeRecord;
export type HostContactEmailChallengeStore = HostClaimChallengeStore;
export type HostContactEmailChallengeReservationLimits =
  HostClaimChallengeReservationLimits;
export type HostContactEmailChallengeConsumeInput =
  HostClaimChallengeConsumeInput;
export type HostContactEmailChallengeConsumeResult =
  HostClaimChallengeConsumeResult;

export type HostContactEmailDeliveryInput =
  | {
    kind: "verification";
    to: string;
    host: string;
    displayName: string;
    claimantHandle: string;
    claimantDidFingerprint: string;
    verificationUrl: string;
  }
  | {
    kind: "dns_recovery";
    to: string;
    host: string;
    currentClaimantHandle: string;
    requestingHandle: string;
    requestingDidFingerprint: string;
    eligibleAt: number;
  };

export interface HostContactEmailDeliveryReceipt {
  deliveryId: string | null;
}

export interface HostContactEmailDelivery {
  send(input: HostContactEmailDeliveryInput): Promise<
    HostContactEmailDeliveryReceipt | void
  >;
}

export interface ComailHostContactEmailDeliveryConfig {
  apiKey: string;
  senderDid: string;
  from: string;
  fetchImpl?: typeof fetch;
}

export type HostContactEmailAvailability =
  | {
    status: "available";
    available: true;
    maskedEmail: string;
    deliveryConfigured: boolean;
  }
  | {
    status: "unavailable";
    available: false;
    maskedEmail: null;
    deliveryConfigured: boolean;
  }
  | {
    status: "lookup_error";
    available: false;
    maskedEmail: null;
    deliveryConfigured: boolean;
  };

export interface HostContactEmailOptions {
  now?: number;
  fetchImpl?: typeof fetch;
  store?: HostContactEmailChallengeStore;
  delivery?: HostContactEmailDelivery;
  fingerprintSecret?: string;
}

export type HostContactEmailRequestResult =
  | {
    ok: true;
    maskedEmail: string;
    expiresAt: number;
    deliveryId: string | null;
    previewUrl?: string;
  }
  | {
    ok: false;
    reason:
      | "contact_unavailable"
      | "lookup_error"
      | "delivery_unavailable"
      | "rate_limited"
      | "delivery_failed";
  };

export type HostContactEmailVerificationResult =
  | { ok: true }
  | HostContactEmailVerificationFailure;

export interface HostContactEmailVerificationFailure {
  ok: false;
  reason:
    | "invalid"
    | "expired"
    | "already_used"
    | "account_mismatch"
    | "contact_changed";
}

export type HostContactEmailVerificationFailureReason =
  HostContactEmailVerificationFailure["reason"];

export type PreparedHostContactEmailVerificationResult =
  | {
    ok: true;
    tokenHash: string;
    host: string;
    claimantDid: string;
    endpointOrigin: string;
    pdsDid: string;
    /** HMAC-SHA256; never the mailbox itself. */
    emailFingerprint: string;
    /** Versioned HMAC binding the exact host, PDS DID, mailbox and claimant. */
    methodBinding: string;
    requestedAt: number;
    expiresAt: number;
    deliveryId: string | null;
  }
  | HostContactEmailVerificationFailure;

export interface HostDnsRecoveryNotification {
  currentClaimantHandle: string;
  requestingHandle: string;
  requestingDid: string;
  eligibleAt: number;
}

export type HostDnsRecoveryNotificationResult =
  | {
    ok: true;
    maskedEmail: string;
    deliveryId: string | null;
    emailFingerprint: string;
    requestingDidFingerprint: string;
  }
  | {
    ok: false;
    reason:
      | "contact_unavailable"
      | "contact_changed"
      | "lookup_error"
      | "delivery_unavailable"
      | "delivery_failed";
  };

const HOST_CONTACT_EMAIL_VERIFICATION_FAILURES = new Set<
  HostContactEmailVerificationFailureReason
>([
  "invalid",
  "expired",
  "already_used",
  "account_mismatch",
  "contact_changed",
]);

export const dbHostContactEmailChallengeStore = dbHostClaimChallengeStore;

export function isHostContactEmailVerificationFailureReason(
  value: unknown,
): value is HostContactEmailVerificationFailureReason {
  return typeof value === "string" &&
    HOST_CONTACT_EMAIL_VERIFICATION_FAILURES.has(
      value as HostContactEmailVerificationFailureReason,
    );
}

export function hostContactEmailVerificationFailureMessage(
  reason: HostContactEmailVerificationFailureReason,
): string {
  switch (reason) {
    case "invalid":
      return "This verification link is invalid. Request a new email and use the link it contains.";
    case "expired":
      return "This verification link has expired. Request a new email to continue.";
    case "already_used":
      return "This verification link has already been used. Request a new email if this account does not manage the host yet.";
    case "account_mismatch":
      return "This verification link belongs to a different Atmosphere account. Switch to the account that requested it, or add that account.";
    case "contact_changed":
      return "The PDS identity or contact email changed after this link was sent. Request a new email using the current details.";
  }
}

export async function getHostContactEmailAvailability(
  target: HostContactClaimTarget,
  options: HostContactEmailOptions = {},
): Promise<HostContactEmailAvailability> {
  const discovery = await discoverAnnouncedContact(target, options.fetchImpl);
  const deliveryConfigured = !!options.delivery || IS_DEV ||
    !!configuredDelivery();
  if (discovery.status === "available") {
    return {
      status: "available",
      available: true,
      maskedEmail: maskEmail(discovery.contact.email),
      deliveryConfigured,
    };
  }
  return {
    status: discovery.status,
    available: false,
    maskedEmail: null,
    deliveryConfigured,
  };
}

export async function requestHostContactEmailChallenge(
  target: HostContactClaimTarget,
  user: HostContactClaimUser,
  publicOrigin: string,
  claimPath: string,
  options: HostContactEmailOptions = {},
): Promise<HostContactEmailRequestResult> {
  const discovery = await discoverAnnouncedContact(target, options.fetchImpl);
  if (discovery.status === "lookup_error") {
    return { ok: false, reason: "lookup_error" };
  }
  if (discovery.status === "unavailable" || !isDid(user.did)) {
    return { ok: false, reason: "contact_unavailable" };
  }
  const contact = discovery.contact;

  const delivery = options.delivery ?? configuredDelivery();
  const previewOnly = !delivery && IS_DEV;
  if (!delivery && !previewOnly) {
    return { ok: false, reason: "delivery_unavailable" };
  }

  let verificationUrl: string;
  const token = randomB64u(TOKEN_BYTES);
  try {
    verificationUrl = buildVerificationUrl(publicOrigin, claimPath, token);
  } catch {
    return { ok: false, reason: "delivery_failed" };
  }

  const ts = normalizedNow(options.now);
  const store = options.store ?? dbHostContactEmailChallengeStore;
  const emailFingerprint = await fingerprintEmail(
    contact.email,
    options.fingerprintSecret,
  );
  const methodFingerprint = await fingerprintEmailProofBinding(
    contact,
    emailFingerprint,
    user.did,
    options.fingerprintSecret,
  );
  const tokenHash = await sha256B64u(token);
  const claimantDidFingerprint = shortFingerprint(
    await fingerprintDid(user.did, options.fingerprintSecret),
  );
  const expiresAt = ts + CHALLENGE_TTL_MS;
  const record: HostContactEmailChallengeRecord = {
    tokenHash,
    host: contact.host,
    claimantDid: user.did,
    claimantHandle: user.handle,
    // Generic rate limiting counts this independently of claimant/host so one
    // mailbox cannot bypass its cap by varying either identity.
    methodFingerprint: emailFingerprint,
    // The separate proof binding prevents a token being moved across the host,
    // PDS DID, mailbox declaration, or requesting account.
    methodBinding: methodFingerprint,
    deliveryId: null,
    createdAt: ts,
    expiresAt,
    consumedAt: null,
  };
  const reserved = await store.reserve(record, {
    since: ts - CHALLENGE_WINDOW_MS,
    // The generic store compares inclusively, so +1 permits a resend exactly
    // 60 seconds after the previous request (matching the UI countdown).
    cooldownSince: ts - 60_000 + 1,
    host: 5,
    claimant: 10,
    method: 5,
  });
  if (!reserved) return { ok: false, reason: "rate_limited" };

  if (previewOnly) {
    return {
      ok: true,
      maskedEmail: maskEmail(contact.email),
      expiresAt,
      deliveryId: null,
      previewUrl: verificationUrl,
    };
  }

  try {
    const receipt = await delivery!.send({
      kind: "verification",
      to: contact.email,
      host: contact.host,
      displayName: target.displayName,
      claimantHandle: user.handle,
      claimantDidFingerprint,
      verificationUrl,
    });
    const deliveryId = receipt?.deliveryId ?? null;
    if (deliveryId) {
      await store.recordDelivery(tokenHash, deliveryId).catch(() => {
        console.error("[host-claim] delivery receipt persistence failed");
      });
    }
    return {
      ok: true,
      maskedEmail: maskEmail(contact.email),
      expiresAt,
      deliveryId,
    };
  } catch {
    // Keep the opaque reservation: failed/ambiguous provider responses must
    // still count toward cooldown and hourly anti-spam limits. The recipient
    // may also have received a message even when its acknowledgement failed.
    return { ok: false, reason: "delivery_failed" };
  }
}

/** Read-only GET inspection. It neither refreshes contact metadata nor consumes. */
export async function inspectHostContactEmailChallenge(
  target: HostContactClaimTarget,
  user: HostContactClaimUser,
  token: string,
  options: HostContactEmailOptions = {},
): Promise<HostContactEmailVerificationResult> {
  const record = await readChallenge(target, user, token, options);
  return record.ok ? { ok: true } : record;
}

export async function prepareHostContactEmailChallenge(
  target: HostContactClaimTarget,
  user: HostContactClaimUser,
  token: string,
  options: HostContactEmailOptions = {},
): Promise<PreparedHostContactEmailVerificationResult> {
  const checked = await readChallenge(target, user, token, options);
  if (!checked.ok) return checked;

  // A successful click is evidence only if the exact host still announces the
  // same PDS DID and mailbox immediately before the ownership transaction.
  const current = await readAnnouncedContact(target, options.fetchImpl);
  if (!current) return { ok: false, reason: "contact_changed" };
  const emailFingerprint = await fingerprintEmail(
    current.email,
    options.fingerprintSecret,
  );
  const expectedBinding = await fingerprintEmailProofBinding(
    current,
    emailFingerprint,
    user.did,
    options.fingerprintSecret,
  );
  if (expectedBinding !== checked.record.methodBinding) {
    return { ok: false, reason: "contact_changed" };
  }

  return {
    ok: true,
    tokenHash: checked.record.tokenHash,
    host: checked.record.host,
    claimantDid: checked.record.claimantDid,
    endpointOrigin: current.endpointOrigin,
    pdsDid: current.pdsDid,
    emailFingerprint,
    methodBinding: checked.record.methodBinding,
    requestedAt: checked.record.createdAt,
    expiresAt: checked.record.expiresAt,
    deliveryId: checked.record.deliveryId,
  };
}

export async function verifyHostContactEmailChallenge(
  target: HostContactClaimTarget,
  user: HostContactClaimUser,
  token: string,
  options: HostContactEmailOptions = {},
): Promise<HostContactEmailVerificationResult> {
  const prepared = await prepareHostContactEmailChallenge(
    target,
    user,
    token,
    options,
  );
  if (!prepared.ok) return prepared;
  const store = options.store ?? dbHostContactEmailChallengeStore;
  return await store.consume({
    tokenHash: prepared.tokenHash,
    host: prepared.host,
    claimantDid: prepared.claimantDid,
    consumedAt: normalizedNow(options.now),
  });
}

/** Use this inside the same transaction that writes host ownership. */
export async function consumeHostContactEmailChallenge(
  client: DbClient,
  input: HostContactEmailChallengeConsumeInput,
): Promise<HostContactEmailChallengeConsumeResult> {
  return await consumeHostClaimChallenge(client, input);
}

/** Opaque token identifier for idempotent ownership-completion lookup. */
export async function hashHostContactEmailToken(
  token: string,
): Promise<string | null> {
  return TOKEN_PATTERN.test(token) ? await sha256B64u(token) : null;
}

/**
 * Notify the original claim mailbox only when the exact PDS host still
 * announces that same mailbox. The immutable expected HMAC comes from the
 * original email-claim evidence, preventing a DNS requester from repointing
 * describeServer contact metadata and receiving their own warning.
 */
export async function notifyHostContactEmailOfDnsRecovery(
  target: HostContactClaimTarget,
  notification: HostDnsRecoveryNotification,
  expectedEmailFingerprint: string,
  options: Pick<
    HostContactEmailOptions,
    "fetchImpl" | "delivery" | "fingerprintSecret"
  > = {},
): Promise<HostDnsRecoveryNotificationResult> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(expectedEmailFingerprint)) {
    return { ok: false, reason: "contact_changed" };
  }
  const discovery = await discoverAnnouncedContact(target, options.fetchImpl);
  if (discovery.status === "lookup_error") {
    return { ok: false, reason: "lookup_error" };
  }
  if (
    discovery.status === "unavailable" || !isDid(notification.requestingDid)
  ) {
    return { ok: false, reason: "contact_unavailable" };
  }
  const contact = discovery.contact;
  const delivery = options.delivery ?? configuredDelivery();
  if (!delivery) return { ok: false, reason: "delivery_unavailable" };
  const requestingDidFingerprint = await fingerprintDid(
    notification.requestingDid,
    options.fingerprintSecret,
  );
  const emailFingerprint = await fingerprintEmail(
    contact.email,
    options.fingerprintSecret,
  );
  if (emailFingerprint !== expectedEmailFingerprint) {
    return { ok: false, reason: "contact_changed" };
  }
  try {
    const receipt = await delivery.send({
      kind: "dns_recovery",
      to: contact.email,
      host: contact.host,
      currentClaimantHandle: notification.currentClaimantHandle,
      requestingHandle: notification.requestingHandle,
      requestingDidFingerprint: shortFingerprint(requestingDidFingerprint),
      eligibleAt: notification.eligibleAt,
    });
    return {
      ok: true,
      maskedEmail: maskEmail(contact.email),
      deliveryId: receipt?.deliveryId ?? null,
      emailFingerprint,
      requestingDidFingerprint,
    };
  } catch {
    return { ok: false, reason: "delivery_failed" };
  }
}

async function readChallenge(
  target: HostContactClaimTarget,
  user: HostContactClaimUser,
  token: string,
  options: HostContactEmailOptions,
): Promise<
  | { ok: true; record: HostContactEmailChallengeRecord }
  | HostContactEmailVerificationFailure
> {
  if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: "invalid" };
  const endpointOrigin = accountHostContactEndpoint(target.host);
  if (!endpointOrigin) return { ok: false, reason: "invalid" };
  const host = new URL(endpointOrigin).hostname;
  const store = options.store ?? dbHostContactEmailChallengeStore;
  const record = await store.read(await sha256B64u(token));
  if (
    !record || record.host !== host ||
    !record.methodBinding?.startsWith(`${EMAIL_PROOF_VERSION}.`)
  ) return { ok: false, reason: "invalid" };
  if (record.claimantDid !== user.did) {
    return { ok: false, reason: "account_mismatch" };
  }
  if (record.consumedAt !== null) {
    return { ok: false, reason: "already_used" };
  }
  if (record.expiresAt < normalizedNow(options.now)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, record };
}

interface AnnouncedContact {
  host: string;
  endpointOrigin: string;
  pdsDid: string;
  email: string;
}

async function readAnnouncedContact(
  target: HostContactClaimTarget,
  fetchImpl?: typeof fetch,
): Promise<AnnouncedContact | null> {
  const discovery = await discoverAnnouncedContact(target, fetchImpl);
  return discovery.status === "available" ? discovery.contact : null;
}

type AnnouncedContactDiscovery =
  | { status: "available"; contact: AnnouncedContact }
  | { status: "unavailable" }
  | { status: "lookup_error" };

async function discoverAnnouncedContact(
  target: HostContactClaimTarget,
  fetchImpl?: typeof fetch,
): Promise<AnnouncedContactDiscovery> {
  // This origin is derived only from the normalized directory host. In
  // particular, target.serviceEndpoint and compiled provider mappings are not
  // considered for email proof.
  const endpointOrigin = accountHostContactEndpoint(target.host);
  if (!endpointOrigin) return { status: "lookup_error" };
  // Production always resolves and rejects private answers before fetch. Local
  // tests/fixtures may bypass DNS only by explicitly injecting their fetcher;
  // ordinary dev traffic receives the same SSRF check as production.
  if (!IS_DEV || !fetchImpl) {
    try {
      await assertPublicDnsHostname(new URL(endpointOrigin).hostname);
    } catch {
      return { status: "lookup_error" };
    }
  }
  const description = await fetchPdsServerDescription(endpointOrigin, {
    fetchImpl,
    cacheTtlMs: 0,
  });
  if (!description) return { status: "lookup_error" };
  const pdsDid = description?.did?.trim() ?? "";
  const email = normalizeEmail(description?.contactEmail);
  if (!isDid(pdsDid)) return { status: "lookup_error" };
  if (!email) return { status: "unavailable" };
  return {
    status: "available",
    contact: {
      host: new URL(endpointOrigin).hostname,
      endpointOrigin,
      pdsDid,
      email,
    },
  };
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (
    email.length < 3 || email.length > 254 || email.includes("\r") ||
    email.includes("\n") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) return null;
  const at = email.lastIndexOf("@");
  return `${email.slice(0, at)}@${email.slice(at + 1).toLowerCase()}`;
}

export function maskEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!normalized) return "the PDS contact address";
  const at = normalized.lastIndexOf("@");
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${
    "•".repeat(Math.max(3, Math.min(8, local.length - visible.length)))
  }@${domain}`;
}

async function fingerprintEmail(
  email: string,
  secret = hostClaimEvidenceSecret(),
): Promise<string> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("invalid PDS contact email");
  return await hmacSign(
    secret,
    // RFC mailbox local-parts can be case-sensitive. Preserve that exact
    // declaration while normalizeEmail canonicalizes only the DNS domain.
    `host-contact-email\n${normalized}`,
  );
}

async function fingerprintEmailProofBinding(
  contact: AnnouncedContact,
  emailFingerprint: string,
  claimantDid: string,
  secret = hostClaimEvidenceSecret(),
): Promise<string> {
  const binding = await hmacSign(
    secret,
    [
      EMAIL_PROOF_VERSION,
      contact.host,
      contact.pdsDid,
      emailFingerprint,
      claimantDid,
    ].join("\n"),
  );
  return `${EMAIL_PROOF_VERSION}.${binding}`;
}

async function fingerprintDid(
  did: string,
  secret = hostClaimEvidenceSecret(),
): Promise<string> {
  return await hmacSign(secret, `host-recovery-requester\n${did}`);
}

function shortFingerprint(value: string): string {
  return value.slice(0, 12);
}

function buildVerificationUrl(
  publicOrigin: string,
  claimPath: string,
  token: string,
): string {
  const base = new URL(publicOrigin);
  if (
    (base.protocol !== "https:" && !(IS_DEV && base.protocol === "http:")) ||
    base.username || base.password || !isSafeRelativePath(claimPath)
  ) throw new Error("unsafe verification URL");
  const url = new URL(claimPath, base.origin);
  if (url.origin !== base.origin) throw new Error("cross-origin claim path");
  url.searchParams.delete("token");
  url.searchParams.set("email_token", token);
  return url.toString();
}

function normalizedNow(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) >= 0
    ? Math.floor(value as number)
    : Date.now();
}

function configuredDelivery(): HostContactEmailDelivery | null {
  if (
    !COMAIL_API_KEY || !COMAIL_SENDER_DID || !HOST_CLAIM_EMAIL_FROM ||
    !hostClaimEvidenceSecretIsConfigured()
  ) {
    return null;
  }
  try {
    return createComailHostContactEmailDelivery({
      apiKey: COMAIL_API_KEY,
      senderDid: COMAIL_SENDER_DID,
      from: HOST_CLAIM_EMAIL_FROM,
    });
  } catch {
    return null;
  }
}

export function createComailHostContactEmailDelivery(
  config: ComailHostContactEmailDeliveryConfig,
): HostContactEmailDelivery {
  const apiKey = config.apiKey.trim();
  const senderDid = config.senderDid.trim();
  const from = normalizeEmail(config.from);
  if (!apiKey || !isDid(senderDid) || !from) {
    throw new Error("Invalid host-claim email delivery configuration");
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    async send(input) {
      const response = await fetchImpl(COMAIL_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "x-atmos-did": senderDid,
        },
        body: JSON.stringify({
          from,
          to: input.to,
          subject: emailSubject(input),
          text: emailText(input),
          html: emailHtml(input),
          // Comail's HTTP contract has no generic "security" category. The
          // recipient initiates verification, so that message may use the
          // suppression-bypassing verification category. A recovery warning is
          // operator-initiated and must stay untagged rather than masquerading
          // as a recipient-initiated authentication message.
          ...(input.kind === "verification"
            ? { category: "verification" }
            : {}),
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      const body = await readResponseTextWithLimit(
        response,
        DELIVERY_RESPONSE_MAX_BYTES,
      );
      if (!response.ok || !body.ok) {
        throw new Error(`Comail delivery failed (${response.status})`);
      }
      const result = parseComailDeliveryResult(body.text);
      if (
        !result || (result.rejected && result.rejected.length > 0) ||
        !result.accepted.some((entry) =>
          entry.recipient.toLowerCase() === input.to.toLowerCase()
        )
      ) throw new Error("Comail did not accept the intended recipient");
      const accepted = result.accepted.find((entry) =>
        entry.recipient.toLowerCase() === input.to.toLowerCase()
      );
      return { deliveryId: accepted?.deliveryId ?? null };
    },
  };
}

function parseComailDeliveryResult(body: string): {
  accepted: Array<{ recipient: string; deliveryId: string | null }>;
  rejected: unknown[] | null;
} | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.accepted)) return null;
  const rejected = result.rejected == null
    ? null
    : Array.isArray(result.rejected)
    ? result.rejected
    : undefined;
  if (rejected === undefined) return null;
  const accepted = result.accepted.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const acceptedRecord = entry as Record<string, unknown>;
    const recipient = acceptedRecord.recipient;
    if (typeof recipient !== "string") return null;
    const rawId = acceptedRecord.messageId;
    return {
      recipient,
      deliveryId: sanitizeDeliveryId(rawId),
    };
  });
  if (accepted.some((recipient) => recipient === null)) return null;
  return {
    accepted: accepted as Array<{
      recipient: string;
      deliveryId: string | null;
    }>,
    rejected,
  };
}

function sanitizeDeliveryId(value: unknown): string | null {
  const candidate = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string"
    ? value
    : "";
  return /^[A-Za-z0-9._:@\/-]{1,256}$/.test(candidate) ? candidate : null;
}

function emailSubject(input: HostContactEmailDeliveryInput): string {
  return input.kind === "verification"
    ? `Verify management of ${input.host}`
    : `DNS recovery started for ${input.host}`;
}

function emailText(input: HostContactEmailDeliveryInput): string {
  if (input.kind === "verification") {
    return `Verify management of ${input.host}\n\n@${input.claimantHandle} asked to manage this account host on Atmosphere Account (account fingerprint: ${input.claimantDidFingerprint}).\n\nReview and confirm this request (expires in 20 minutes):\n${input.verificationUrl}\n\nIf you did not request this, ignore this email.`;
  }
  return `DNS recovery started for ${input.host}\n\nThe current claimant is @${input.currentClaimantHandle}. @${input.requestingHandle} requested recovery (account fingerprint: ${input.requestingDidFingerprint}). Starting ${
    formatTimestamp(input.eligibleAt)
  }, the requester can generate and verify a fresh DNS record to finish recovery.\n\nReview your host ownership if you did not expect this request.`;
}

function emailHtml(input: HostContactEmailDeliveryInput): string {
  if (input.kind === "verification") {
    const host = escapeHtml(input.host);
    const handle = escapeHtml(input.claimantHandle);
    const fingerprint = escapeHtml(input.claimantDidFingerprint);
    const url = escapeHtml(input.verificationUrl);
    return `<p><strong>Verify management of ${host}</strong></p><p>@${handle} asked to manage this account host on Atmosphere Account (account fingerprint: ${fingerprint}).</p><p><a href="${url}">Review and confirm this request</a>. This link expires in 20 minutes.</p><p>If you did not request this, ignore this email.</p>`;
  }
  const host = escapeHtml(input.host);
  const current = escapeHtml(input.currentClaimantHandle);
  const requester = escapeHtml(input.requestingHandle);
  const fingerprint = escapeHtml(input.requestingDidFingerprint);
  const eligibleAt = escapeHtml(formatTimestamp(input.eligibleAt));
  return `<p><strong>DNS recovery started for ${host}</strong></p><p>The current claimant is @${current}. @${requester} requested recovery (account fingerprint: ${fingerprint}). Starting ${eligibleAt}, the requester can generate and verify a fresh DNS record to finish recovery.</p><p>Review your host ownership if you did not expect this request.</p>`;
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value)) return "an invalid time";
  return new Date(value).toISOString();
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
