import {
  type AccountHost,
  isAccountHostPubliclyListable,
  normalizeAccountHostPublicHttpsUrl,
} from "./account-hosts.ts";
import {
  accountCreationServiceEndpoint,
  currentHostOAuthCreationEvidence,
  type HostOAuthCreationEvidence,
  isAccountCreationDiscoveryCandidate,
  loadHostOAuthCreationEvidence,
} from "./host-oauth-creation.ts";
import {
  createAccountHostsFromAppview,
  listHostsFromAppview,
} from "./appview-client.ts";
import {
  type LoginApp,
  resolveVerifiedPreferredAccountHost,
} from "./atmosphere-login.ts";

export const HOST_CAPABILITY_OAUTH_ACCOUNT_CREATION =
  "account.atmosphere.host.defs#capabilityOAuthAccountCreation";
const HOST_CAPABILITY_SUPPORTED =
  "account.atmosphere.host.defs#capabilitySupported";
const HOST_CAPABILITY_EXTERNAL =
  "account.atmosphere.host.defs#capabilityExternal";

export interface CreateAccountHostOption {
  name: string;
  host: string;
  href: string;
  description: string;
  location: string | null;
  avatarUrl: string | null;
  signupStatus: "open" | "invite_required";
  oauthAccountCreation: boolean;
  statusLabel: string;
  recommended: boolean;
  recommendationLabel: string | null;
}

interface ListCreateAccountHostOptions {
  query?: string;
  includeOpen?: boolean;
  includeInvite?: boolean;
  app?: LoginApp | null;
  pageSize?: number;
}

export async function listCreateAccountHostOptions(
  options: ListCreateAccountHostOptions = {},
): Promise<CreateAccountHostOption[]> {
  const remote = await createAccountHostsFromAppview({
    query: options.query,
    includeOpen: options.includeOpen,
    includeInvite: options.includeInvite,
    clientId: options.app?.clientId,
  });
  if (remote) {
    return remote.slice(0, Math.min(72, Math.max(1, options.pageSize ?? 72)));
  }
  const includeOpen = options.includeOpen !== false;
  const includeInvite = options.includeInvite !== false;
  const signupStatuses: ("open" | "invite_required")[] = [];
  if (includeOpen) signupStatuses.push("open");
  if (includeInvite) signupStatuses.push("invite_required");
  if (signupStatuses.length === 0) return [];

  const query = options.query?.trim() ?? "";
  const [result, preferred] = await Promise.all([
    loadDirectoryCandidates(query),
    options.app
      ? resolveVerifiedPreferredAccountHost(options.app).catch(() => null)
      : Promise.resolve(null),
  ]);

  const preferredMatches = preferred &&
    hostMatchesQuery(preferred, query);
  const source = preferredMatches ? [preferred, ...result] : result;
  const evidence = await loadHostOAuthCreationEvidence(source);
  const at = Date.now();
  const seen = new Set<string>();
  return source.flatMap((host) => {
    const detected = currentHostOAuthCreationEvidence(
      host,
      evidence.get(host.host),
      at,
    );
    const signupStatus = host.signupStatus === "unknown"
      ? detected?.signupStatus
      : host.signupStatus;
    const signupUrl = normalizeAccountHostPublicHttpsUrl(host.signupUrl) ??
      accountCreationServiceEndpoint(host);
    const oauthAccountCreation = detected !== null;
    if (
      seen.has(host.host) || !signupUrl ||
      (signupStatus !== "open" && signupStatus !== "invite_required") ||
      !signupStatuses.includes(signupStatus) ||
      !oauthAccountCreation ||
      !isCreateAccountHostEligible(host, at, detected ?? undefined)
    ) {
      return [];
    }
    seen.add(host.host);
    const recommended = preferred?.host === host.host;
    return [
      {
        name: host.displayName,
        host: host.host,
        href: signupUrl,
        description: host.description || `Create an account with ${host.host}.`,
        location: host.dataLocation ?? host.inferredLocation,
        avatarUrl: host.avatarUrl,
        signupStatus,
        oauthAccountCreation,
        statusLabel: signupStatus === "open"
          ? "Open signup"
          : "Invite required",
        recommended,
        recommendationLabel: recommended && options.app
          ? `Recommended by ${options.app.appName}`
          : null,
      } satisfies CreateAccountHostOption,
    ];
  }).slice(0, Math.min(72, Math.max(1, options.pageSize ?? 72)));
}

export async function loadDirectoryCandidates(
  query: string,
  load = listHostsFromAppview,
): Promise<AccountHost[]> {
  const hosts: AccountHost[] = [];
  for (let page = 1; page <= Math.ceil(1000 / 72); page++) {
    const result = await load({
      query,
      sort: "recommended",
      page,
      pageSize: 72,
    });
    hosts.push(...result.hosts);
    if (page * Math.max(1, result.pageSize) >= result.total) break;
  }
  return hosts.slice(0, 1000).filter((host) =>
    isAccountCreationDiscoveryCandidate(host)
  );
}

export function supportsOAuthAccountCreation(host: AccountHost): boolean {
  if (!host.serviceEndpoint || !host.capabilitiesJson) return false;
  try {
    const capabilities = JSON.parse(host.capabilitiesJson);
    if (!Array.isArray(capabilities)) return false;
    return capabilities.some((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
      }
      const capability = value as Record<string, unknown>;
      return capability.id === HOST_CAPABILITY_OAUTH_ACCOUNT_CREATION &&
        (capability.status === HOST_CAPABILITY_SUPPORTED ||
          capability.status === HOST_CAPABILITY_EXTERNAL);
    });
  } catch {
    return false;
  }
}

export function isCreateAccountHostEligible(
  host: AccountHost,
  at = Date.now(),
  evidence?: HostOAuthCreationEvidence,
): boolean {
  const detected = currentHostOAuthCreationEvidence(host, evidence, at);
  const signupStatus = host.signupStatus === "unknown"
    ? detected?.signupStatus
    : host.signupStatus;
  return detected !== null &&
    (signupStatus === "open" || signupStatus === "invite_required") &&
    isAccountHostPubliclyListable(host, at);
}

function hostMatchesQuery(host: AccountHost, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    host.displayName,
    host.host,
    host.description,
    host.dataLocation ?? "",
    host.inferredLocation ?? "",
  ].some((value) => value.toLowerCase().includes(needle));
}
