import {
  type AccountHost,
  type HostSignupStatus,
  isAccountHostPubliclyListable,
  normalizeAccountHostPublicHttpsUrl,
} from "./account-hosts.ts";
import { listHostsFromAppview } from "./appview-client.ts";
import {
  type LoginApp,
  resolveVerifiedPreferredAccountHost,
} from "./atmosphere-login.ts";

export interface CreateAccountHostOption {
  name: string;
  host: string;
  href: string;
  description: string;
  location: string | null;
  avatarUrl: string | null;
  signupStatus: "open" | "invite_required";
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
  const includeOpen = options.includeOpen !== false;
  const includeInvite = options.includeInvite !== false;
  const signupStatuses: HostSignupStatus[] = [];
  if (includeOpen) signupStatuses.push("open");
  if (includeInvite) signupStatuses.push("invite_required");
  if (signupStatuses.length === 0) return [];

  const query = options.query?.trim() ?? "";
  const [result, preferred] = await Promise.all([
    listHostsFromAppview({
      query,
      signupStatuses,
      hasSignupUrl: true,
      trustedOnly: true,
      sort: "recommended",
      page: 1,
      pageSize: Math.min(72, Math.max(1, options.pageSize ?? 72)),
    }),
    options.app
      ? resolveVerifiedPreferredAccountHost(options.app).catch(() => null)
      : Promise.resolve(null),
  ]);

  const preferredMatches = preferred &&
    signupStatuses.includes(preferred.signupStatus) &&
    hostMatchesQuery(preferred, query);
  const source = preferredMatches ? [preferred, ...result.hosts] : result.hosts;
  const seen = new Set<string>();
  return source.flatMap((host) => {
    const signupUrl = normalizeAccountHostPublicHttpsUrl(host.signupUrl);
    if (
      seen.has(host.host) || !signupUrl ||
      (host.signupStatus !== "open" &&
        host.signupStatus !== "invite_required") ||
      !isCreateAccountHostEligible(host)
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
        signupStatus: host.signupStatus,
        statusLabel: host.signupStatus === "open" ? "Open" : "Invite accepted",
        recommended,
        recommendationLabel: recommended && options.app
          ? `Recommended by ${options.app.appName}`
          : null,
      } satisfies CreateAccountHostOption,
    ];
  });
}

export function isCreateAccountHostEligible(
  host: AccountHost,
  at = Date.now(),
): boolean {
  const trusted = host.verificationStatus === "claimed" ||
    host.verificationStatus === "verified" || host.source === "seeded";
  const joinable = host.signupStatus === "open" ||
    host.signupStatus === "invite_required";
  return trusted && joinable &&
    normalizeAccountHostPublicHttpsUrl(host.signupUrl) !== null &&
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
