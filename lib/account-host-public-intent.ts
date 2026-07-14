import {
  type HostPublicIntentSource,
  normalizeAccountHostPublicServiceEndpoint,
} from "./account-hosts.ts";
import { type DbClient, withDb } from "./db.ts";
import {
  fetchPdsServerDescription,
  type PdsServerDescription,
} from "./pds-server-description.ts";

export const PUBLIC_HOST_ENRICHMENT_MIN_ACCOUNTS = 2;
export const PUBLIC_HOST_ENRICHMENT_RECHECK_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PUBLIC_HOST_ENRICHMENT_LIMIT = 200;
const DEFAULT_PUBLIC_HOST_ENRICHMENT_CONCURRENCY = 12;

interface PublicHostEnrichmentCandidate {
  host: string;
  serviceEndpoint: string;
  observedAccountCount: number;
}

export interface DetectedPdsPublicIntent {
  source: HostPublicIntentSource;
  signupStatus: "open" | "invite_required";
  evidenceJson: string;
}

export interface PublicHostEnrichmentSummary {
  candidates: number;
  checked: number;
  detected: number;
  notDetected: number;
  unavailable: number;
}

export interface PublicHostEnrichmentOptions {
  limit?: number;
  concurrency?: number;
  checkedAt?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * A reachable PDS is not automatically a public provider. Treat its standard
 * describeServer response as public intent only when it advertises account
 * domains and either open registration, or managed invite registration with
 * public operator/policy metadata. The relay count guard keeps one-user PDSes
 * out of this automated path; they can still publish a host record or claim a
 * profile explicitly.
 */
export function detectPdsPublicIntent(
  description: PdsServerDescription,
  observedAccountCount: number,
): DetectedPdsPublicIntent | null {
  if (
    observedAccountCount < PUBLIC_HOST_ENRICHMENT_MIN_ACCOUNTS ||
    description.availableUserDomains.length === 0
  ) {
    return null;
  }

  let source: HostPublicIntentSource;
  let signupStatus: DetectedPdsPublicIntent["signupStatus"];
  if (description.inviteCodeRequired === false) {
    source = "pds_open_signup";
    signupStatus = "open";
  } else if (
    description.inviteCodeRequired === true &&
    description.contactEmail != null &&
    (description.privacyPolicyUrl != null ||
      description.termsOfServiceUrl != null)
  ) {
    source = "pds_managed_invites";
    signupStatus = "invite_required";
  } else {
    return null;
  }

  return {
    source,
    signupStatus,
    evidenceJson: JSON.stringify({
      availableUserDomains: description.availableUserDomains.slice(0, 10),
      inviteCodeRequired: description.inviteCodeRequired,
      hasContact: description.contactEmail != null,
      hasPrivacyPolicy: description.privacyPolicyUrl != null,
      hasTermsOfService: description.termsOfServiceUrl != null,
    }),
  };
}

export async function enrichObservedAccountHostPublicIntent(
  options: PublicHostEnrichmentOptions = {},
): Promise<PublicHostEnrichmentSummary> {
  return await withDb((client) =>
    enrichObservedAccountHostPublicIntentForClient(client, options)
  );
}

export async function enrichObservedAccountHostPublicIntentForClient(
  client: DbClient,
  options: PublicHostEnrichmentOptions = {},
): Promise<PublicHostEnrichmentSummary> {
  const checkedAt = finiteNonNegativeInteger(options.checkedAt, Date.now());
  const limit = positiveInteger(
    options.limit,
    DEFAULT_PUBLIC_HOST_ENRICHMENT_LIMIT,
    1000,
  );
  const concurrency = positiveInteger(
    options.concurrency,
    DEFAULT_PUBLIC_HOST_ENRICHMENT_CONCURRENCY,
    50,
  );
  const candidates = await loadCandidates(
    client,
    checkedAt - PUBLIC_HOST_ENRICHMENT_RECHECK_MS,
    limit,
  );
  const summary: PublicHostEnrichmentSummary = {
    candidates: candidates.length,
    checked: 0,
    detected: 0,
    notDetected: 0,
    unavailable: 0,
  };

  for (let offset = 0; offset < candidates.length; offset += concurrency) {
    const batch = candidates.slice(offset, offset + concurrency);
    const results = await Promise.all(batch.map(async (candidate) => {
      const endpoint = normalizeAccountHostPublicServiceEndpoint(
        candidate.serviceEndpoint,
      );
      if (!endpoint) return { candidate, description: null };
      const description = await fetchPdsServerDescription(endpoint, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        cacheTtlMs: 0,
        checkedAt,
      });
      return { candidate, description };
    }));

    for (const { candidate, description } of results) {
      if (!description) {
        summary.unavailable++;
        await client.execute({
          sql: `UPDATE account_host
            SET public_intent_attempted_at = ?
            WHERE host = ?`,
          args: [checkedAt, candidate.host],
        });
        continue;
      }

      summary.checked++;
      const detected = detectPdsPublicIntent(
        description,
        candidate.observedAccountCount,
      );
      if (detected) summary.detected++;
      else summary.notDetected++;
      await persistDetection(client, candidate.host, detected, checkedAt);
    }
  }

  return summary;
}

async function loadCandidates(
  client: DbClient,
  attemptedBefore: number,
  limit: number,
): Promise<PublicHostEnrichmentCandidate[]> {
  // A manual row can originate from an unverified published host record. Probe
  // it just like relay-observed rows so only independent PDS metadata can turn
  // that self-assertion into public directory eligibility.
  const result = await client.execute({
    sql: `SELECT host, service_endpoint, observed_account_count
      FROM account_host
      WHERE source IN ('observed', 'manual')
        AND verification_status = 'observed'
        AND observed_active_account_count > 0
        AND observed_account_count >= ?
        AND lower(COALESCE(service_endpoint, '')) LIKE 'https://%'
        AND COALESCE(signup_url, '') = ''
        AND (
          public_intent_attempted_at IS NULL
          OR public_intent_attempted_at < ?
        )
      ORDER BY
        COALESCE(public_intent_attempted_at, 0) ASC,
        observed_account_count DESC,
        host ASC
      LIMIT ?`,
    args: [PUBLIC_HOST_ENRICHMENT_MIN_ACCOUNTS, attemptedBefore, limit],
  });
  return result.rows.map((row) => ({
    host: String(row.host),
    serviceEndpoint: String(row.service_endpoint),
    observedAccountCount: Number(row.observed_account_count),
  }));
}

async function persistDetection(
  client: DbClient,
  host: string,
  detected: DetectedPdsPublicIntent | null,
  checkedAt: number,
): Promise<void> {
  if (detected) {
    await client.execute({
      sql: `UPDATE account_host
        SET signup_status = CASE
              WHEN signup_status = 'unknown'
                OR public_intent_source IN ('pds_open_signup', 'pds_managed_invites')
              THEN ?
              ELSE signup_status
            END,
            public_intent_status = 'detected',
            public_intent_source = ?,
            public_intent_checked_at = ?,
            public_intent_attempted_at = ?,
            public_intent_evidence_json = ?,
            updated_at = ?
        WHERE host = ?`,
      args: [
        detected.signupStatus,
        detected.source,
        checkedAt,
        checkedAt,
        detected.evidenceJson,
        checkedAt,
        host,
      ],
    });
    return;
  }

  await client.execute({
    sql: `UPDATE account_host
      SET signup_status = CASE
            WHEN public_intent_source IN ('pds_open_signup', 'pds_managed_invites')
            THEN 'unknown'
            ELSE signup_status
          END,
          public_intent_status = 'not_detected',
          public_intent_source = NULL,
          public_intent_checked_at = ?,
          public_intent_attempted_at = ?,
          public_intent_evidence_json = NULL,
          updated_at = ?
      WHERE host = ?`,
    args: [checkedAt, checkedAt, checkedAt, host],
  });
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!Number.isFinite(value) || value == null) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value)));
}

function finiteNonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isFinite(value) && value != null && value >= 0
    ? Math.floor(value)
    : Math.floor(fallback);
}
