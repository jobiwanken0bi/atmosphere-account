import { define } from "../../../utils.ts";
import {
  listPublicAccountHosts,
  proxyAppviewResponse,
} from "../../../lib/appview-client.ts";
import {
  type AccountHostDirectoryOptions,
  type AccountHostDirectoryResult,
  type AccountHostSort,
  DEFAULT_ACCOUNT_HOST_SORT,
  type HostSignupStatus,
  type HostVerificationStatus,
} from "../../../lib/account-hosts.ts";
import { EdgeStaleCache } from "../../../lib/edge-cache.ts";
import { withRateLimit } from "../../../lib/rate-limit.ts";

const hostDirectoryCache = new EdgeStaleCache<AccountHostDirectoryResult>({
  freshMs: 30_000,
  staleMs: 2 * 60_000,
  maxEntries: 128,
});

export const handler = define.handlers({
  GET: withRateLimit(async (ctx): Promise<Response> => {
    const proxied = await proxyAppviewResponse(
      `${ctx.url.pathname}${ctx.url.search}`,
      ctx.url,
      ctx.req.headers,
    );
    if (proxied) return proxied;
    if (!validDirectorySearch(ctx.url.searchParams)) {
      return json({ error: "invalid_directory_search" }, {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    const input = readDirectoryInput(ctx.url.searchParams);
    const hosts = await hostDirectoryCache.get(
      hostDirectoryCacheKey(input),
      () => listPublicAccountHosts(input),
    );
    return json(hosts, {
      headers: hostDirectorySuccessHeaders(),
    });
  }, {
    scope: "appview-host-directory",
    capacity: 120,
    refillMs: 60_000,
  }),
});

function hostDirectorySuccessHeaders(): HeadersInit {
  // The result is public-only and its full filter/page tuple is part of the
  // cache key. Keep browsers on revalidation while allowing the edge/shared
  // cache to absorb short bursts and serve stale during a bounded refresh.
  return {
    "cache-control":
      "public, max-age=0, s-maxage=30, stale-while-revalidate=120",
  };
}

export function hostDirectorySuccessHeadersForTest(): Headers {
  return new Headers(hostDirectorySuccessHeaders());
}

function validDirectorySearch(search: URLSearchParams): boolean {
  const queries = search.getAll("q");
  if (queries.length > 1 || (queries[0]?.length ?? 0) > 128) return false;
  if (search.getAll("signup").length > 4) return false;
  for (const name of ["page", "pageSize"] as const) {
    const values = search.getAll(name);
    if (values.length > 1 || values.some((value) => !/^\d{1,6}$/.test(value))) {
      return false;
    }
  }
  return true;
}

export function validHostDirectorySearchForTest(
  search: URLSearchParams,
): boolean {
  return validDirectorySearch(search);
}

export function hostDirectoryCacheKey(
  input: AccountHostDirectoryOptions,
): string {
  return JSON.stringify({
    q: input.query?.trim().toLowerCase() ?? "",
    includeApps: input.includeLinkedApps === true,
    sort: input.sort ?? DEFAULT_ACCOUNT_HOST_SORT,
    signup: [...new Set(input.signupStatuses ?? [])].sort(),
    signupStatus: input.signupStatus ?? "all",
    verification: input.verificationStatus ?? "all",
    hasSignupUrl: input.hasSignupUrl === true,
    trusted: input.trustedOnly === true,
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 24,
  });
}

function readDirectoryInput(search: URLSearchParams) {
  const signupStatuses = search.getAll("signup")
    .map(readSignupStatus)
    .filter((status): status is HostSignupStatus => status !== "all");
  return {
    query: search.get("q")?.trim() ?? "",
    includeLinkedApps: search.get("includeApps") === "1",
    sort: readSort(search.get("sort")),
    signupStatus: signupStatuses.length <= 1
      ? (signupStatuses[0] ?? "all")
      : "all" as const,
    signupStatuses: signupStatuses.length > 1 ? signupStatuses : undefined,
    verificationStatus: readVerificationStatus(search.get("verification")),
    hasSignupUrl: search.get("hasSignupUrl") === "1",
    trustedOnly: search.get("trusted") === "1",
    page: readPositiveInteger(search.get("page"), 1),
    pageSize: readPositiveInteger(search.get("pageSize"), 24, 72),
  };
}

function readPositiveInteger(
  value: string | null,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

function readSort(value: string | null): AccountHostSort {
  if (value === "active") return "accounts";
  return value === "accounts" || value === "name" || value === "recent"
    ? value
    : DEFAULT_ACCOUNT_HOST_SORT;
}

function readSignupStatus(
  value: string | null,
): HostSignupStatus | "all" {
  return value === "open" || value === "invite_required" ? value : "all";
}

function readVerificationStatus(
  value: string | null,
): HostVerificationStatus | "all" {
  return value === "verified" || value === "claimed" || value === "observed"
    ? value
    : "all";
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}
