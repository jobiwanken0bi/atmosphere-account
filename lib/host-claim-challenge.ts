import { dbBackend, type DbClient, withDb, withDbTransaction } from "./db.ts";

/** Generic one-time proof record. The deployed table retains its historical
 * `email_fingerprint` column name, but new code stores method-specific opaque
 * fingerprints there. */
export interface HostClaimChallengeRecord {
  tokenHash: string;
  host: string;
  claimantDid: string;
  claimantHandle: string;
  methodFingerprint: string;
  methodBinding: string | null;
  deliveryId: string | null;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface HostClaimChallengeStore {
  reserve(
    record: HostClaimChallengeRecord,
    limits: HostClaimChallengeReservationLimits,
  ): Promise<boolean>;
  remove(tokenHash: string): Promise<void>;
  recordDelivery(tokenHash: string, deliveryId: string): Promise<void>;
  read(tokenHash: string): Promise<HostClaimChallengeRecord | null>;
  consume(input: HostClaimChallengeConsumeInput): Promise<
    HostClaimChallengeConsumeResult
  >;
}

export interface HostClaimChallengeReservationLimits {
  since: number;
  host: number;
  claimant: number;
  method: number;
  /** Optional exact host + claimant + method cooldown, enforced under the
   * same reservation lock as the hourly counters. */
  cooldownSince?: number;
}

export interface HostClaimChallengeConsumeInput {
  tokenHash: string;
  host: string;
  claimantDid: string;
  consumedAt: number;
}

export type HostClaimChallengeConsumeResult =
  | { ok: true }
  | {
    ok: false;
    reason: "invalid" | "expired" | "already_used" | "account_mismatch";
  };

export const dbHostClaimChallengeStore: HostClaimChallengeStore = {
  async reserve(record, limits) {
    return await withDbTransaction((client) =>
      reserveHostClaimChallenge(client, record, limits, {
        postgresBackend: dbBackend() === "postgres",
      })
    );
  },
  async remove(tokenHash) {
    await withDb(async (client) => {
      await client.execute({
        sql: "DELETE FROM account_host_claim_challenge WHERE token_hash = ?",
        args: [tokenHash],
      });
    });
  },
  async recordDelivery(tokenHash, deliveryId) {
    await withDb(async (client) => {
      await client.execute({
        sql: `UPDATE account_host_claim_challenge SET delivery_id = ?
          WHERE token_hash = ? AND consumed_at IS NULL`,
        args: [deliveryId, tokenHash],
      });
    });
  },
  async read(tokenHash) {
    return await withDb(async (client) => {
      const result = await client.execute({
        sql: `SELECT * FROM account_host_claim_challenge
          WHERE token_hash = ? LIMIT 1`,
        args: [tokenHash],
      });
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? rowToRecord(row) : null;
    });
  },
  async consume(input) {
    return await withDb((client) => consumeHostClaimChallenge(client, input));
  },
};

/** Reserve a rate-limit slot and challenge atomically. */
export async function reserveHostClaimChallenge(
  client: DbClient,
  record: HostClaimChallengeRecord,
  limits: HostClaimChallengeReservationLimits,
  options: { postgresBackend?: boolean } = {},
): Promise<boolean> {
  if (options.postgresBackend) {
    await client.execute(
      "SELECT pg_advisory_xact_lock(CAST(1096043843 AS bigint))",
    );
  }
  const counts = await recentCounts(client, {
    host: record.host,
    claimantDid: record.claimantDid,
    methodFingerprint: record.methodFingerprint,
    since: limits.since,
    cooldownSince: limits.cooldownSince,
  });
  if (
    counts.host >= limits.host || counts.claimant >= limits.claimant ||
    counts.method >= limits.method || counts.cooldown > 0
  ) return false;

  await client.execute({
    sql: `INSERT INTO account_host_claim_challenge (
      token_hash, host, claimant_did, claimant_handle, email_fingerprint,
      method_binding, delivery_id, created_at, expires_at, consumed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    args: [
      record.tokenHash,
      record.host,
      record.claimantDid,
      record.claimantHandle,
      record.methodFingerprint,
      record.methodBinding,
      record.deliveryId,
      record.createdAt,
      record.expiresAt,
    ],
  });
  return true;
}

/** Consume proof on the caller's ownership transaction client. */
export async function consumeHostClaimChallenge(
  client: DbClient,
  input: HostClaimChallengeConsumeInput,
): Promise<HostClaimChallengeConsumeResult> {
  const result = await client.execute({
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
  if (Number(result.rowsAffected ?? 0) === 1) return { ok: true };

  const current = await client.execute({
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
  return { ok: false, reason: "invalid" };
}

async function recentCounts(
  client: DbClient,
  input: {
    host: string;
    claimantDid: string;
    methodFingerprint: string;
    since: number;
    cooldownSince?: number;
  },
): Promise<
  { host: number; claimant: number; method: number; cooldown: number }
> {
  await client.execute({
    sql: "DELETE FROM account_host_claim_challenge WHERE expires_at < ?",
    args: [input.since],
  });
  const result = await client.execute({
    sql: `SELECT
      SUM(CASE WHEN host = ? THEN 1 ELSE 0 END) AS host_count,
      SUM(CASE WHEN claimant_did = ? THEN 1 ELSE 0 END) AS claimant_count,
      SUM(CASE WHEN email_fingerprint = ? THEN 1 ELSE 0 END) AS method_count,
      SUM(CASE
        WHEN host = ? AND claimant_did = ? AND email_fingerprint = ?
          AND created_at >= ?
        THEN 1 ELSE 0 END) AS cooldown_count
    FROM account_host_claim_challenge
    WHERE created_at >= ?`,
    args: [
      input.host,
      input.claimantDid,
      input.methodFingerprint,
      input.host,
      input.claimantDid,
      input.methodFingerprint,
      input.cooldownSince ?? input.since,
      input.since,
    ],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return {
    host: Number(row?.host_count ?? 0),
    claimant: Number(row?.claimant_count ?? 0),
    method: Number(row?.method_count ?? 0),
    cooldown: input.cooldownSince == null
      ? 0
      : Number(row?.cooldown_count ?? 0),
  };
}

function rowToRecord(row: Record<string, unknown>): HostClaimChallengeRecord {
  return {
    tokenHash: String(row.token_hash ?? ""),
    host: String(row.host ?? ""),
    claimantDid: String(row.claimant_did ?? ""),
    claimantHandle: String(row.claimant_handle ?? ""),
    methodFingerprint: String(row.email_fingerprint ?? ""),
    methodBinding: row.method_binding == null
      ? null
      : String(row.method_binding),
    deliveryId: row.delivery_id == null ? null : String(row.delivery_id),
    createdAt: Number(row.created_at ?? 0),
    expiresAt: Number(row.expires_at ?? 0),
    consumedAt: row.consumed_at === null || row.consumed_at === undefined
      ? null
      : Number(row.consumed_at),
  };
}
