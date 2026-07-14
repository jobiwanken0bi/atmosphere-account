import { define } from "../../../utils.ts";
import {
  listPublicAccountHosts,
  proxyAppviewResponse,
} from "../../../lib/appview-client.ts";
import {
  type AccountHostSort,
  DEFAULT_ACCOUNT_HOST_SORT,
  type HostSignupStatus,
  type HostVerificationStatus,
} from "../../../lib/account-hosts.ts";

export const handler = define.handlers({
  async GET(ctx): Promise<Response> {
    const proxied = await proxyAppviewResponse(
      `${ctx.url.pathname}${ctx.url.search}`,
      ctx.url,
    );
    if (proxied) return proxied;
    const input = readDirectoryInput(ctx.url.searchParams);
    const hosts = await listPublicAccountHosts(input);
    return json(hosts, {
      headers: {
        // Page links must not combine totals from independently cached
        // inventory snapshots.
        "cache-control": "no-store",
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
  return value === "accounts" || value === "active" || value === "name" ||
      value === "recent"
    ? value
    : DEFAULT_ACCOUNT_HOST_SORT;
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
