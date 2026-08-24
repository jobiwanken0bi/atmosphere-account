import { accountHostKeyForEndpoint, getAccountHost } from "./account-hosts.ts";
import { type DbClient, withDb } from "./db.ts";
import { readResponseTextWithLimit } from "./security.ts";

export const PDS_RELAY_BASE_URL = "https://bsky.network";
const LIST_HOSTS_PATH = "/xrpc/com.atproto.sync.listHosts";
const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_SIZE = 1000;
const MAX_SCAN_PAGES = 100;
const MAX_CURSOR_LENGTH = 2_048;
const MAX_RELAY_PAGE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
// Keep each write comfortably below SQLite/Postgres bind limits while cutting
// the number of round trips in half compared with the original 50-row batches.
const UPSERT_CHUNK_SIZE = 100;
const MAX_UPSERT_CHUNK_SIZE = 250;
const DEFAULT_DB_RETRIES = 3;
const MAX_DB_RETRIES = 5;
const DB_RETRY_BASE_DELAY_MS = 100;
const DB_RETRY_MAX_DELAY_MS = 2_000;
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
  publishedHosts: number;
  staleInstances: number;
  complete: boolean;
  scanId: string;
}

export interface RelayPdsInventoryPersistOptions {
  complete?: boolean;
  observedAt?: number;
  scanId?: string;
  allowLargeDrop?: boolean;
  signal?: AbortSignal;
  chunkSize?: number;
  dbRetries?: number;
  dbRetrySleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

type InventoryDbQuery = Parameters<DbClient["execute"]>[0];

interface InventoryQueryOptions {
  signal?: AbortSignal;
  retries: number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
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

interface RelayStatusTransition {
  serviceHost: string;
  accountHost: string;
  relayStatus: RelayHostStatus | "not_seen";
  relayAccountCount: number | null;
  relaySeq: number | null;
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
  if (page.hosts.length > MAX_PAGE_SIZE) {
    throw new Error("Relay listHosts response has too many hosts");
  }
  if (
    page.cursor !== undefined &&
    (typeof page.cursor !== "string" || !page.cursor.trim() ||
      page.cursor.length > MAX_CURSOR_LENGTH)
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
    signal?: AbortSignal;
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
    (!Number.isFinite(options.maxPages) || options.maxPages <= 0 ||
      options.maxPages > MAX_SCAN_PAGES)
  ) {
    throw new Error(
      `maxPages must be between 1 and ${MAX_SCAN_PAGES}`,
    );
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
  const maxPages = Math.max(
    1,
    Math.floor(options.maxPages ?? MAX_SCAN_PAGES),
  );
  const timeoutMs = Math.max(500, options.timeoutMs ?? FETCH_TIMEOUT_MS);
  const instances = new Map<string, RelayPdsInstance>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  let complete = false;

  while (pages < maxPages) {
    options.signal?.throwIfAborted();
    const url = new URL(LIST_HOSTS_PATH, PDS_RELAY_BASE_URL);
    url.searchParams.set("limit", String(pageSize));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Relay listHosts returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ??
      "";
    if (!contentType.includes("application/json")) {
      await response.body?.cancel().catch(() => {});
      throw new Error("Relay listHosts returned a non-JSON response");
    }
    const body = await readResponseTextWithLimit(
      response,
      MAX_RELAY_PAGE_BYTES,
    );
    if (!body.ok) throw new Error(`Relay listHosts ${body.error}`);
    let value: unknown;
    try {
      value = JSON.parse(body.text);
    } catch {
      throw new Error("Relay listHosts returned invalid JSON");
    }
    const parsed = parseRelayListHostsPage(value);
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
  options.signal?.throwIfAborted();
  const requestedObservedAt = options.observedAt ?? Date.now();
  if (!Number.isFinite(requestedObservedAt) || requestedObservedAt < 0) {
    throw new Error("observedAt must be a non-negative finite number");
  }
  const observedAt = Math.floor(requestedObservedAt);
  const scanId = options.scanId?.trim() ||
    `${observedAt}-${crypto.randomUUID()}`;
  const complete = options.complete ?? true;
  const chunkSize = positiveBoundedInteger(
    options.chunkSize,
    UPSERT_CHUNK_SIZE,
    MAX_UPSERT_CHUNK_SIZE,
    "chunkSize",
  );
  const dbRetries = nonNegativeBoundedInteger(
    options.dbRetries,
    DEFAULT_DB_RETRIES,
    MAX_DB_RETRIES,
    "dbRetries",
  );
  const queryOptions = {
    signal: options.signal,
    retries: dbRetries,
    sleep: options.dbRetrySleep,
  };

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
    const previousResult = await executeInventoryQuery(c, {
      sql: `SELECT COUNT(*) AS count
        FROM pds_instance
        WHERE relay_url = ? AND relay_status <> 'not_seen'`,
      args: [PDS_RELAY_BASE_URL],
    }, queryOptions);
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

  for (let offset = 0; offset < instances.length; offset += chunkSize) {
    options.signal?.throwIfAborted();
    const chunk = instances.slice(offset, offset + chunkSize);
    await recordRelayStatusTransitions(
      c,
      chunk,
      observedAt,
      scanId,
      queryOptions,
      chunkSize,
    );
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
      const values = group.rows.map(() =>
        "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
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
          instance.relayStatus === "active" ? observedAt : null,
          scanId,
        );
      }
      await executeInventoryQuery(c, {
        sql: `INSERT INTO pds_instance (
            service_host, service_endpoint, account_host, relay_url,
            relay_status, relay_account_count, relay_seq, is_bluesky_host,
            first_observed_at, last_observed_at, last_active_at, last_scan_id
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
            last_active_at = CASE
              WHEN excluded.relay_status = 'active'
              THEN excluded.last_observed_at
              ELSE pds_instance.last_active_at
            END,
            last_scan_id = excluded.last_scan_id`,
        args,
      }, queryOptions);
    }
  }

  let staleInstances = 0;
  let publishedHosts = 0;
  if (complete) {
    options.signal?.throwIfAborted();
    const staleRows = await executeInventoryQuery(c, {
      sql: `SELECT service_host, account_host, relay_account_count, relay_seq
        FROM pds_instance
        WHERE relay_url = ? AND last_scan_id <> ? AND relay_status <> 'not_seen'`,
      args: [PDS_RELAY_BASE_URL, scanId],
    }, queryOptions);
    await insertRelayStatusTransitions(
      c,
      staleRows.rows.map((row) => ({
        serviceHost: String(row.service_host),
        accountHost: String(row.account_host),
        relayStatus: "not_seen" as const,
        relayAccountCount: row.relay_account_count == null
          ? null
          : Number(row.relay_account_count),
        relaySeq: row.relay_seq == null ? null : Number(row.relay_seq),
      })),
      observedAt,
      scanId,
      queryOptions,
      chunkSize,
    );
    const stale = await executeInventoryQuery(c, {
      sql: `UPDATE pds_instance
        SET relay_status = 'not_seen'
        WHERE relay_url = ? AND last_scan_id <> ? AND relay_status <> 'not_seen'`,
      args: [PDS_RELAY_BASE_URL, scanId],
    }, queryOptions);
    staleInstances = Number(stale.rowsAffected ?? 0);
    const published = await executeInventoryQuery(c, {
      sql: `INSERT INTO account_host (
          host, display_name, description, service_endpoint,
          signup_status, verification_status, source,
          last_observed_at, created_at, updated_at
        )
        SELECT p.account_host,
          p.account_host,
          'An account host observed in the public relay inventory.',
          MIN(p.service_endpoint),
          'unknown', 'observed', 'observed',
          MAX(p.last_observed_at), ?, ?
        FROM pds_instance p
        WHERE p.relay_status <> 'not_seen'
          AND NOT EXISTS (
            SELECT 1 FROM account_host h WHERE h.host = p.account_host
          )
        GROUP BY p.account_host
        ON CONFLICT(host) DO NOTHING`,
      args: [observedAt, observedAt],
    }, queryOptions);
    publishedHosts = Number(published.rowsAffected ?? 0);
    await executeInventoryQuery(c, {
      sql: `UPDATE account_host
        SET service_endpoint = COALESCE(account_host.service_endpoint, (
              SELECT MIN(p.service_endpoint)
              FROM pds_instance p
              WHERE p.account_host = account_host.host
                AND p.relay_status <> 'not_seen'
            )),
            service_observed_at = CASE
              WHEN account_host.service_endpoint IS NULL OR
                account_host.service_endpoint = (
                  SELECT MIN(p.service_endpoint)
                  FROM pds_instance p
                  WHERE p.account_host = account_host.host
                    AND p.relay_status <> 'not_seen'
                )
              THEN COALESCE(account_host.service_observed_at, (
                SELECT MAX(p.last_observed_at)
                FROM pds_instance p
                WHERE p.account_host = account_host.host
                  AND p.relay_status <> 'not_seen'
              ))
              ELSE account_host.service_observed_at
            END,
            observed_account_count = COALESCE((
              SELECT SUM(p.relay_account_count)
              FROM pds_instance p
              WHERE p.account_host = account_host.host
                AND p.relay_status <> 'not_seen'
            ), 0),
            observed_active_account_count = COALESCE((
              SELECT SUM(CASE WHEN p.relay_status = 'active'
                THEN p.relay_account_count ELSE 0 END)
              FROM pds_instance p
              WHERE p.account_host = account_host.host
                AND p.relay_status <> 'not_seen'
            ), 0),
            last_active_at = COALESCE((
              SELECT MAX(p.last_active_at)
              FROM pds_instance p
              WHERE p.account_host = account_host.host
            ), account_host.last_active_at),
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
    }, queryOptions);
  }

  return {
    storedInstances: instances.length,
    publishedHosts,
    staleInstances,
    complete,
    scanId,
  };
}

async function recordRelayStatusTransitions(
  c: DbClient,
  instances: RelayPdsInstance[],
  observedAt: number,
  scanId: string,
  queryOptions: InventoryQueryOptions,
  chunkSize: number,
): Promise<void> {
  if (instances.length === 0) return;
  const placeholders = instances.map(() => "?").join(", ");
  const existing = await executeInventoryQuery(c, {
    sql: `SELECT p.service_host, p.relay_status,
        CASE WHEN EXISTS (
          SELECT 1 FROM pds_instance_status_history h
          WHERE h.service_host = p.service_host
        ) THEN 1 ELSE 0 END AS has_history
      FROM pds_instance p
      WHERE p.service_host IN (${placeholders})`,
    args: instances.map((instance) => instance.serviceHost),
  }, queryOptions);
  const previous = new Map(
    existing.rows.map((row) => [
      String(row.service_host),
      {
        status: String(row.relay_status),
        hasHistory: Number(row.has_history) === 1,
      },
    ]),
  );
  const transitions = instances.filter((instance) => {
    const prior = previous.get(instance.serviceHost);
    return !prior || !prior.hasHistory || prior.status !== instance.relayStatus;
  });
  await insertRelayStatusTransitions(
    c,
    transitions,
    observedAt,
    scanId,
    queryOptions,
    chunkSize,
  );
}

async function insertRelayStatusTransitions(
  c: DbClient,
  transitions: RelayStatusTransition[],
  observedAt: number,
  scanId: string,
  queryOptions: InventoryQueryOptions,
  chunkSize: number,
): Promise<void> {
  for (
    let offset = 0;
    offset < transitions.length;
    offset += chunkSize
  ) {
    queryOptions.signal?.throwIfAborted();
    const chunk = transitions.slice(offset, offset + chunkSize);
    const values = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(
      ", ",
    );
    const args: Array<string | number | null> = [];
    for (const transition of chunk) {
      args.push(
        `${scanId}:${transition.serviceHost}:${transition.relayStatus}`,
        transition.serviceHost,
        transition.accountHost,
        PDS_RELAY_BASE_URL,
        transition.relayStatus,
        transition.relayAccountCount,
        transition.relaySeq,
        observedAt,
        scanId,
      );
    }
    await executeInventoryQuery(c, {
      sql: `INSERT INTO pds_instance_status_history (
          transition_id, service_host, account_host, relay_url,
          relay_status, relay_account_count, relay_seq, observed_at, scan_id
        ) VALUES ${values}
        ON CONFLICT(transition_id) DO NOTHING`,
      args,
    }, queryOptions);
  }
}

function positiveBoundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}`);
  }
  return resolved;
}

function nonNegativeBoundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > maximum) {
    throw new Error(`${label} must be an integer between 0 and ${maximum}`);
  }
  return resolved;
}

export function inventoryDbRetryDelayMs(
  retryNumber: number,
  random = Math.random,
): number {
  if (!Number.isSafeInteger(retryNumber) || retryNumber < 1) {
    throw new Error("retryNumber must be a positive integer");
  }
  const ceiling = Math.min(
    DB_RETRY_MAX_DELAY_MS,
    DB_RETRY_BASE_DELAY_MS * 2 ** (retryNumber - 1),
  );
  // Equal jitter avoids synchronized retries while retaining a useful floor.
  return Math.floor(ceiling / 2 + random() * ceiling / 2);
}

export function inventoryDbErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const raw = (error as { code?: unknown }).code;
  return typeof raw === "string" && raw.length <= 64 ? raw : null;
}

export function isRetryableInventoryDbError(error: unknown): boolean {
  const code = inventoryDbErrorCode(error)?.toUpperCase() ?? "";
  if (
    [
      "40001", // serialization_failure
      "40P01", // deadlock_detected
      "55P03", // lock_not_available
      "57P03", // cannot_connect_now
      "53300", // too_many_connections
      "SQLITE_BUSY",
      "SQLITE_LOCKED",
    ].includes(code)
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("database is locked") ||
    message.includes("database is busy") ||
    message.includes("could not serialize access") ||
    message.includes("deadlock detected") ||
    message.includes("lock timeout") ||
    message.includes("too many connections");
}

async function executeInventoryQuery(
  client: DbClient,
  query: InventoryDbQuery,
  options: InventoryQueryOptions,
): Promise<Awaited<ReturnType<DbClient["execute"]>>> {
  const sleep = options.sleep ?? sleepWithSignal;
  for (let attempt = 0;; attempt++) {
    options.signal?.throwIfAborted();
    try {
      return await client.execute(query);
    } catch (error) {
      if (attempt >= options.retries || !isRetryableInventoryDbError(error)) {
        throw error;
      }
      const retryNumber = attempt + 1;
      const delayMs = inventoryDbRetryDelayMs(retryNumber);
      console.warn(JSON.stringify({
        event: "pds_inventory_db_retry",
        retry: retryNumber,
        delayMs,
        errorCode: inventoryDbErrorCode(error) ?? "unknown",
      }));
      await sleep(delayMs, options.signal);
    }
  }
}

async function sleepWithSignal(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
