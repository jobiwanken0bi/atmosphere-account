import {
  type AccountHost,
  type AccountHostClaim,
  getAccountHost,
  getAccountHostClaim,
  hydrateAccountHostProfiles,
  listAccountHosts,
  listSeededAccountHostFallback,
} from "./account-hosts.ts";
import {
  type AppDirectorySort,
  type AppSearchResult,
  searchAppDirectory,
} from "./app-directory.ts";
import { define } from "../utils.ts";

const APPVIEW_BASE_URL = Deno.env.get("ATMOSPHERE_APPVIEW_URL")?.trim() ||
  Deno.env.get("APPVIEW_BASE_URL")?.trim() ||
  "";

const DEFAULT_APPVIEW_FETCH_TIMEOUT_MS = 5000;
const MIN_APPVIEW_FETCH_TIMEOUT_MS = 1000;

const APPVIEW_FETCH_TIMEOUT_MS = appviewFetchTimeoutMs(
  Deno.env.get("APPVIEW_FETCH_TIMEOUT_MS"),
);

export function appviewFetchTimeoutMs(
  value: string | null | undefined,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_APPVIEW_FETCH_TIMEOUT_MS;
  }
  return Math.max(MIN_APPVIEW_FETCH_TIMEOUT_MS, parsed);
}

export interface PublicHostDetail {
  host: AccountHost | null;
  claim: AccountHostClaim | null;
}

export const appviewEarlyProxyMiddleware = define.middleware(async (ctx) => {
  if (!shouldProxyAppviewBeforeSession(ctx.url.pathname)) {
    return await ctx.next();
  }

  const proxied = await (
    ctx.url.pathname.startsWith("/api/")
      ? proxyAppviewApiResponse(ctx.url, ctx.req)
      : proxyAppviewPageResponse(ctx.url, ctx.req)
  ).catch((err) => {
    console.error("[appview] early proxy failed:", err);
    return appviewEarlyProxyUnavailable(ctx.url.pathname);
  });
  if (proxied) {
    proxied.headers.set("x-atmosphere-appview-early-proxy", "1");
    return proxied;
  }
  return await ctx.next();
});

export function shouldProxyAppviewBeforeSession(pathname: string): boolean {
  if (isEdgeOwnedOauthDocument(pathname)) return false;
  if (isEdgeRenderedPublicDirectory(pathname)) return false;
  return pathname === "/apps" || pathname.startsWith("/apps/") ||
    pathname === "/hosts" || pathname.startsWith("/hosts/") ||
    pathname === "/account" || pathname.startsWith("/account/") ||
    pathname === "/admin" || pathname.startsWith("/admin/") ||
    pathname === "/users" || pathname.startsWith("/users/") ||
    pathname === "/login/select" ||
    pathname === "/oauth" || pathname.startsWith("/oauth/") ||
    pathname === "/api/apps" || pathname.startsWith("/api/apps/") ||
    pathname === "/api/hosts" || pathname.startsWith("/api/hosts/") ||
    pathname === "/api/account" || pathname.startsWith("/api/account/") ||
    pathname === "/api/admin" || pathname.startsWith("/api/admin/") ||
    pathname === "/api/registry" || pathname.startsWith("/api/registry/") ||
    pathname === "/api/appview" || pathname.startsWith("/api/appview/") ||
    pathname === "/api/atproto/blob" ||
    pathname === "/api/identity/preview" ||
    pathname === "/api/me/avatar";
}

function isEdgeOwnedOauthDocument(pathname: string): boolean {
  return pathname === "/oauth/client-metadata.json" ||
    pathname === "/oauth/jwks.json";
}

function isEdgeRenderedPublicDirectory(pathname: string): boolean {
  return pathname === "/apps" ||
    pathname === "/apps/all" ||
    pathname === "/apps/categories" ||
    pathname === "/hosts";
}

function appviewEarlyProxyUnavailable(pathname: string): Response {
  const isApi = pathname.startsWith("/api/");
  return new Response(
    isApi
      ? JSON.stringify({ error: "appview_unavailable" })
      : "This page is temporarily unavailable.",
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": isApi
          ? "application/json; charset=utf-8"
          : "text/plain; charset=utf-8",
      },
    },
  );
}

export function appviewBaseUrl(): string | null {
  return APPVIEW_BASE_URL ? APPVIEW_BASE_URL.replace(/\/+$/, "") : null;
}

export async function loadAppsHomeFromAppview(): Promise<AppSearchResult> {
  const remote = appviewBaseUrl();
  if (remote) {
    return await fetchAppviewJson<AppSearchResult>(
      remote,
      "/api/appview/apps/home",
    );
  }
  return await searchAppDirectory({
    includeSections: true,
    includeApps: false,
    includeTotal: false,
    syncLegacy: false,
  });
}

export async function searchAppsFromAppview(input: {
  query?: string;
  tag?: string[];
  sort: AppDirectorySort;
  page: number;
}): Promise<AppSearchResult> {
  const remote = appviewBaseUrl();
  if (remote) {
    const params = new URLSearchParams();
    if (input.query) params.set("q", input.query);
    for (const tag of input.tag ?? []) params.append("tag", tag);
    params.set("sort", input.sort);
    params.set("page", String(input.page));
    return await fetchAppviewJson<AppSearchResult>(
      remote,
      `/api/appview/apps/search?${params.toString()}`,
    );
  }
  return await searchAppDirectory({
    query: input.query || undefined,
    tag: input.tag && input.tag.length > 0 ? input.tag : undefined,
    sort: input.sort,
    page: input.page,
    includeSections: false,
    syncLegacy: false,
  });
}

export async function listHostsFromAppview(input: {
  query?: string;
} = {}): Promise<AccountHost[]> {
  const remote = appviewBaseUrl();
  if (remote) {
    const params = new URLSearchParams();
    if (input.query) params.set("q", input.query);
    const qs = params.toString();
    return await fetchAppviewJson<AccountHost[]>(
      remote,
      `/api/appview/hosts${qs ? `?${qs}` : ""}`,
    );
  }
  return await listPublicAccountHosts(input);
}

export async function getHostDetailFromAppview(
  host: string,
): Promise<PublicHostDetail> {
  const remote = appviewBaseUrl();
  if (remote) {
    return await fetchAppviewJson<PublicHostDetail>(
      remote,
      `/api/appview/hosts/${encodeURIComponent(host)}`,
    );
  }
  return await getPublicHostDetail(host);
}

export async function proxyAppviewResponse(
  pathWithSearch: string,
  currentUrl?: URL,
): Promise<Response | null> {
  const remote = appviewBaseUrl();
  if (!remote) return null;
  const url = new URL(pathWithSearch, remote);
  if (currentUrl && url.origin === currentUrl.origin) return null;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(APPVIEW_FETCH_TIMEOUT_MS),
  });
  const headers = proxiedHeaders(res.headers, { page: false });
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export async function proxyAppviewPageResponse(
  currentUrl: URL,
  request: Request,
): Promise<Response | null> {
  const remote = appviewBaseUrl();
  if (!remote) return null;
  const url = new URL(`${currentUrl.pathname}${currentUrl.search}`, remote);
  if (url.origin === currentUrl.origin) return null;
  const bodyless = request.method === "GET" || request.method === "HEAD";

  const res = await fetch(url, {
    method: request.method,
    headers: appviewPageHeaders(request.headers, currentUrl, bodyless),
    body: bodyless ? undefined : request.body,
    redirect: "manual",
    signal: AbortSignal.timeout(APPVIEW_FETCH_TIMEOUT_MS),
  });
  const headers = proxiedHeaders(res.headers, { page: true });

  const location = headers.get("location");
  if (location) {
    headers.set("location", rewriteAppviewUrl(location, remote, currentUrl));
  }

  const contentType = headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  const body = rewriteAppviewHtml(await res.text(), remote, currentUrl);
  headers.delete("content-encoding");
  headers.delete("etag");
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export async function proxyAppviewApiResponse(
  currentUrl: URL,
  request: Request,
): Promise<Response | null> {
  const remote = appviewBaseUrl();
  if (!remote) return null;
  const url = new URL(`${currentUrl.pathname}${currentUrl.search}`, remote);
  if (url.origin === currentUrl.origin) return null;

  const res = await fetch(url, {
    method: request.method,
    headers: appviewRequestHeaders(request.headers, currentUrl),
    body: request.method === "GET" || request.method === "HEAD"
      ? undefined
      : request.body,
    redirect: "manual",
    signal: AbortSignal.timeout(APPVIEW_FETCH_TIMEOUT_MS),
  });
  const headers = proxiedHeaders(res.headers, { page: false });
  const location = headers.get("location");
  if (location) {
    headers.set("location", rewriteAppviewUrl(location, remote, currentUrl));
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export async function listPublicAccountHosts(input: {
  query?: string;
} = {}): Promise<AccountHost[]> {
  const query = input.query?.trim() ?? "";
  const hosts = await listAccountHosts({ query }).catch((err) => {
    console.warn("[appview] list account hosts failed:", err);
    return listSeededAccountHostFallback({ query });
  });
  let visibleHosts = hosts.length === 0 && !query
    ? listSeededAccountHostFallback()
    : hosts;
  if (visibleHosts.length > 0) {
    visibleHosts = await hydrateAccountHostProfiles(visibleHosts).catch(
      (err) => {
        console.warn("[appview] hydrate account host profiles failed:", err);
        return visibleHosts;
      },
    );
  }
  return visibleHosts;
}

export async function getPublicHostDetail(
  hostId: string,
): Promise<PublicHostDetail> {
  let host = await getAccountHost(hostId).catch(() => null);
  if (host) {
    host = (await hydrateAccountHostProfiles([host]).catch((err) => {
      console.warn("[appview] hydrate host profile failed:", err);
      return [host as AccountHost];
    }))[0] ?? host;
  }
  const claim = host
    ? await getAccountHostClaim(host.host).catch(() => null)
    : null;
  return { host, claim };
}

function appviewPageHeaders(
  requestHeaders: Headers,
  currentUrl: URL,
  bodyless: boolean,
): Headers {
  const headers = appviewRequestHeaders(requestHeaders, currentUrl);
  if (bodyless) headers.delete("content-type");
  return headers;
}

function appviewRequestHeaders(
  requestHeaders: Headers,
  currentUrl: URL,
): Headers {
  const headers = new Headers();
  for (
    const name of [
      "accept",
      "accept-language",
      "cookie",
      "content-type",
      "origin",
      "referer",
      "sec-fetch-site",
      "user-agent",
      "x-atmosphere-login",
    ]
  ) {
    const value = requestHeaders.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-forwarded-host", currentUrl.host);
  headers.set("x-forwarded-proto", currentUrl.protocol.replace(":", ""));
  headers.set("x-atmosphere-public-origin", currentUrl.origin);
  return headers;
}

function proxiedHeaders(
  source: Headers,
  options: { page: boolean },
): Headers {
  const headers = new Headers(source);
  headers.set("x-atmosphere-appview-proxy", "1");
  if (options.page) headers.set("x-atmosphere-appview-page-proxy", "1");
  for (const header of HOP_BY_HOP_RESPONSE_HEADERS) {
    headers.delete(header);
  }
  for (const header of INFRA_RESPONSE_HEADERS) {
    headers.delete(header);
  }
  const providerHeaders: string[] = [];
  for (const [header] of headers) {
    const name = header.toLowerCase();
    if (
      PROVIDER_RESPONSE_HEADER_PREFIXES.some((prefix) =>
        name.startsWith(prefix)
      )
    ) {
      providerHeaders.push(header);
    }
  }
  for (const header of providerHeaders) {
    headers.delete(header);
  }
  return headers;
}

const HOP_BY_HOP_RESPONSE_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

const INFRA_RESPONSE_HEADERS = [
  "alt-svc",
  "content-encoding",
  "content-length",
  "etag",
  "server",
];

const PROVIDER_RESPONSE_HEADER_PREFIXES = [
  "x-hikari-",
  "x-railway-",
];

export function proxiedHeadersForTest(
  source: Headers,
  options: { page?: boolean } = {},
): Headers {
  return proxiedHeaders(source, { page: options.page ?? false });
}

export function appviewRequestHeadersForTest(
  requestHeaders: Headers,
  currentUrl: URL,
): Headers {
  return appviewRequestHeaders(requestHeaders, currentUrl);
}

function rewriteAppviewHtml(
  body: string,
  remote: string,
  currentUrl: URL,
): string {
  return body.replaceAll(appviewBaseUrlForRewrite(remote), currentUrl.origin);
}

function rewriteAppviewUrl(
  value: string,
  remote: string,
  currentUrl: URL,
): string {
  const remoteBase = appviewBaseUrlForRewrite(remote);
  if (value.startsWith(remoteBase)) {
    return `${currentUrl.origin}${value.slice(remoteBase.length)}`;
  }
  return value;
}

function appviewBaseUrlForRewrite(remote: string): string {
  return remote.replace(/\/+$/, "");
}

async function fetchAppviewJson<T>(
  baseUrl: string,
  path: string,
): Promise<T> {
  const url = new URL(path, baseUrl);
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(APPVIEW_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`appview request failed: HTTP ${res.status}`);
  }
  return await res.json() as T;
}
