/** Independently discovered host OAuth signup support, separate from owner metadata. */
import {
  type AccountHost,
  hasFreshDetectedPublicIntent,
  isAccountHostPubliclyListable,
} from "./account-hosts.ts";
import { listPublicAccountHosts } from "./appview-client.ts";
import {
  accountHostContactEndpoint,
  compiledAccountHostServiceEndpoint,
} from "./account-host-endpoints.ts";
import { type DbClient, withDb } from "./db.ts";
import { discoverAccountCreationAuthServer } from "./identity.ts";
import { fetchPinnedPublicHttps } from "./pinned-public-https.ts";
import { fetchPdsServerDescription } from "./pds-server-description.ts";

const RECHECK_MS = 24 * 60 * 60 * 1000;
const EVIDENCE_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_CANDIDATES = 1000;

export interface HostOAuthCreationEvidence {
  host: string;
  serviceEndpoint: string;
  supported: boolean;
  signupStatus: "open" | "invite_required" | null;
  issuer: string | null;
  checkedAt: number;
  expiresAt: number;
}

/** Never let mutable directory metadata associate one provider with another. */
export function accountCreationServiceEndpoint(
  host: AccountHost,
): string | null {
  const expected = compiledAccountHostServiceEndpoint(host.host) ??
    accountHostContactEndpoint(host.host);
  if (!expected) return null;
  if (!host.serviceEndpoint) return expected;
  try {
    const actual = new URL(host.serviceEndpoint);
    return actual.origin === expected && actual.pathname === "/" &&
        !actual.search && !actual.hash && !actual.username && !actual.password
      ? expected
      : null;
  } catch {
    return null;
  }
}

export function isAccountCreationDiscoveryCandidate(
  host: AccountHost,
  at = Date.now(),
): boolean {
  const trusted = host.source === "seeded" ||
    host.verificationStatus === "claimed" ||
    host.verificationStatus === "verified" ||
    hasFreshDetectedPublicIntent(host, at);
  return trusted && host.signupStatus !== "closed" &&
    isAccountHostPubliclyListable(host, at) &&
    accountCreationServiceEndpoint(host) !== null;
}

export function currentHostOAuthCreationEvidence(
  host: AccountHost,
  evidence: HostOAuthCreationEvidence | undefined,
  at = Date.now(),
): HostOAuthCreationEvidence | null {
  return evidence?.supported && evidence.checkedAt <= at &&
      evidence.expiresAt > at &&
      evidence.serviceEndpoint === accountCreationServiceEndpoint(host) &&
      isAccountCreationDiscoveryCandidate(host, at)
    ? evidence
    : null;
}

export async function loadHostOAuthCreationEvidence(
  hosts: readonly AccountHost[],
  client?: DbClient,
): Promise<Map<string, HostOAuthCreationEvidence>> {
  if (!hosts.length) return new Map();
  const load = async (c: DbClient) => {
    const result = await c.execute({
      sql: `SELECT * FROM host_oauth_creation WHERE host IN (${
        hosts.map(() => "?").join(",")
      })`,
      args: hosts.map((host) => host.host),
    });
    return new Map(result.rows.map((row) => [
      String(row.host),
      {
        host: String(row.host),
        serviceEndpoint: String(row.service_endpoint),
        supported: Number(row.supported) === 1,
        signupStatus: row.signup_status === "open" ||
            row.signup_status === "invite_required"
          ? row.signup_status
          : null,
        issuer: row.issuer == null ? null : String(row.issuer),
        checkedAt: Number(row.checked_at),
        expiresAt: Number(row.expires_at),
      } satisfies HostOAuthCreationEvidence,
    ]));
  };
  return client ? await load(client) : await withDb(load);
}

/** Paginate before filtering: unsupported providers must not hide later ones. */
export async function listAccountCreationCandidates(
  load = listPublicAccountHosts,
): Promise<AccountHost[]> {
  const hosts: AccountHost[] = [];
  for (let page = 1; page <= Math.ceil(MAX_CANDIDATES / 72); page++) {
    const result = await load({
      page,
      pageSize: 72,
      sort: "recommended",
    });
    hosts.push(...result.hosts);
    if (page * Math.max(1, result.pageSize) >= result.total) break;
  }
  return hosts.slice(0, MAX_CANDIDATES).filter((host) =>
    isAccountCreationDiscoveryCandidate(host)
  );
}

export async function refreshHostOAuthCreationEvidence(options: {
  signal?: AbortSignal;
  force?: boolean;
  hosts?: AccountHost[];
  fetchImpl?: typeof fetch;
  client?: DbClient;
  now?: number;
} = {}): Promise<{ candidates: number; checked: number; supported: number }> {
  options.signal?.throwIfAborted();
  const checkedAt = options.now ?? Date.now();
  const hosts = (options.hosts ?? await listAccountCreationCandidates())
    .filter((host) => isAccountCreationDiscoveryCandidate(host, checkedAt))
    .slice(0, MAX_CANDIDATES);
  const previous = await loadHostOAuthCreationEvidence(hosts, options.client);
  const candidates = hosts.filter((host) => {
    const old = previous.get(host.host);
    return options.force || !old ||
      old.serviceEndpoint !== accountCreationServiceEndpoint(host) ||
      old.expiresAt <= checkedAt || old.checkedAt < checkedAt - RECHECK_MS;
  });
  const summary = { candidates: candidates.length, checked: 0, supported: 0 };
  // DNS/IP pinning, response size and deadlines also apply to metadata hosted
  // at an independently discovered entryway. No network requests in public GETs.
  const fetchImpl: typeof fetch = options.fetchImpl ??
    ((input, init) =>
      fetchPinnedPublicHttps(
        String(input),
        init,
        { maxBodyBytes: 256 * 1024, timeoutMs: 6000 },
      ));
  for (let offset = 0; offset < candidates.length; offset += 12) {
    options.signal?.throwIfAborted();
    const batch = await Promise.all(
      candidates.slice(offset, offset + 12).map(async (host) => {
        const serviceEndpoint = accountCreationServiceEndpoint(host)!;
        let supported = false;
        let issuer: string | null = null;
        let signupStatus: HostOAuthCreationEvidence["signupStatus"] = null;
        try {
          const metadata = await discoverAccountCreationAuthServer(
            serviceEndpoint,
            {
              fetchImpl,
              signal: options.signal,
            },
          );
          issuer = metadata.issuer;
          supported =
            metadata.prompt_values_supported?.includes("create") === true;
          if (supported && host.signupStatus === "unknown") {
            const description = await fetchPdsServerDescription(
              serviceEndpoint,
              {
                fetchImpl,
                signal: options.signal,
                cacheTtlMs: 0,
              },
            );
            if (
              description?.availableUserDomains.length &&
              description.inviteCodeRequired !== null
            ) {
              signupStatus = description.inviteCodeRequired
                ? "invite_required"
                : "open";
            }
          }
        } catch {
          options.signal?.throwIfAborted();
        }
        return {
          host: host.host,
          originalEndpoint: host.serviceEndpoint ?? "",
          serviceEndpoint,
          supported,
          signupStatus,
          issuer,
          checkedAt,
          expiresAt: checkedAt + (supported ? EVIDENCE_TTL_MS : 15 * 60 * 1000),
        };
      }),
    );
    for (const evidence of batch) {
      options.signal?.throwIfAborted();
      const persist = async (client: DbClient) => {
        await client.execute({
          sql: `INSERT INTO host_oauth_creation
            (host, service_endpoint, supported, signup_status, issuer, checked_at, expires_at)
            SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
              SELECT 1 FROM account_host WHERE host = ? AND COALESCE(service_endpoint, '') = ?
            )
            ON CONFLICT(host) DO UPDATE SET service_endpoint = excluded.service_endpoint,
              supported = excluded.supported, signup_status = excluded.signup_status,
              issuer = excluded.issuer, checked_at = excluded.checked_at, expires_at = excluded.expires_at
            WHERE host_oauth_creation.checked_at <= excluded.checked_at`,
          args: [
            evidence.host,
            evidence.serviceEndpoint,
            evidence.supported ? 1 : 0,
            evidence.signupStatus,
            evidence.issuer,
            evidence.checkedAt,
            evidence.expiresAt,
            evidence.host,
            evidence.originalEndpoint,
          ],
        });
      };
      if (options.client) await persist(options.client);
      else await withDb(persist);
      summary.checked++;
      if (evidence.supported) summary.supported++;
    }
  }
  return summary;
}
