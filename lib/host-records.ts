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
import { putRecord, type PutRecordResult } from "./pds.ts";

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

export function hostServiceRkey(host: string): string {
  return host.trim().toLowerCase();
}

export function buildHostServiceRecord(
  input: HostRecordInput,
): Record<string, unknown> {
  const host = hostServiceRkey(input.host);
  const homepageUrl = normalizeAccountHostPublicHttpsUrl(input.homepageUrl);
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
      url: homepageUrl || undefined,
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
  return await putRecord(
    user.did,
    pdsUrl,
    HOST_PROFILE_NSID,
    "self",
    buildHostProfileRecord(input, serviceRecordUri),
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
