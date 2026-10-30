import {
  type HostSignupStatus,
  normalizeAccountHostPublicHttpsUrl,
  normalizeAccountHostPublicServiceEndpoint,
} from "./account-hosts.ts";
import {
  type BlobRef,
  HOST_PROFILE_NSID,
  HOST_SERVICE_NSID,
} from "./lexicons.ts";
import {
  getRecordPublic,
  PdsRecordWriteError,
  putRecord,
  type PutRecordOptions,
  type PutRecordResult,
} from "./pds.ts";

const HOST_PROFILE_MAX_SERVICE_REFS = 32;
const HOST_PROFILE_CAS_ATTEMPTS = 4;
const HOST_PROFILE_MANAGED_FIELDS = new Set([
  "$type",
  "name",
  "description",
  "serviceRefs",
  "images",
  "links",
  "createdAt",
  "updatedAt",
]);

export const HOST_LINK_ROLE_HOMEPAGE =
  "account.atmosphere.host.defs#linkRoleHomepage";
export const HOST_LINK_ROLE_SUPPORT =
  "account.atmosphere.host.defs#linkRoleSupport";
export const HOST_IMAGE_PURPOSE_AVATAR =
  "account.atmosphere.host.defs#purposeAvatar";
export const HOST_CAPABILITY_EXTERNAL =
  "account.atmosphere.host.defs#capabilityExternal";
export const HOST_CAPABILITY_PLANNED =
  "account.atmosphere.host.defs#capabilityPlanned";
export const HOST_CAPABILITY_DASHBOARD =
  "account.atmosphere.host.defs#capabilityDashboard";
export const HOST_CAPABILITY_OAUTH_GRANTS =
  "account.atmosphere.host.defs#capabilityOAuthGrantManagement";
export const HOST_CAPABILITY_ACTIVE_SESSIONS =
  "account.atmosphere.host.defs#capabilityActiveSessions";
export const HOST_CAPABILITY_PASSWORD =
  "account.atmosphere.host.defs#capabilityPasswordManagement";
export const HOST_CAPABILITY_ACCOUNT_DELETION =
  "account.atmosphere.host.defs#capabilityAccountDeletion";
export const HOST_CAPABILITY_SUPPORT =
  "account.atmosphere.host.defs#capabilitySupport";
export const HOST_CAPABILITY_REPO_EXPORT =
  "account.atmosphere.host.defs#capabilityRepoExport";
export const HOST_CAPABILITY_BLOB_EXPORT =
  "account.atmosphere.host.defs#capabilityBlobExport";
export const HOST_CAPABILITY_BACKUPS =
  "account.atmosphere.host.defs#capabilityBackups";
export const HOST_CAPABILITY_MIGRATION =
  "account.atmosphere.host.defs#capabilityMigration";

export const HOST_SIGNUP_VALUES: Record<HostSignupStatus, string> = {
  open: "account.atmosphere.host.defs#signupOpen",
  invite_required: "account.atmosphere.host.defs#signupInviteOnly",
  closed: "account.atmosphere.host.defs#signupClosed",
  unknown: "account.atmosphere.host.defs#signupUnknown",
};

export interface HostRecordInput {
  host: string;
  displayName: string;
  description?: string | null;
  dataLocation?: string | null;
  homepageUrl?: string | null;
  signupUrl?: string | null;
  serviceEndpoint: string;
  accountManagementUrl?: string | null;
  supportUrl?: string | null;
  signupStatus: HostSignupStatus;
  avatar?: BlobRef | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface HostRecordPublishResult {
  service: PutRecordResult;
  profile?: PutRecordResult;
}

export class HostProfileServiceRefsLimitError extends Error {
  constructor() {
    super(
      `Host profile already contains the maximum of ${HOST_PROFILE_MAX_SERVICE_REFS} service references`,
    );
    this.name = "HostProfileServiceRefsLimitError";
  }
}

export function hostServiceRkey(host: string): string {
  return host.trim().toLowerCase();
}

export function buildHostServiceRecord(
  input: HostRecordInput,
): Record<string, unknown> {
  const host = hostServiceRkey(input.host);
  const homepageUrl = normalizeAccountHostPublicHttpsUrl(input.homepageUrl);
  const signupUrl = normalizeAccountHostPublicHttpsUrl(input.signupUrl);
  const serviceEndpoint = normalizeAccountHostPublicServiceEndpoint(
    input.serviceEndpoint,
  );
  const accountManagementUrl = normalizeAccountHostPublicHttpsUrl(
    input.accountManagementUrl,
  );
  const supportUrl = normalizeAccountHostPublicHttpsUrl(input.supportUrl);
  return omitEmpty({
    host,
    displayName: input.displayName.trim(),
    description: textOrUndefined(input.description),
    serviceEndpoint: serviceEndpoint || undefined,
    accountManagementUrl: accountManagementUrl || undefined,
    hostPatterns: [host],
    regions: dataLocationRegions(input.dataLocation),
    status: "account.atmosphere.host.defs#statusActive",
    signup: {
      status: HOST_SIGNUP_VALUES[input.signupStatus],
      url: signupUrl || undefined,
    },
    capabilities: hostServiceCapabilities(
      accountManagementUrl,
      supportUrl ?? "",
    ),
    links: hostLinks(homepageUrl ?? "", supportUrl ?? ""),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || undefined,
  });
}

export function buildHostProfileRecord(
  input: HostRecordInput,
  serviceRecordUri: string,
): Record<string, unknown> {
  const homepageUrl = normalizeAccountHostPublicHttpsUrl(input.homepageUrl);
  const supportUrl = normalizeAccountHostPublicHttpsUrl(input.supportUrl);
  return omitEmpty({
    name: input.displayName.trim(),
    description: textOrUndefined(input.description),
    serviceRefs: [{
      uri: serviceRecordUri,
      host: hostServiceRkey(input.host),
    }],
    images: input.avatar
      ? [{
        purpose: HOST_IMAGE_PURPOSE_AVATAR,
        image: input.avatar,
        alt: `${input.displayName.trim()} avatar`,
      }]
      : undefined,
    links: hostLinks(homepageUrl ?? "", supportUrl ?? ""),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || undefined,
  });
}

export async function publishHostServiceRecord(
  user: { did: string },
  pdsUrl: string,
  input: HostRecordInput,
): Promise<PutRecordResult> {
  return await putRecord(
    user.did,
    pdsUrl,
    HOST_SERVICE_NSID,
    hostServiceRkey(input.host),
    buildHostServiceRecord(input),
  );
}

export async function publishHostProfileRecord(
  user: { did: string },
  pdsUrl: string,
  input: HostRecordInput,
  serviceRecordUri: string,
): Promise<PutRecordResult> {
  return await publishHostProfileRecordWithIo(
    user,
    pdsUrl,
    input,
    serviceRecordUri,
    {
      readRecord: getRecordPublic,
      writeRecord: putRecord,
    },
  );
}

interface HostProfileRecordIo {
  readRecord: (
    pdsUrl: string,
    did: string,
    collection: string,
    rkey: string,
  ) => Promise<{ uri: string; cid: string; value: unknown } | null>;
  writeRecord: (
    did: string,
    pdsUrl: string,
    collection: string,
    rkey: string,
    record: Record<string, unknown>,
    options?: PutRecordOptions,
  ) => Promise<PutRecordResult>;
}

async function publishHostProfileRecordWithIo(
  user: { did: string },
  pdsUrl: string,
  input: HostRecordInput,
  serviceRecordUri: string,
  io: HostProfileRecordIo,
): Promise<PutRecordResult> {
  let lastConflict: PdsRecordWriteError | null = null;
  for (let attempt = 0; attempt < HOST_PROFILE_CAS_ATTEMPTS; attempt++) {
    const existing = await io.readRecord(
      pdsUrl,
      user.did,
      HOST_PROFILE_NSID,
      "self",
    );
    const record = mergeHostProfileRecord(
      existing?.value,
      user.did,
      input,
      serviceRecordUri,
    );
    try {
      return await io.writeRecord(
        user.did,
        pdsUrl,
        HOST_PROFILE_NSID,
        "self",
        record,
        { swapRecord: existing?.cid ?? null },
      );
    } catch (err) {
      if (
        !isInvalidSwapError(err) || attempt === HOST_PROFILE_CAS_ATTEMPTS - 1
      ) {
        throw err;
      }
      lastConflict = err;
    }
  }
  throw lastConflict ?? new Error("Host profile update did not complete");
}

function mergeHostProfileRecord(
  existing: unknown,
  ownerDid: string,
  input: HostRecordInput,
  serviceRecordUri: string,
): Record<string, unknown> {
  const next = buildHostProfileRecord(input, serviceRecordUri);
  const preserved = compatibleExistingProfileFields(existing);
  return {
    ...preserved,
    ...next,
    serviceRefs: mergeHostServiceRefs(
      isObjectRecord(existing) ? existing.serviceRefs : undefined,
      ownerDid,
      hostServiceRkey(input.host),
      serviceRecordUri,
    ),
  };
}

function compatibleExistingProfileFields(
  existing: unknown,
): Record<string, unknown> {
  if (!isObjectRecord(existing)) return {};
  const preserved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (HOST_PROFILE_MANAGED_FIELDS.has(key) || value === undefined) continue;
    preserved[key] = value;
  }
  return preserved;
}

function mergeHostServiceRefs(
  existing: unknown,
  ownerDid: string,
  targetHost: string,
  targetUri: string,
): Array<Record<string, unknown>> {
  const parsedTarget = parseOwnedHostServiceUri(targetUri, ownerDid);
  if (!parsedTarget || parsedTarget.host !== targetHost) {
    throw new Error("PDS returned an invalid host service record URI");
  }

  const refs: Array<Record<string, unknown>> = [];
  const seenUris = new Set<string>();
  const seenHosts = new Set<string>();
  let insertedTarget = false;

  for (const item of Array.isArray(existing) ? existing : []) {
    if (!isObjectRecord(item)) continue;
    const parsed = parseOwnedHostServiceUri(item.uri, ownerDid);
    if (!parsed || seenUris.has(parsed.uri) || seenHosts.has(parsed.host)) {
      continue;
    }
    seenUris.add(parsed.uri);
    seenHosts.add(parsed.host);

    const isTarget = parsed.uri === parsedTarget.uri ||
      parsed.host === targetHost;
    const ref = {
      ...item,
      uri: isTarget ? parsedTarget.uri : parsed.uri,
      host: isTarget ? targetHost : parsed.host,
    };
    if (isTarget) insertedTarget = true;
    refs.push(ref);
    if (refs.length > HOST_PROFILE_MAX_SERVICE_REFS) {
      throw new HostProfileServiceRefsLimitError();
    }
  }

  if (!insertedTarget) {
    if (refs.length >= HOST_PROFILE_MAX_SERVICE_REFS) {
      throw new HostProfileServiceRefsLimitError();
    }
    refs.push({ uri: parsedTarget.uri, host: targetHost });
  }
  return refs;
}

function parseOwnedHostServiceUri(
  value: unknown,
  ownerDid: string,
): { uri: string; host: string } | null {
  if (typeof value !== "string") return null;
  const uri = value.trim();
  if (!uri.startsWith("at://") || uri.length > 2048) return null;
  const segments = uri.slice("at://".length).split("/");
  if (
    segments.length !== 3 || segments[0] !== ownerDid ||
    segments[1] !== HOST_SERVICE_NSID
  ) {
    return null;
  }
  const host = normalizeServiceRefHost(segments[2]);
  return host ? { uri, host } : null;
}

function normalizeServiceRefHost(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253) return null;
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(host)
  ) {
    return null;
  }
  return host;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInvalidSwapError(value: unknown): value is PdsRecordWriteError {
  if (
    !(value instanceof PdsRecordWriteError) || value.operation !== "putRecord"
  ) {
    return false;
  }
  try {
    const parsed = JSON.parse(value.body || "null") as
      | { error?: unknown }
      | null;
    return parsed?.error === "InvalidSwap";
  } catch {
    return false;
  }
}

export function mergeHostProfileRecordForTest(
  existing: unknown,
  ownerDid: string,
  input: HostRecordInput,
  serviceRecordUri: string,
): Record<string, unknown> {
  return mergeHostProfileRecord(existing, ownerDid, input, serviceRecordUri);
}

export async function publishHostProfileRecordWithIoForTest(
  user: { did: string },
  pdsUrl: string,
  input: HostRecordInput,
  serviceRecordUri: string,
  io: HostProfileRecordIo,
): Promise<PutRecordResult> {
  return await publishHostProfileRecordWithIo(
    user,
    pdsUrl,
    input,
    serviceRecordUri,
    io,
  );
}

export async function publishHostRecords(
  user: { did: string },
  pdsUrl: string,
  input: HostRecordInput,
): Promise<HostRecordPublishResult> {
  const service = await publishHostServiceRecord(user, pdsUrl, input);
  const profile = await publishHostProfileRecord(
    user,
    pdsUrl,
    input,
    service.uri,
  );
  return { service, profile };
}

export function hostLinks(
  homepageUrl: string,
  supportUrl: string,
): Array<Record<string, string>> | undefined {
  const links: Array<Record<string, string>> = [];
  if (homepageUrl) {
    links.push({ role: HOST_LINK_ROLE_HOMEPAGE, url: homepageUrl });
  }
  if (supportUrl) {
    links.push({ role: HOST_LINK_ROLE_SUPPORT, url: supportUrl });
  }
  return links.length > 0 ? links : undefined;
}

function dataLocationRegions(
  value: string | null | undefined,
): string[] | undefined {
  const text = value?.trim().replace(/\s+/g, " ").slice(0, 120);
  return text ? [text] : undefined;
}

export function hostServiceCapabilities(
  accountManagementUrl: string | null,
  supportUrl: string,
): Array<Record<string, string>> {
  const accountUrl = accountManagementUrl ?? undefined;
  const supportTarget = supportUrl || accountUrl;
  return [
    hostCapability(
      HOST_CAPABILITY_DASHBOARD,
      accountUrl ? HOST_CAPABILITY_EXTERNAL : HOST_CAPABILITY_PLANNED,
      accountUrl,
    ),
    hostCapability(
      HOST_CAPABILITY_OAUTH_GRANTS,
      HOST_CAPABILITY_PLANNED,
    ),
    hostCapability(
      HOST_CAPABILITY_ACTIVE_SESSIONS,
      HOST_CAPABILITY_PLANNED,
    ),
    hostCapability(
      HOST_CAPABILITY_PASSWORD,
      HOST_CAPABILITY_PLANNED,
    ),
    hostCapability(
      HOST_CAPABILITY_ACCOUNT_DELETION,
      HOST_CAPABILITY_PLANNED,
    ),
    hostCapability(
      HOST_CAPABILITY_SUPPORT,
      supportTarget ? HOST_CAPABILITY_EXTERNAL : HOST_CAPABILITY_PLANNED,
      supportTarget,
    ),
    hostCapability(HOST_CAPABILITY_REPO_EXPORT, HOST_CAPABILITY_PLANNED),
    hostCapability(HOST_CAPABILITY_BLOB_EXPORT, HOST_CAPABILITY_PLANNED),
    hostCapability(HOST_CAPABILITY_BACKUPS, HOST_CAPABILITY_PLANNED),
    hostCapability(HOST_CAPABILITY_MIGRATION, HOST_CAPABILITY_PLANNED),
  ];
}

function hostCapability(
  id: string,
  status: string,
  url?: string,
): Record<string, string> {
  const capability: Record<string, string> = { id, status };
  if (url) capability.url = url;
  return capability;
}

function textOrUndefined(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function omitEmpty(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue;
    if (Array.isArray(item) && item.length === 0) continue;
    out[key] = item;
  }
  return out;
}
