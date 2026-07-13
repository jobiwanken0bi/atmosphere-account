import { accountHostKeyForEndpoint, getAccountHost } from "./account-hosts.ts";
import { type DbClient, withDb } from "./db.ts";

export const PDS_RELAY_BASE_URL = "https://bsky.network";
const LIST_HOSTS_PATH = "/xrpc/com.atproto.sync.listHosts";
const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_SIZE = 1000;
const FETCH_TIMEOUT_MS = 30_000;
const UPSERT_CHUNK_SIZE = 50;
const MIN_COMPLETE_SCAN_RETAINED_FRACTION = 0.95;

export type RelayHostStatus =
  | "active"
  | "idle"
  | "offline"
  | "throttled"
  | "banned"
  | "unknown";

export interface RelayPdsInstance {
  serviceHost: string;
  serviceEndpoint: string;
  accountHost: string;
  relayStatus: RelayHostStatus;
  relayAccountCount: number | null;
  relaySeq: number | null;
  isBlueskyHost: boolean;
}

export interface RelayPdsInventoryFetchResult {
  instances: RelayPdsInstance[];
  pages: number;
  complete: boolean;
  nextCursor: string | null;
}

export interface RelayPdsInventorySummary {
  totalInstances: number;
  activeInstances: number;
  blueskyInstances: number;
  independentInstances: number;
  totalAccounts: number;
  blueskyAccounts: number;
  independentAccounts: number;
  unknownAccountCountInstances: number;
}

export interface RelayPdsInventoryPersistResult {
  storedInstances: number;
  staleInstances: number;
  complete: boolean;
  scanId: string;
}

export interface RelayPdsInventoryPersistOptions {
  complete?: boolean;
  observedAt?: number;
  scanId?: string;
  allowLargeDrop?: boolean;
}

interface RelayListHostsPage {
  cursor?: unknown;
  hosts?: unknown;
}

interface RelayListHost {
  hostname?: unknown;
  seq?: unknown;
  accountCount?: unknown;
  status?: unknown;
}

function integerOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return value >= 0 ? value : null;
}

function relayStatus(value: unknown): RelayHostStatus {
  return value === "active" || value === "idle" || value === "offline" ||
      value === "throttled" || value === "banned"
    ? value
    : "unknown";
}

export function normalizeRelayServiceHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || host.includes(":")) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  const valid = labels.every((label) =>
    label.length >= 1 && label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
  return valid ? host : null;
}

export function isBlueskyHostedPds(serviceHost: string): boolean {
  const host = serviceHost.toLowerCase();
  return host === "bsky.network" || host === "bsky.social" ||
    host.endsWith(".bsky.network");
}

export function parseRelayListHostsPage(
  value: unknown,
): { instances: RelayPdsInstance[]; cursor: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Relay listHosts returned a non-object response");
  }
  const page = value as RelayListHostsPage;
  if (!Array.isArray(page.hosts)) {
    throw new Error("Relay listHosts response is missing hosts[]");
  }
  if (
    page.cursor !== undefined &&
    (typeof page.cursor !== "string" || !page.cursor.trim())
  ) {
    throw new Error("Relay listHosts response has an invalid cursor");
  }
  const instances = new Map<string, RelayPdsInstance>();
  for (const [index, raw] of page.hosts.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(
        `Relay listHosts host at index ${index} is not an object`,
      );
    }
    const host = raw as RelayListHost;
    const serviceHost = normalizeRelayServiceHost(host.hostname);
    if (!serviceHost) {
      throw new Error(
        `Relay listHosts host at index ${index} has an invalid hostname`,
      );
    }
    const accountCount = integerOrNull(host.accountCount);
    if (host.accountCount !== undefined && accountCount == null) {
      throw new Error(
        `Relay listHosts host ${serviceHost} has an invalid accountCount`,
      );
    }
    const serviceEndpoint = `https://${serviceHost}`;
    instances.set(serviceHost, {
      serviceHost,
      serviceEndpoint,
      accountHost: accountHostKeyForEndpoint(serviceEndpoint),
      relayStatus: relayStatus(host.status),
      relayAccountCount: accountCount,
      relaySeq: integerOrNull(host.seq),
      isBlueskyHost: isBlueskyHostedPds(serviceHost),
    });
  }
  return {
    instances: [...instances.values()],
    cursor: typeof page.cursor === "string" ? page.cursor : null,
  };
}

export async function fetchRelayPdsInventory(
  options: {
    fetchImpl?: typeof fetch;
    pageSize?: number;
    maxPages?: number;
    timeoutMs?: number;
  } = {},
): Promise<RelayPdsInventoryFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (
    options.pageSize != null &&
    (!Number.isFinite(options.pageSize) || options.pageSize <= 0)
  ) {
    throw new Error("pageSize must be a positive finite number");
  }
  if (
    options.maxPages != null &&
    (!Number.isFinite(options.maxPages) || options.maxPages <= 0)
  ) {
    throw new Error("maxPages must be a positive finite number");
  }
  if (
    options.timeoutMs != null &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
  ) {
    throw new Error("timeoutMs must be a positive finite number");
  }
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  const maxPages = options.maxPages == null
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.floor(options.maxPages));
  const timeoutMs = Math.max(500, options.timeoutMs ?? FETCH_TIMEOUT_MS);
  const instances = new Map<string, RelayPdsInstance>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  let complete = false;

  while (pages < maxPages) {
    const url = new URL(LIST_HOSTS_PATH, PDS_RELAY_BASE_URL);
    url.searchParams.set("limit", String(pageSize));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Relay listHosts returned HTTP ${response.status}`);
    }
    const parsed = parseRelayListHostsPage(await response.json());
    pages++;
    for (const instance of parsed.instances) {
      instances.set(instance.serviceHost, instance);
    }

    if (!parsed.cursor) {
      cursor = parsed.cursor;
      complete = true;
      break;
    }
    if (parsed.cursor === cursor || seenCursors.has(parsed.cursor)) {
      throw new Error(`Relay listHosts repeated cursor ${parsed.cursor}`);
    }
    seenCursors.add(parsed.cursor);
    cursor = parsed.cursor;
  }

  return {
    instances: [...instances.values()].sort((a, b) =>
      a.serviceHost.localeCompare(b.serviceHost)
    ),
    pages,
    complete,
    nextCursor: complete ? null : cursor,
  };
}

export function summarizeRelayPdsInventory(
  instances: RelayPdsInstance[],
): RelayPdsInventorySummary {
  let activeInstances = 0;
  let blueskyInstances = 0;
  let totalAccounts = 0;
  let blueskyAccounts = 0;
  let unknownAccountCountInstances = 0;
  for (const instance of instances) {
    if (instance.relayStatus === "active") activeInstances++;
    if (instance.relayAccountCount == null) {
      unknownAccountCountInstances++;
    }
    const accountCount = instance.relayAccountCount ?? 0;
    totalAccounts += accountCount;
    if (instance.isBlueskyHost) {
      blueskyInstances++;
      blueskyAccounts += accountCount;
    }
  }
  return {
    totalInstances: instances.length,
    activeInstances,
    blueskyInstances,
    independentInstances: instances.length - blueskyInstances,
    totalAccounts,
    blueskyAccounts,
    independentAccounts: totalAccounts - blueskyAccounts,
    unknownAccountCountInstances,
  };
}

export async function persistRelayPdsInventory(
  instances: RelayPdsInstance[],
  options: RelayPdsInventoryPersistOptions = {},
): Promise<RelayPdsInventoryPersistResult> {
  // Seeded account-host rows are the aggregation targets. This call is cheap
  // and ensures they exist before the raw relay inventory is summarized.
  await getAccountHost("bsky.network");
  return await withDb((c) =>
    persistRelayPdsInventoryForClient(c, instances, options)
  );
}

export async function persistRelayPdsInventoryForClient(
  c: DbClient,
  instances: RelayPdsInstance[],
  options: RelayPdsInventoryPersistOptions = {},
): Promise<RelayPdsInventoryPersistResult> {
  const requestedObservedAt = options.observedAt ?? Date.now();
  if (!Number.isFinite(requestedObservedAt) || requestedObservedAt < 0) {
    throw new Error("observedAt must be a non-negative finite number");
  }
  const observedAt = Math.floor(requestedObservedAt);
  const scanId = options.scanId?.trim() ||
    `${observedAt}-${crypto.randomUUID()}`;
  const complete = options.complete ?? true;

  const uniqueServiceHosts = new Set(
    instances.map((instance) => instance.serviceHost),
  );
  if (uniqueServiceHosts.size !== instances.length) {
    throw new Error("Relay PDS inventory contains duplicate service hosts");
  }
  if (complete) {
    if (instances.length === 0) {
      throw new Error("Refusing to reconcile an empty complete PDS inventory");
    }
    const previousResult = await c.execute({
      sql: `SELECT COUNT(*) AS count
        FROM pds_instance
        WHERE relay_url = ? AND relay_status <> 'not_seen'`,
      args: [PDS_RELAY_BASE_URL],
    });
    const previousActiveInstances = Number(
      previousResult.rows[0]?.count ?? 0,
    );
    if (
      !Number.isSafeInteger(previousActiveInstances) ||
      previousActiveInstances < 0
    ) {
      throw new Error("PDS inventory baseline count is invalid");
    }
    const minimumSafeInstances = Math.ceil(
      previousActiveInstances * MIN_COMPLETE_SCAN_RETAINED_FRACTION,
    );
    if (
      !options.allowLargeDrop && previousActiveInstances > 0 &&
      instances.length < minimumSafeInstances
    ) {
      throw new Error(
        `Refusing to reconcile ${instances.length} PDS instances over ` +
          `${previousActiveInstances}; pass allowLargeDrop only after verifying ` +
          "the relay inventory shrinkage",
      );
    }
  }

  for (let offset = 0; offset < instances.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = instances.slice(offset, offset + UPSERT_CHUNK_SIZE);
    const groups = [
      {
        rows: chunk.filter((row) => row.relayAccountCount != null),
        updateCount: true,
      },
      {
        rows: chunk.filter((row) => row.relayAccountCount == null),
        updateCount: false,
      },
    ];
    for (const group of groups) {
      if (group.rows.length === 0) continue;
      const values = group.rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .join(", ");
      const args: Array<string | number | null> = [];
      for (const instance of group.rows) {
        args.push(
          instance.serviceHost,
          instance.serviceEndpoint,
          instance.accountHost,
          PDS_RELAY_BASE_URL,
          instance.relayStatus,
          instance.relayAccountCount ?? 0,
          instance.relaySeq,
          instance.isBlueskyHost ? 1 : 0,
          observedAt,
          observedAt,
          scanId,
        );
      }
      await c.execute({
        sql: `INSERT INTO pds_instance (
            service_host, service_endpoint, account_host, relay_url,
            relay_status, relay_account_count, relay_seq, is_bluesky_host,
            first_observed_at, last_observed_at, last_scan_id
          ) VALUES ${values}
          ON CONFLICT(service_host) DO UPDATE SET
            service_endpoint = excluded.service_endpoint,
            account_host = excluded.account_host,
            relay_url = excluded.relay_url,
            relay_status = excluded.relay_status,
            ${
          group.updateCount
            ? "relay_account_count = excluded.relay_account_count,"
            : ""
        }
            relay_seq = excluded.relay_seq,
            is_bluesky_host = excluded.is_bluesky_host,
            last_observed_at = excluded.last_observed_at,
            last_scan_id = excluded.last_scan_id`,
        args,
      });
    }
  }

  let staleInstances = 0;
  if (complete) {
    const stale = await c.execute({
      sql: `UPDATE pds_instance
        SET relay_status = 'not_seen'
        WHERE relay_url = ? AND last_scan_id <> ? AND relay_status <> 'not_seen'`,
      args: [PDS_RELAY_BASE_URL, scanId],
    });
    staleInstances = Number(stale.rowsAffected ?? 0);
    await c.execute({
      sql: `UPDATE account_host
        SET observed_account_count = COALESCE((
              SELECT SUM(p.relay_account_count)
              FROM pds_instance p
              WHERE p.account_host = account_host.host
                AND p.relay_status <> 'not_seen'
            ), 0),
            observed_active_account_count = 0,
            last_indexed_account_at = ?,
            last_observed_at = COALESCE((
              SELECT MAX(p.last_observed_at)
              FROM pds_instance p
              WHERE p.account_host = account_host.host
                AND p.relay_status <> 'not_seen'
            ), account_host.last_observed_at),
            updated_at = ?
        WHERE account_host.observed_account_count <> 0
          OR account_host.observed_active_account_count <> 0
          OR EXISTS (
            SELECT 1 FROM pds_instance p WHERE p.account_host = account_host.host
          )`,
      args: [observedAt, observedAt],
    });
  }

  return {
    storedInstances: instances.length,
    staleInstances,
    complete,
    scanId,
  };
}
