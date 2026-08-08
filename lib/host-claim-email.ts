import { dbBackend, type DbClient, withDb, withDbTransaction } from "./db.ts";
import { accountHostContactEndpointIsBound } from "./account-host-endpoints.ts";
import {
  COMAIL_API_KEY,
  COMAIL_SENDER_DID,
  HOST_CLAIM_EMAIL_FROM,
  IS_DEV,
  sessionSecret,
} from "./env.ts";
import { randomB64u, sha256B64u } from "./jose.ts";
import { fetchPdsServerDescription } from "./pds-server-description.ts";
import { readResponseTextWithLimit } from "./security.ts";

const CHALLENGE_TTL_MS = 20 * 60_000;
const CHALLENGE_WINDOW_MS = 60 * 60_000;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const COMAIL_ENDPOINT = "https://smtp.atmos.email/v1/send";
const DELIVERY_TIMEOUT_MS = 8_000;
const DELIVERY_RESPONSE_MAX_BYTES = 16_000;

export interface HostContactClaimTarget {
  host: string;
  displayName: string;
  serviceEndpoint: string | null;
}

export interface HostContactClaimUser {
  did: string;
  handle: string;
}

export interface HostContactEmailChallengeRecord {
  tokenHash: string;
  host: string;
  claimantDid: string;
  claimantHandle: string;
  emailFingerprint: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface HostContactEmailChallengeStore {
  reserve(
    record: HostContactEmailChallengeRecord,
    limits: HostContactEmailChallengeReservationLimits,
  ): Promise<boolean>;
  remove(tokenHash: string): Promise<void>;
  read(tokenHash: string): Promise<HostContactEmailChallengeRecord | null>;
  consume(input: HostContactEmailChallengeConsumeInput): Promise<
    HostContactEmailChallengeConsumeResult
  >;
}

export interface HostContactEmailChallengeReservationLimits {
  since: number;
  host: number;
  claimant: number;
  email: number;
}

export interface HostContactEmailDelivery {
  send(input: {
    to: string;
    host: string;
    displayName: string;
    claimantHandle: string;
    verificationUrl: string;
  }): Promise<void>;
}

export interface ComailHostContactEmailDeliveryConfig {
  apiKey: string;
  senderDid: string;
  from: string;
  fetchImpl?: typeof fetch;
}

type ComailDeliveryFailureReason =
  | "request_failed"
  | "invalid_response"
  | "recipient_not_accepted"
  | "http_error";

class ComailDeliveryError extends Error {
  readonly status: number | null;

  constructor(
    readonly reason: ComailDeliveryFailureReason,
    status: number | null = null,
  ) {
    const safeStatus = typeof status === "number" &&
        Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : null;
    super(comailDeliveryFailureMessage(reason, safeStatus));
    this.name = "ComailDeliveryError";
    this.status = safeStatus;
  }
}

export interface HostContactEmailAvailability {
  available: boolean;
  maskedEmail: string | null;
  deliveryConfigured: boolean;
}

interface HostContactEmailOptions {
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
    previewUrl?: string;
  }
  | {
    ok: false;
    reason:
      | "contact_unavailable"
      | "delivery_unavailable"
      | "rate_limited"
      | "delivery_failed";
  };

export type HostContactEmailVerificationResult =
  | { ok: true }
  | {
    ok: false;
    reason:
      | "invalid"
      | "expired"
      | "already_used"
      | "account_mismatch"
      | "contact_changed";
  };

type HostContactEmailVerificationFailure = Extract<
  HostContactEmailVerificationResult,
  { ok: false }
>;

export type HostContactEmailVerificationFailureReason =
  HostContactEmailVerificationFailure["reason"];

export interface HostContactEmailChallengeConsumeInput {
  tokenHash: string;
  host: string;
  claimantDid: string;
  consumedAt: number;
}

export type HostContactEmailChallengeConsumeResult =
  | { ok: true }
  | {
    ok: false;
    reason: "invalid" | "expired" | "already_used" | "account_mismatch";
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
      return "The PDS contact email changed after this link was sent. Request a new email using the current address.";
  }
}

export type PreparedHostContactEmailVerificationResult =
  | {
    ok: true;
    tokenHash: string;
    host: string;
    claimantDid: string;
  }
  | HostContactEmailVerificationFailure;

export async function getHostContactEmailAvailability(
  target: HostContactClaimTarget,
  options: HostContactEmailOptions = {},
): Promise<HostContactEmailAvailability> {
  // Claim setup must reflect the PDS's current declaration so operators can
  // add contact.email and retry immediately rather than waiting on discovery
  // cache expiry.
  const email = await readAnnouncedContactEmail(target, options.fetchImpl, 0);
  return {
    available: !!email,
    maskedEmail: email ? maskEmail(email) : null,
    deliveryConfigured: !!options.delivery || IS_DEV ||
      !!(COMAIL_API_KEY && COMAIL_SENDER_DID && HOST_CLAIM_EMAIL_FROM),
  };
}

export async function requestHostContactEmailChallenge(
  target: HostContactClaimTarget,
  user: HostContactClaimUser,
  publicOrigin: string,
  claimPath: string,
  options: HostContactEmailOptions = {},
): Promise<HostContactEmailRequestResult> {
  const email = await readAnnouncedContactEmail(target, options.fetchImpl, 0);
  if (!email) return { ok: false, reason: "contact_unavailable" };

  const delivery = options.delivery ?? configuredDelivery();
  const previewOnly = !delivery && IS_DEV;
  if (!delivery && !previewOnly) {
    return { ok: false, reason: "delivery_unavailable" };
  }

  const ts = options.now ?? Date.now();
  const store = options.store ?? dbHostContactEmailChallengeStore;
  const emailFingerprint = await fingerprintEmail(
    email,
    options.fingerprintSecret,
  );
  const token = randomB64u(TOKEN_BYTES);
  const tokenHash = await sha256B64u(token);
  const expiresAt = ts + CHALLENGE_TTL_MS;
  const record: HostContactEmailChallengeRecord = {
    tokenHash,
    host: target.host,
    claimantDid: user.did,
    claimantHandle: user.handle,
    emailFingerprint,
    createdAt: ts,
    expiresAt,
    consumedAt: null,
  };
  const verificationUrl = buildVerificationUrl(publicOrigin, claimPath, token);
  const reserved = await store.reserve(record, {
    since: ts - CHALLENGE_WINDOW_MS,
    host: 5,
    claimant: 10,
    email: 5,
  });
  if (!reserved) return { ok: false, reason: "rate_limited" };

  if (previewOnly) {
    console.info(
      `[host-claim] local email preview for ${target.host}: ${verificationUrl}`,
    );
    return {
      ok: true,
      maskedEmail: maskEmail(email),
      expiresAt,
      previewUrl: verificationUrl,
    };
  }

  try {
    await delivery!.send({
      to: email,
      host: target.host,
      displayName: target.displayName,
      claimantHandle: user.handle,
      verificationUrl,
    });
  } catch (error) {
    await store.remove(tokenHash).catch(() => undefined);
    console.error(
      "[host-claim] email delivery failed reason=%s",
      error instanceof ComailDeliveryError ? error.reason : "delivery_error",
    );
    return { ok: false, reason: "delivery_failed" };
  }

  return { ok: true, maskedEmail: maskEmail(email), expiresAt };
}

export async function inspectHostContactEmailChallenge(
  target: HostContactClaimTarget,
  user: HostContactClaimUser,
  token: string,
  options: HostContactEmailOptions = {},
): Promise<HostContactEmailVerificationResult> {
  const record = await readChallenge(target, user, token, options);
  if (!record.ok) return record;
  return { ok: true };
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
    consumedAt: options.now ?? Date.now(),
  });
}

/**
 * Validate a challenge and re-check the PDS's live contact address without
 * consuming the one-time token. Claim completion uses this before opening its
 * database transaction, then conditionally consumes the token inside the same
 * transaction as both ownership writes.
 */
export async function prepareHostContactEmailChallenge(
  target: HostContactClaimTarget,
  user: HostContactClaimUser,
  token: string,
  options: HostContactEmailOptions = {},
): Promise<PreparedHostContactEmailVerificationResult> {
  const checked = await readChallenge(target, user, token, options);
  if (!checked.ok) return checked;

  // Re-read describeServer without its normal cache before granting control.
  const currentEmail = await readAnnouncedContactEmail(
    target,
    options.fetchImpl,
    0,
  );
  if (!currentEmail) return { ok: false, reason: "contact_changed" };
  const currentFingerprint = await fingerprintEmail(
    currentEmail,
    options.fingerprintSecret,
  );
  if (currentFingerprint !== checked.record.emailFingerprint) {
    return { ok: false, reason: "contact_changed" };
  }
  return {
    ok: true,
    tokenHash: checked.record.tokenHash,
    host: checked.record.host,
    claimantDid: checked.record.claimantDid,
  };
}

export async function consumeHostContactEmailChallenge(
  c: DbClient,
  input: HostContactEmailChallengeConsumeInput,
): Promise<HostContactEmailChallengeConsumeResult> {
  const result = await c.execute({
    sql: `UPDATE account_host_claim_challenge SET consumed_at = ?
      WHERE token_hash = ?
        AND host = ?
        AND claimant_did = ?
        AND consumed_at IS NULL
        AND expires_at >= ?`,
    args: [
      input.consumedAt,
      input.tokenHash,
      input.host,
      input.claimantDid,
      input.consumedAt,
    ],
  });
  if (rowsAffected(result) === 1) return { ok: true };

  // Stay inside the ownership transaction when explaining why the guarded
  // consume failed. This preserves useful expiry/replay feedback without
  // weakening the host + account binding on the actual mutation.
  const current = await c.execute({
    sql: `SELECT host, claimant_did, expires_at, consumed_at
      FROM account_host_claim_challenge
      WHERE token_hash = ? LIMIT 1`,
    args: [input.tokenHash],
  });
  const row = current.rows[0] as Record<string, unknown> | undefined;
  if (!row || String(row.host ?? "") !== input.host) {
    return { ok: false, reason: "invalid" };
  }
  if (String(row.claimant_did ?? "") !== input.claimantDid) {
    return { ok: false, reason: "account_mismatch" };
  }
  if (row.consumed_at !== null && row.consumed_at !== undefined) {
    return { ok: false, reason: "already_used" };
  }
  if (Number(row.expires_at ?? 0) < input.consumedAt) {
    return { ok: false, reason: "expired" };
  }
  // A row that changed between the guarded UPDATE and this read is still not
  // safe to consume. Treat the indeterminate state as an invalid challenge.
  return { ok: false, reason: "invalid" };
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
  const store = options.store ?? dbHostContactEmailChallengeStore;
  const record = await store.read(await sha256B64u(token));
  if (!record || record.host !== target.host) {
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
  return { ok: true, record };
}

async function readAnnouncedContactEmail(
  target: HostContactClaimTarget,
  fetchImpl?: typeof fetch,
  cacheTtlMs?: number,
): Promise<string | null> {
  const endpoint = target.serviceEndpoint?.trim() || `https://${target.host}`;
  try {
    // A contact address on one tenant must not authorize an umbrella provider
    // or another hostname. Cross-domain products need a curated mapping (and,
    // eventually, a standardized operator declaration).
    if (!accountHostContactEndpointIsBound(target.host, endpoint)) {
      return null;
    }
  } catch {
    return null;
  }
  const description = await fetchPdsServerDescription(endpoint, {
    fetchImpl,
    cacheTtlMs,
  });
  return normalizeEmail(description?.contactEmail);
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
  secret = sessionSecret(),
): Promise<string> {
  return await sha256B64u(
    `${secret}\nhost-contact-email\n${email.toLowerCase()}`,
  );
}

function buildVerificationUrl(
  publicOrigin: string,
  claimPath: string,
  token: string,
): string {
  const url = new URL(claimPath, publicOrigin);
  url.searchParams.set("token", token);
  return url.toString();
}

function configuredDelivery(): HostContactEmailDelivery | null {
  if (!COMAIL_API_KEY || !COMAIL_SENDER_DID || !HOST_CLAIM_EMAIL_FROM) {
    return null;
  }
  return createComailHostContactEmailDelivery({
    apiKey: COMAIL_API_KEY,
    senderDid: COMAIL_SENDER_DID,
    from: HOST_CLAIM_EMAIL_FROM,
  });
}

export function createComailHostContactEmailDelivery(
  config: ComailHostContactEmailDeliveryConfig,
): HostContactEmailDelivery {
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    async send(input) {
      let response: Response;
      try {
        response = await fetchImpl(COMAIL_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            "x-atmos-did": config.senderDid,
          },
          body: JSON.stringify({
            from: config.from,
            to: input.to,
            subject: `Verify management of ${input.host}`,
            text: emailText(input),
            html: emailHtml(input),
            category: "verification",
          }),
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });
      } catch {
        throw new ComailDeliveryError("request_failed");
      }
      const body = await readResponseTextWithLimit(
        response,
        DELIVERY_RESPONSE_MAX_BYTES,
      );
      if (response.ok) {
        if (!body.ok) {
          throw new ComailDeliveryError("invalid_response", response.status);
        }
        const result = parseComailDeliveryResult(body.text);
        if (
          result &&
          (result.rejected === null || result.rejected.length === 0) &&
          result.accepted.some((recipient) =>
            recipient.toLowerCase() === input.to.toLowerCase()
          )
        ) return;
        throw new ComailDeliveryError(
          "recipient_not_accepted",
          response.status,
        );
      }
      throw new ComailDeliveryError("http_error", response.status);
    },
  };
}

function comailDeliveryFailureMessage(
  reason: ComailDeliveryFailureReason,
  status: number | null,
): string {
  if (reason === "request_failed") return "Comail request failed";
  if (reason === "invalid_response") {
    return "Comail returned an invalid success response";
  }
  if (reason === "recipient_not_accepted") {
    return "Comail returned success without accepting the intended recipient";
  }
  return status === null
    ? "Comail returned an error response"
    : `Comail returned HTTP ${status}`;
}

function parseComailDeliveryResult(
  body: string,
): { accepted: string[]; rejected: unknown[] | null } | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.accepted)) {
    return null;
  }
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
    const recipient = (entry as Record<string, unknown>).recipient;
    return typeof recipient === "string" ? recipient : null;
  });
  if (accepted.some((recipient) => recipient === null)) return null;
  return { accepted: accepted as string[], rejected };
}

function emailText(input: {
  host: string;
  claimantHandle: string;
  verificationUrl: string;
}): string {
  return `Verify management of ${input.host}\n\n@${input.claimantHandle} asked to manage this account host on Atmosphere Account.\n\nVerify this request (expires in 20 minutes):\n${input.verificationUrl}\n\nIf you did not request this, ignore this email.`;
}

function emailHtml(input: {
  host: string;
  claimantHandle: string;
  verificationUrl: string;
}): string {
  const host = escapeHtml(input.host);
  const handle = escapeHtml(input.claimantHandle);
  const url = escapeHtml(input.verificationUrl);
  return `<p><strong>Verify management of ${host}</strong></p><p>@${handle} asked to manage this account host on Atmosphere Account.</p><p><a href="${url}">Verify this request</a>. This link expires in 20 minutes.</p><p>If you did not request this, ignore this email.</p>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function rowToRecord(
  row: Record<string, unknown>,
): HostContactEmailChallengeRecord {
  return {
    tokenHash: String(row.token_hash ?? ""),
    host: String(row.host ?? ""),
    claimantDid: String(row.claimant_did ?? ""),
    claimantHandle: String(row.claimant_handle ?? ""),
    emailFingerprint: String(row.email_fingerprint ?? ""),
    createdAt: Number(row.created_at ?? 0),
    expiresAt: Number(row.expires_at ?? 0),
    consumedAt: row.consumed_at === null || row.consumed_at === undefined
      ? null
      : Number(row.consumed_at),
  };
}

function rowsAffected(result: { rowsAffected?: number | bigint }): number {
  return Number(result.rowsAffected ?? 0);
}

export const dbHostContactEmailChallengeStore: HostContactEmailChallengeStore =
  {
    async reserve(record, limits) {
      return await withDbTransaction((c) =>
        reserveHostContactEmailChallenge(c, record, limits, {
          postgresBackend: dbBackend() === "postgres",
        })
      );
    },
    async remove(tokenHash) {
      await withDb(async (c) => {
        await c.execute({
          sql: "DELETE FROM account_host_claim_challenge WHERE token_hash = ?",
          args: [tokenHash],
        });
      });
    },
    async read(tokenHash) {
      return await withDb(async (c) => {
        const result = await c.execute({
          sql: `SELECT * FROM account_host_claim_challenge
          WHERE token_hash = ? LIMIT 1`,
          args: [tokenHash],
        });
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row ? rowToRecord(row) : null;
      });
    },
    async consume(input) {
      return await withDb(async (c) => {
        return await consumeHostContactEmailChallenge(c, input);
      });
    },
  };

/**
 * Atomically reserve one rate-limit slot and persist its challenge. SQLite's
 * write transaction serializes the count + insert section. PostgreSQL also
 * takes a transaction-scoped advisory lock so concurrent request snapshots
 * cannot each observe the same remaining slot.
 */
export async function reserveHostContactEmailChallenge(
  c: DbClient,
  record: HostContactEmailChallengeRecord,
  limits: HostContactEmailChallengeReservationLimits,
  options: { postgresBackend?: boolean } = {},
): Promise<boolean> {
  if (options.postgresBackend) {
    await c.execute(
      "SELECT pg_advisory_xact_lock(CAST(1096043843 AS bigint))",
    );
  }
  const counts = await recentCounts(c, {
    host: record.host,
    claimantDid: record.claimantDid,
    emailFingerprint: record.emailFingerprint,
    since: limits.since,
  });
  if (
    counts.host >= limits.host || counts.claimant >= limits.claimant ||
    counts.email >= limits.email
  ) return false;

  await c.execute({
    sql: `INSERT INTO account_host_claim_challenge (
      token_hash, host, claimant_did, claimant_handle, email_fingerprint,
      created_at, expires_at, consumed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    args: [
      record.tokenHash,
      record.host,
      record.claimantDid,
      record.claimantHandle,
      record.emailFingerprint,
      record.createdAt,
      record.expiresAt,
    ],
  });
  return true;
}

async function recentCounts(
  c: DbClient,
  input: {
    host: string;
    claimantDid: string;
    emailFingerprint: string;
    since: number;
  },
): Promise<{ host: number; claimant: number; email: number }> {
  await c.execute({
    sql: "DELETE FROM account_host_claim_challenge WHERE expires_at < ?",
    args: [input.since],
  });
  const result = await c.execute({
    sql: `SELECT
      SUM(CASE WHEN host = ? THEN 1 ELSE 0 END) AS host_count,
      SUM(CASE WHEN claimant_did = ? THEN 1 ELSE 0 END) AS claimant_count,
      SUM(CASE WHEN email_fingerprint = ? THEN 1 ELSE 0 END) AS email_count
    FROM account_host_claim_challenge
    WHERE created_at >= ?`,
    args: [input.host, input.claimantDid, input.emailFingerprint, input.since],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return {
    host: Number(row?.host_count ?? 0),
    claimant: Number(row?.claimant_count ?? 0),
    email: Number(row?.email_count ?? 0),
  };
}
