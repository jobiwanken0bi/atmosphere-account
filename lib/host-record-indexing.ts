import {
  accountManagementUrlForEndpoint,
  type HostSignupStatus,
} from "./account-hosts.ts";
import { type DbClient, withDb } from "./db.ts";
import {
  HOST_IMAGE_PURPOSE_AVATAR,
  HOST_LINK_ROLE_HOMEPAGE,
  HOST_LINK_ROLE_SUPPORT,
} from "./host-records.ts";
import { HOST_PROFILE_NSID, HOST_SERVICE_NSID } from "./lexicons.ts";

const HOST_LINK_ROLE_SIGNUP = "account.atmosphere.host.defs#linkRoleSignup";
const HOST_LINK_ROLE_LOGIN = "account.atmosphere.host.defs#linkRoleLogin";
const HOST_LINK_ROLE_DASHBOARD =
  "account.atmosphere.host.defs#linkRoleDashboard";
const HOST_IMAGE_PURPOSE_LOGO = "account.atmosphere.host.defs#purposeLogo";
const HOST_SIGNUP_OPEN = "account.atmosphere.host.defs#signupOpen";
const HOST_SIGNUP_INVITE = "account.atmosphere.host.defs#signupInviteOnly";
const HOST_SIGNUP_WAITLIST = "account.atmosphere.host.defs#signupWaitlist";
const HOST_SIGNUP_CLOSED = "account.atmosphere.host.defs#signupClosed";

export interface HostProtocolRecordInput {
  uri: string;
  cid: string | null;
  collection: string;
  repoDid: string;
  rkey: string;
  authorHandle?: string | null;
  value: unknown;
}

export interface ParsedHostServiceRecord {
  kind: "service";
  host: string;
  displayName: string;
  description: string;
  serviceEndpoint: string;
  accountManagementUrl: string | null;
  homepageUrl: string | null;
  supportUrl: string | null;
  signupStatus: HostSignupStatus;
  dashboardManifestUrl: string | null;
  capabilities: Record<string, unknown>[];
  matchPatterns: string[];
  createdAt: number | null;
  updatedAt: number | null;
}

export interface ParsedHostProfileRecord {
  kind: "profile";
  name: string;
  description: string;
  homepageUrl: string | null;
  supportUrl: string | null;
  avatarUrl: string | null;
  serviceRefs: Array<{ uri: string; host: string | null }>;
  createdAt: number | null;
  updatedAt: number | null;
}

export type ParsedHostProtocolRecord =
  | ParsedHostServiceRecord
  | ParsedHostProfileRecord;

export interface HostSourceRecord {
  uri: string;
  cid: string | null;
  collection: string;
  repoDid: string;
  rkey: string;
  authorHandle: string | null;
  host: string | null;
  displayName: string | null;
  serviceEndpoint: string | null;
  indexedAt: number;
  deletedAt: number | null;
}

function now(): number {
  return Date.now();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function str(value: unknown, max = 8192): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, max)
    : null;
}

function timestamp(value: unknown): number | null {
  const raw = str(value, 128);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHost(value: unknown): string | null {
  const raw = str(value, 253)?.toLowerCase().replace(/\.$/, "") ?? "";
  if (!raw) return null;
  if (/^https?:\/\//.test(raw)) {
    try {
      return normalizeHost(new URL(raw).hostname);
    } catch {
      return null;
    }
  }
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(raw)
  ) {
    return null;
  }
  if (
    raw === "localhost" || raw.endsWith(".localhost") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)
  ) {
    return null;
  }
  return raw;
}

function normalizePublicHttpsUrl(value: unknown): string | null {
  const raw = str(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizePublicServiceEndpoint(value: unknown): string | null {
  const raw = str(value, 512);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return `${url.origin}${
      url.pathname && url.pathname !== "/" ? url.pathname : ""
    }`;
  } catch {
    return null;
  }
}

function normalizeHandle(value: string | null | undefined): string | null {
  const raw = value?.trim().replace(/^@/, "").toLowerCase() ?? "";
  if (
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(raw)
  ) {
    return raw;
  }
  return null;
}

function readStrings(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const raw = str(item, 253);
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
    if (out.length >= maxItems) break;
  }
  return out;
}

function readLinks(
  value: unknown,
): Array<{ role: string; url: string }> {
  if (!Array.isArray(value)) return [];
  const links: Array<{ role: string; url: string }> = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const role = str(row.role, 128);
    const url = normalizePublicHttpsUrl(row.url);
    if (!role || !url) continue;
    links.push({ role, url });
    if (links.length >= 12) break;
  }
  return links;
}

function linkForRole(
  links: Array<{ role: string; url: string }>,
  roles: string[],
): string | null {
  return links.find((link) => roles.includes(link.role))?.url ?? null;
}

function signupStatus(value: unknown): HostSignupStatus {
  const row = asRecord(value);
  const status = str(row?.status, 128);
  if (status === HOST_SIGNUP_OPEN) return "open";
  if (status === HOST_SIGNUP_INVITE || status === HOST_SIGNUP_WAITLIST) {
    return "invite_required";
  }
  if (status === HOST_SIGNUP_CLOSED) return "closed";
  return "unknown";
}

function blobCid(blob: unknown): string | null {
  const row = asRecord(blob);
  if (!row) return null;
  const ref = asRecord(row.ref);
  return str(ref?.$link, 256) ?? str(ref?.link, 256) ?? str(row.cid, 256);
}

function blobUrl(blob: unknown, repoDid: string): string | null {
  const cid = blobCid(blob);
  if (!cid) return null;
  return `/api/atproto/blob?did=${encodeURIComponent(repoDid)}&cid=${
    encodeURIComponent(cid)
  }`;
}

function readProfileAvatar(value: unknown, repoDid: string): string | null {
  if (!Array.isArray(value)) return null;
  const images = value.map(asRecord).filter((
    row,
  ): row is Record<string, unknown> => !!row);
  const preferred =
    images.find((row) =>
      row.purpose === HOST_IMAGE_PURPOSE_AVATAR ||
      row.purpose === HOST_IMAGE_PURPOSE_LOGO
    ) ?? images[0];
  return preferred ? blobUrl(preferred.image, repoDid) : null;
}

function readServiceRefs(
  value: unknown,
): Array<{ uri: string; host: string | null }> {
  if (!Array.isArray(value)) return [];
  const refs: Array<{ uri: string; host: string | null }> = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const uri = str(row.uri, 2048);
    if (!uri?.startsWith("at://")) continue;
    refs.push({ uri, host: normalizeHost(row.host) });
    if (refs.length >= 32) break;
  }
  return refs;
}

function readCapabilities(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((row): row is Record<string, unknown> =>
    !!row
  ).slice(0, 32);
}

export function parseHostServiceRecord(
  input: HostProtocolRecordInput,
): ParsedHostServiceRecord | null {
  const record = asRecord(input.value);
  if (!record) return null;
  const host = normalizeHost(record.host);
  const displayName = str(record.displayName, 80);
  const serviceEndpoint = normalizePublicServiceEndpoint(
    record.serviceEndpoint,
  );
  const createdAt = timestamp(record.createdAt);
  if (!host || !displayName || !serviceEndpoint || !createdAt) return null;
  const links = readLinks(record.links);
  const signup = asRecord(record.signup);
  const signupUrl = normalizePublicHttpsUrl(signup?.url);
  const homepageUrl = linkForRole(links, [
    HOST_LINK_ROLE_HOMEPAGE,
    HOST_LINK_ROLE_SIGNUP,
    HOST_LINK_ROLE_LOGIN,
  ]) ?? signupUrl;
  const accountManagementUrl = normalizePublicHttpsUrl(
    record.accountManagementUrl,
  ) ?? accountManagementUrlForEndpoint(serviceEndpoint);
  const capabilities = readCapabilities(record.capabilities);
  const matchPatterns = readStrings(record.hostPatterns, 32)
    .map((pattern) => pattern.toLowerCase())
    .filter((pattern) =>
      pattern === host || pattern.startsWith("*.") ||
      normalizeHost(pattern) !== null
    );
  if (!matchPatterns.includes(host)) matchPatterns.unshift(host);
  return {
    kind: "service",
    host,
    displayName,
    description: str(record.description, 600) ?? "",
    serviceEndpoint,
    accountManagementUrl,
    homepageUrl,
    supportUrl: linkForRole(links, [HOST_LINK_ROLE_SUPPORT]) ??
      normalizePublicHttpsUrl(asRecord(record.contact)?.url),
    signupStatus: signupStatus(record.signup),
    dashboardManifestUrl: normalizePublicHttpsUrl(
      record.dashboardManifestUrl,
    ) ?? linkForRole(links, [HOST_LINK_ROLE_DASHBOARD]),
    capabilities,
    matchPatterns,
    createdAt,
    updatedAt: timestamp(record.updatedAt),
  };
}

export function parseHostProfileRecord(
  input: HostProtocolRecordInput,
): ParsedHostProfileRecord | null {
  const record = asRecord(input.value);
  if (!record) return null;
  const name = str(record.name, 200);
  const createdAt = timestamp(record.createdAt);
  if (!name || !createdAt) return null;
  const links = readLinks(record.links);
  return {
    kind: "profile",
    name,
    description: str(record.description, 3000) ?? "",
    homepageUrl: linkForRole(links, [
      HOST_LINK_ROLE_HOMEPAGE,
      HOST_LINK_ROLE_SIGNUP,
      HOST_LINK_ROLE_LOGIN,
    ]),
    supportUrl: linkForRole(links, [HOST_LINK_ROLE_SUPPORT]) ??
      normalizePublicHttpsUrl(asRecord(record.contact)?.url),
    avatarUrl: readProfileAvatar(record.images, input.repoDid),
    serviceRefs: readServiceRefs(record.serviceRefs),
    createdAt,
    updatedAt: timestamp(record.updatedAt),
  };
}

export function parseHostProtocolRecord(
  input: HostProtocolRecordInput,
): ParsedHostProtocolRecord | null {
  if (input.collection === HOST_SERVICE_NSID) {
    return parseHostServiceRecord(input);
  }
  if (input.collection === HOST_PROFILE_NSID) {
    return parseHostProfileRecord(input);
  }
  return null;
}

export async function upsertHostProtocolRecord(
  input: HostProtocolRecordInput,
): Promise<ParsedHostProtocolRecord | null> {
  const parsed = parseHostProtocolRecord(input);
  if (!parsed) return null;
  const indexedAt = now();
  await withDb(async (c) => {
    await upsertHostRecordRow(c, input, parsed, indexedAt);
    if (parsed.kind === "service") {
      await upsertAccountHostFromService(c, input, parsed, indexedAt);
    } else {
      await enrichAccountHostsFromProfile(c, input, parsed, indexedAt);
    }
  });
  return parsed;
}

export async function markHostProtocolRecordDeleted(
  uri: string,
): Promise<void> {
  const deletedAt = now();
  await withDb(async (c) => {
    const existing = await c.execute({
      sql: `SELECT host, collection FROM host_record WHERE uri = ? LIMIT 1`,
      args: [uri],
    });
    await c.execute({
      sql:
        `UPDATE host_record SET deleted_at = ?, indexed_at = ? WHERE uri = ?`,
      args: [deletedAt, deletedAt, uri],
    });
    const row = existing.rows[0] as Record<string, unknown> | undefined;
    const host = row?.host ? String(row.host) : null;
    if (host && row?.collection === HOST_SERVICE_NSID) {
      await c.execute({
        sql: `UPDATE account_host
          SET service_record_uri = NULL,
              service_record_cid = NULL,
              service_observed_at = NULL,
              updated_at = ?
          WHERE host = ? AND service_record_uri = ?`,
        args: [deletedAt, host, uri],
      });
    }
  });
}

export async function listHostProtocolRecords(
  host: string,
): Promise<HostSourceRecord[]> {
  const normalized = normalizeHost(host);
  if (!normalized) return [];
  return await withDb(async (c) => {
    const pattern = `%"host":"${normalized}"%`;
    const result = await c.execute({
      sql: `SELECT *
        FROM host_record
        WHERE host = ?
          OR (collection = ? AND parsed_json LIKE ?)
        ORDER BY deleted_at IS NULL DESC, indexed_at DESC
        LIMIT 25`,
      args: [normalized, HOST_PROFILE_NSID, pattern],
    });
    return result.rows.map(parseHostSourceRow);
  });
}

function parseHostSourceRow(row: Record<string, unknown>): HostSourceRecord {
  return {
    uri: String(row.uri),
    cid: row.cid ? String(row.cid) : null,
    collection: String(row.collection),
    repoDid: String(row.repo_did),
    rkey: String(row.rkey),
    authorHandle: row.author_handle ? String(row.author_handle) : null,
    host: row.host ? String(row.host) : null,
    displayName: row.display_name ? String(row.display_name) : null,
    serviceEndpoint: row.service_endpoint ? String(row.service_endpoint) : null,
    indexedAt: Number(row.indexed_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  };
}

async function upsertHostRecordRow(
  c: DbClient,
  input: HostProtocolRecordInput,
  parsed: ParsedHostProtocolRecord,
  indexedAt: number,
): Promise<void> {
  const host = parsed.kind === "service"
    ? parsed.host
    : parsed.serviceRefs[0]?.host ?? null;
  const displayName = parsed.kind === "service"
    ? parsed.displayName
    : parsed.name;
  const serviceEndpoint = parsed.kind === "service"
    ? parsed.serviceEndpoint
    : null;
  await c.execute({
    sql: `INSERT INTO host_record (
        uri, cid, collection, repo_did, rkey, author_handle,
        raw_json, parsed_json, host, display_name, service_endpoint,
        indexed_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(uri) DO UPDATE SET
        cid = excluded.cid,
        collection = excluded.collection,
        repo_did = excluded.repo_did,
        rkey = excluded.rkey,
        author_handle = excluded.author_handle,
        raw_json = excluded.raw_json,
        parsed_json = excluded.parsed_json,
        host = excluded.host,
        display_name = excluded.display_name,
        service_endpoint = excluded.service_endpoint,
        indexed_at = excluded.indexed_at,
        deleted_at = NULL`,
    args: [
      input.uri,
      input.cid,
      input.collection,
      input.repoDid,
      input.rkey,
      normalizeHandle(input.authorHandle) ?? null,
      JSON.stringify(input.value),
      JSON.stringify(parsed),
      host,
      displayName,
      serviceEndpoint,
      indexedAt,
    ],
  });
}

async function upsertAccountHostFromService(
  c: DbClient,
  input: HostProtocolRecordInput,
  parsed: ParsedHostServiceRecord,
  indexedAt: number,
): Promise<void> {
  const authorHandle = normalizeHandle(input.authorHandle);
  await c.execute({
    sql: `INSERT INTO account_host (
        host, display_name, description, homepage_url,
        service_endpoint, account_management_url, dashboard_url,
        capability_manifest_url, capabilities_json, support_url,
        profile_handle, profile_did, claim_handle, claim_did,
        signup_status, verification_status, source, match_patterns,
        service_record_uri, service_record_cid, service_observed_at,
        last_checked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'observed', 'manual', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host) DO UPDATE SET
        display_name = excluded.display_name,
        description = CASE
          WHEN excluded.description <> '' THEN excluded.description
          ELSE account_host.description
        END,
        homepage_url = COALESCE(excluded.homepage_url, account_host.homepage_url),
        service_endpoint = excluded.service_endpoint,
        account_management_url = COALESCE(excluded.account_management_url, account_host.account_management_url),
        capability_manifest_url = COALESCE(excluded.capability_manifest_url, account_host.capability_manifest_url),
        capabilities_json = COALESCE(excluded.capabilities_json, account_host.capabilities_json),
        support_url = COALESCE(excluded.support_url, account_host.support_url),
        profile_handle = COALESCE(account_host.profile_handle, excluded.profile_handle),
        profile_did = COALESCE(account_host.profile_did, excluded.profile_did),
        claim_handle = COALESCE(account_host.claim_handle, excluded.claim_handle),
        claim_did = COALESCE(account_host.claim_did, excluded.claim_did),
        signup_status = excluded.signup_status,
        verification_status = CASE
          WHEN account_host.verification_status IN ('verified', 'claimed')
          THEN account_host.verification_status
          ELSE 'observed'
        END,
        source = CASE
          WHEN account_host.source = 'seeded' THEN 'seeded'
          ELSE 'manual'
        END,
        match_patterns = excluded.match_patterns,
        service_record_uri = excluded.service_record_uri,
        service_record_cid = excluded.service_record_cid,
        service_observed_at = excluded.service_observed_at,
        last_checked_at = excluded.last_checked_at,
        updated_at = excluded.updated_at`,
    args: [
      parsed.host,
      parsed.displayName,
      parsed.description,
      parsed.homepageUrl,
      parsed.serviceEndpoint,
      parsed.accountManagementUrl,
      parsed.dashboardManifestUrl,
      JSON.stringify(parsed.capabilities),
      parsed.supportUrl,
      authorHandle,
      input.repoDid,
      authorHandle,
      input.repoDid,
      parsed.signupStatus,
      JSON.stringify(parsed.matchPatterns),
      input.uri,
      input.cid,
      indexedAt,
      indexedAt,
      parsed.createdAt ?? indexedAt,
      indexedAt,
    ],
  });
}

async function enrichAccountHostsFromProfile(
  c: DbClient,
  input: HostProtocolRecordInput,
  parsed: ParsedHostProfileRecord,
  indexedAt: number,
): Promise<void> {
  const authorHandle = normalizeHandle(input.authorHandle);
  const targetHosts = new Set<string>();
  for (const ref of parsed.serviceRefs) {
    if (ref.host) targetHosts.add(ref.host);
    const result = await c.execute({
      sql: `SELECT host FROM account_host WHERE service_record_uri = ? LIMIT 1`,
      args: [ref.uri],
    });
    const host = result.rows[0]?.host;
    if (host) targetHosts.add(String(host));
  }
  const direct = await c.execute({
    sql: `SELECT host FROM account_host
      WHERE profile_did = ? OR claim_did = ?
      LIMIT 25`,
    args: [input.repoDid, input.repoDid],
  });
  for (const row of direct.rows) {
    if (row.host) targetHosts.add(String(row.host));
  }
  for (const host of targetHosts) {
    await c.execute({
      sql: `UPDATE account_host
        SET display_name = CASE
              WHEN account_host.display_name = '' OR account_host.source = 'observed'
              THEN ?
              ELSE account_host.display_name
            END,
            description = CASE
              WHEN account_host.description = '' THEN ?
              ELSE account_host.description
            END,
            homepage_url = COALESCE(account_host.homepage_url, ?),
            support_url = COALESCE(account_host.support_url, ?),
            avatar_url = COALESCE(?, account_host.avatar_url),
            profile_handle = COALESCE(?, account_host.profile_handle),
            profile_did = COALESCE(account_host.profile_did, ?),
            claim_handle = COALESCE(account_host.claim_handle, ?),
            claim_did = COALESCE(account_host.claim_did, ?),
            profile_checked_at = ?,
            updated_at = ?
        WHERE host = ?`,
      args: [
        parsed.name,
        parsed.description,
        parsed.homepageUrl,
        parsed.supportUrl,
        parsed.avatarUrl,
        authorHandle,
        input.repoDid,
        authorHandle,
        input.repoDid,
        indexedAt,
        indexedAt,
        host,
      ],
    });
  }
}
