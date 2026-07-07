import {
  accountHostKeyForEndpoint,
  observeAccountHost,
} from "./account-hosts.ts";
import { type DbClient, withDb } from "./db.ts";
import { normalizeServiceEndpoint } from "./identity.ts";

export type PdsDiscoverySource =
  | "jetstream"
  | "oauth"
  | "plc_export"
  | "manual";

export interface PdsAccountObservationInput {
  did: string;
  handle?: string | null;
  serviceEndpoint: string;
  source: PdsDiscoverySource;
  observedAt?: number;
  activeAt?: number | null;
}

export interface PdsAccountObservationResult {
  accountHost: string;
  serviceEndpoint: string;
  serviceHost: string;
  observedAccountCount: number;
  observedActiveAccountCount: number;
}

const ACTIVE_ACCOUNT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function now(): number {
  return Date.now();
}

function normalizeDid(value: string): string | null {
  const did = value.trim();
  return /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(did) ? did : null;
}

function normalizeHandle(value: string | null | undefined): string | null {
  const handle = (value ?? "").trim().replace(/^@/, "").toLowerCase();
  if (
    !handle ||
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(handle)
  ) return null;
  return handle;
}

export function normalizePdsDiscoveryEndpoint(value: string): string | null {
  try {
    const normalized = normalizeServiceEndpoint(value);
    const url = new URL(normalized);
    return url.origin;
  } catch {
    return null;
  }
}

function serviceHostForEndpoint(serviceEndpoint: string): string {
  return new URL(serviceEndpoint).host.toLowerCase();
}

export async function observePdsAccount(
  input: PdsAccountObservationInput,
): Promise<PdsAccountObservationResult | null> {
  const did = normalizeDid(input.did);
  if (!did) return null;
  const serviceEndpoint = normalizePdsDiscoveryEndpoint(input.serviceEndpoint);
  if (!serviceEndpoint) return null;
  const serviceHost = serviceHostForEndpoint(serviceEndpoint);
  const accountHost = accountHostKeyForEndpoint(serviceEndpoint);
  const handle = normalizeHandle(input.handle);
  const observedAt = Math.max(0, Math.floor(input.observedAt ?? now()));
  const activeAt = input.activeAt == null
    ? null
    : Math.max(0, Math.floor(input.activeAt));

  await observeAccountHost(serviceEndpoint);

  let previousAccountHost: string | null = null;
  await withDb(async (c) => {
    const existing = await c.execute({
      sql: `SELECT account_host FROM pds_host_account WHERE did = ? LIMIT 1`,
      args: [did],
    });
    previousAccountHost = typeof existing.rows[0]?.account_host === "string"
      ? existing.rows[0].account_host
      : null;

    await c.execute({
      sql: `INSERT INTO pds_host_account (
          did, handle, service_endpoint, service_host, account_host, source,
          first_observed_at, last_observed_at, last_active_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(did) DO UPDATE SET
          handle = COALESCE(excluded.handle, pds_host_account.handle),
          service_endpoint = excluded.service_endpoint,
          service_host = excluded.service_host,
          account_host = excluded.account_host,
          source = excluded.source,
          last_observed_at = excluded.last_observed_at,
          last_active_at = COALESCE(excluded.last_active_at, pds_host_account.last_active_at)`,
      args: [
        did,
        handle,
        serviceEndpoint,
        serviceHost,
        accountHost,
        input.source,
        observedAt,
        observedAt,
        activeAt,
      ],
    });
  });

  const counts = await refreshPdsHostCounts(accountHost);
  if (previousAccountHost && previousAccountHost !== accountHost) {
    await refreshPdsHostCounts(previousAccountHost);
  }
  return {
    accountHost,
    serviceEndpoint,
    serviceHost,
    observedAccountCount: counts.observedAccountCount,
    observedActiveAccountCount: counts.observedActiveAccountCount,
  };
}

export async function refreshPdsHostCounts(host: string): Promise<{
  observedAccountCount: number;
  observedActiveAccountCount: number;
  lastIndexedAccountAt: number | null;
}> {
  const accountHost = host.trim().toLowerCase();
  if (!accountHost) {
    return {
      observedAccountCount: 0,
      observedActiveAccountCount: 0,
      lastIndexedAccountAt: null,
    };
  }
  const cutoff = now() - ACTIVE_ACCOUNT_WINDOW_MS;
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `SELECT
          COUNT(*) AS total,
          COUNT(CASE WHEN last_active_at IS NOT NULL AND last_active_at >= ? THEN 1 END) AS active,
          MAX(last_observed_at) AS last_indexed
        FROM pds_host_account
        WHERE account_host = ?`,
      args: [cutoff, accountHost],
    });
    const row = result.rows[0] ?? {};
    const observedAccountCount = Number(row.total ?? 0);
    const observedActiveAccountCount = Number(row.active ?? 0);
    const lastIndexedAccountAt = row.last_indexed == null
      ? null
      : Number(row.last_indexed);
    await updateAccountHostDiscoveryStats(c, {
      accountHost,
      observedAccountCount,
      observedActiveAccountCount,
      lastIndexedAccountAt,
    });
    return {
      observedAccountCount,
      observedActiveAccountCount,
      lastIndexedAccountAt,
    };
  });
}

async function updateAccountHostDiscoveryStats(
  c: DbClient,
  input: {
    accountHost: string;
    observedAccountCount: number;
    observedActiveAccountCount: number;
    lastIndexedAccountAt: number | null;
  },
): Promise<void> {
  const ts = now();
  if (input.lastIndexedAccountAt == null) {
    await c.execute({
      sql: `UPDATE account_host
        SET observed_account_count = ?,
            observed_active_account_count = ?,
            last_indexed_account_at = NULL,
            updated_at = ?
        WHERE host = ?`,
      args: [
        input.observedAccountCount,
        input.observedActiveAccountCount,
        ts,
        input.accountHost,
      ],
    });
    return;
  }

  await c.execute({
    sql: `UPDATE account_host
      SET observed_account_count = ?,
          observed_active_account_count = ?,
          last_indexed_account_at = ?,
          last_observed_at = CASE
            WHEN last_observed_at IS NULL OR last_observed_at < ? THEN ?
            ELSE last_observed_at
          END,
          updated_at = ?
      WHERE host = ?`,
    args: [
      input.observedAccountCount,
      input.observedActiveAccountCount,
      input.lastIndexedAccountAt,
      input.lastIndexedAccountAt,
      input.lastIndexedAccountAt,
      ts,
      input.accountHost,
    ],
  });
}

export async function getPdsDiscoveryCursor(
  source: string,
): Promise<string | null> {
  const key = source.trim();
  if (!key) return null;
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `SELECT cursor FROM pds_discovery_cursor WHERE source = ? LIMIT 1`,
      args: [key],
    });
    const cursor = result.rows[0]?.cursor;
    return typeof cursor === "string" ? cursor : null;
  });
}

export async function setPdsDiscoveryCursor(
  source: string,
  cursor: string,
): Promise<void> {
  const key = source.trim();
  const value = cursor.trim();
  if (!key || !value) return;
  const ts = now();
  await withDb(async (c) => {
    await c.execute({
      sql: `INSERT INTO pds_discovery_cursor (source, cursor, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET
          cursor = excluded.cursor,
          updated_at = excluded.updated_at`,
      args: [key, value, ts],
    });
  });
}
