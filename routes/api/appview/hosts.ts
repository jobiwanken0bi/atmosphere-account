import { define } from "../../../utils.ts";
import {
  listPublicAccountHosts,
  proxyAppviewResponse,
} from "../../../lib/appview-client.ts";
import { EdgeStaleCache } from "../../../lib/edge-cache.ts";
import type {
  AccountHostDirectoryResult,
  AccountHostSort,
  HostSignupStatus,
  HostVerificationStatus,
} from "../../../lib/account-hosts.ts";

const hostsCache = new EdgeStaleCache<AccountHostDirectoryResult>({
  freshMs: 60_000,
  staleMs: 5 * 60_000,
  maxEntries: 128,
});

export const handler = define.handlers({
  async GET(ctx): Promise<Response> {
    const proxied = await proxyAppviewResponse(
      `${ctx.url.pathname}${ctx.url.search}`,
      ctx.url,
    );
    if (proxied) return proxied;
    const input = readDirectoryInput(ctx.url.searchParams);
    const hosts = await hostsCache.get(
      JSON.stringify({ ...input, query: input.query.toLowerCase() }),
      () => listPublicAccountHosts(input),
    );
    return json(hosts, {
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  },
});

function readDirectoryInput(search: URLSearchParams) {
  return {
    query: search.get("q")?.trim() ?? "",
    sort: readSort(search.get("sort")),
    signupStatus: readSignupStatus(search.get("signup")),
    verificationStatus: readVerificationStatus(search.get("verification")),
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
  return value === "active" || value === "name" || value === "recent"
    ? value
    : "accounts";
}

function readSignupStatus(
  value: string | null,
): HostSignupStatus | "all" {
  return value === "open" || value === "invite_required" ||
      value === "closed" ||
      value === "unknown"
    ? value
    : "all";
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
