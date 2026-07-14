import {
  type AccountHost,
  type AccountHostClaim,
  type AccountHostDirectoryOptions,
  type AccountHostDirectoryResult,
  DEFAULT_ACCOUNT_HOST_SORT,
  getAccountHost,
  getAccountHostClaim,
  hydrateAccountHostProfiles,
  isAccountHostPubliclyListable,
  listAccountHostDirectory,
  listSeededAccountHostFallback,
  sortAccountHostsForDirectory,
} from "./account-hosts.ts";
import {
  type AppDirectorySort,
  type AppSearchResult,
  searchAppDirectory,
} from "./app-directory.ts";
import { define } from "../utils.ts";
import { trustedAtmosphereOrigins } from "./atmosphere-origins.ts";
import {
  createProxyClientKey,
  PROXY_CLIENT_KEY_HEADER,
} from "./proxy-client-key.ts";

const APPVIEW_BASE_URL = Deno.env.get("ATMOSPHERE_APPVIEW_URL")?.trim() ||
  Deno.env.get("APPVIEW_BASE_URL")?.trim() ||
  "";

const DEFAULT_APPVIEW_FETCH_TIMEOUT_MS = 5000;
const MIN_APPVIEW_FETCH_TIMEOUT_MS = 1000;
const MAX_APPVIEW_HANDOFF_BODY_BYTES = 64 * 1024;
const APPVIEW_ASSET_PROXY_PREFIX = "/_appview/assets/";
const APPVIEW_ASSET_SOURCE_PREFIX = "/assets/";

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

export const appviewAssetProxyMiddleware = define.middleware(
  async (ctx) => {
    if (!shouldProxyAppviewAsset(ctx.url)) {
      return await ctx.next();
    }

    const proxied = await proxyAppviewPageResponse(
      appviewAssetSourceUrl(ctx.url),
      ctx.req,
    ).catch(
      (err) => {
        console.error("[appview] asset proxy failed:", err);
        return appviewEarlyProxyUnavailable(ctx.url.pathname);
      },
    );
    if (proxied) {
      proxied.headers.set("x-atmosphere-appview-asset-proxy", "1");
      return proxied;
    }
    return await ctx.next();
  },
);

export const appviewEarlyProxyMiddleware = define.middleware(async (ctx) => {
  if (!shouldProxyAppviewBeforeSession(ctx.url.pathname)) {
    return await ctx.next();
  }

  const proxied = await (
    ctx.url.pathname.startsWith("/api/")
      ? proxyAppviewApiResponse(ctx.url, ctx.req)
      : proxyAppviewPageResponse(ctx.url, ctx.req)
  ).catch((err) => {
    if (err instanceof AppviewProxyBodyTooLargeError) {
      return new Response("request body too large", {
        status: 413,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }
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
    pathname === "/api/login/selection" ||
    pathname === "/api/login/account-hosts" ||
    pathname === "/api/registry" || pathname.startsWith("/api/registry/") ||
    pathname === "/api/appview" || pathname.startsWith("/api/appview/") ||
    pathname === "/api/atproto/blob" ||
    pathname === "/api/identity/preview" ||
    pathname === "/api/me/avatar";
}

function shouldProxyAppviewAsset(
  url: URL,
  trustedOrigins = trustedAtmosphereOrigins(),
): boolean {
  return isGeneratedAppviewAssetPath(url.pathname) &&
    trustedOrigins.includes(url.origin.replace(/\/$/, ""));
}

function isGeneratedAppviewAssetPath(pathname: string): boolean {
  return pathname.startsWith(APPVIEW_ASSET_PROXY_PREFIX);
}

export function isGeneratedAppviewAssetPathForTest(pathname: string): boolean {
  return isGeneratedAppviewAssetPath(pathname);
}

export function shouldProxyAppviewAssetForTest(
  url: URL,
  trustedOrigins?: string[],
): boolean {
  return shouldProxyAppviewAsset(url, trustedOrigins);
}

function appviewAssetSourceUrl(url: URL): URL {
  const source = new URL(url);
  source.pathname = `${APPVIEW_ASSET_SOURCE_PREFIX}${
    url.pathname.slice(APPVIEW_ASSET_PROXY_PREFIX.length)
  }`;
  return source;
}

export function appviewAssetSourceUrlForTest(url: URL): URL {
  return appviewAssetSourceUrl(url);
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

export async function listHostsFromAppview(
  input: AccountHostDirectoryOptions = {},
): Promise<AccountHostDirectoryResult> {
  const publicInput = { ...input, publicOnly: true };
  const remote = appviewBaseUrl();
  if (remote) {
    const params = new URLSearchParams();
    if (input.query) params.set("q", input.query);
    if (input.sort) params.set("sort", input.sort);
    if (input.signupStatus && input.signupStatus !== "all") {
      params.set("signup", input.signupStatus);
    }
    for (const status of input.signupStatuses ?? []) {
      params.append("signup", status);
    }
    if (input.verificationStatus && input.verificationStatus !== "all") {
      params.set("verification", input.verificationStatus);
    }
    if (input.hasSignupUrl) params.set("hasSignupUrl", "1");
    if (input.trustedOnly) params.set("trusted", "1");
    if (input.page) params.set("page", String(input.page));
    if (input.pageSize) params.set("pageSize", String(input.pageSize));
    const qs = params.toString();
    const payload = await fetchAppviewJson<unknown>(
      remote,
      `/api/appview/hosts${qs ? `?${qs}` : ""}`,
    );
    if (Array.isArray(payload)) {
      // Keep rolling deployments compatible with the pre-pagination appview,
      // which returned the host array directly.
      return hostDirectoryResultForHosts(
        publicInput,
        payload as AccountHost[],
      );
    }
    const result = payload as AccountHostDirectoryResult;
    return {
      ...result,
      hosts: result.hosts.filter((host) => isAccountHostPubliclyListable(host)),
    };
  }
  return await listPublicAccountHosts(publicInput);
}

export async function getHostDetailFromAppview(
  host: string,
): Promise<PublicHostDetail> {
  const remote = appviewBaseUrl();
  if (remote) {
    const detail = await fetchAppviewJson<PublicHostDetail>(
      remote,
      `/api/appview/hosts/${encodeURIComponent(host)}`,
    );
    return detail.host && !isAccountHostPubliclyListable(detail.host)
      ? { host: null, claim: null }
      : detail;
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
  const requestBody = await appviewProxyRequestBody(
    currentUrl,
    request,
    bodyless,
  );

  const res = await fetch(url, {
    method: request.method,
    headers: await appviewPageHeaders(
      request.headers,
      currentUrl,
      bodyless,
    ),
    body: requestBody,
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
  const bodyless = request.method === "GET" || request.method === "HEAD";
  const requestBody = await appviewProxyRequestBody(
    currentUrl,
    request,
    bodyless,
  );

  const res = await fetch(url, {
    method: request.method,
    headers: await appviewRequestHeaders(request.headers, currentUrl),
    body: requestBody,
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

class AppviewProxyBodyTooLargeError extends Error {}

function shouldBufferAppviewRequestBody(pathname: string): boolean {
  return pathname === "/login/select" || pathname === "/oauth/switch";
}

async function appviewProxyRequestBody(
  currentUrl: URL,
  request: Request,
  bodyless: boolean,
): Promise<BodyInit | undefined> {
  if (bodyless) return undefined;
  if (!shouldBufferAppviewRequestBody(currentUrl.pathname)) {
    return request.body ?? undefined;
  }
  if (request.headers.get("x-atmosphere-login-bodyless") === "1") {
    return undefined;
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_APPVIEW_HANDOFF_BODY_BYTES
  ) {
    throw new AppviewProxyBodyTooLargeError();
  }
  if (!request.body) return undefined;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_APPVIEW_HANDOFF_BODY_BYTES) {
      await reader.cancel();
      throw new AppviewProxyBodyTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function shouldBufferAppviewRequestBodyForTest(
  pathname: string,
): boolean {
  return shouldBufferAppviewRequestBody(pathname);
}

export async function appviewProxyRequestBodyForTest(
  currentUrl: URL,
  request: Request,
): Promise<BodyInit | undefined> {
  const bodyless = request.method === "GET" || request.method === "HEAD";
  return await appviewProxyRequestBody(currentUrl, request, bodyless);
}

export async function listPublicAccountHosts(
  input: AccountHostDirectoryOptions = {},
): Promise<AccountHostDirectoryResult> {
  const publicInput = { ...input, publicOnly: true };
  const result = await listAccountHostDirectory(publicInput).catch((err) => {
    console.warn("[appview] list account hosts failed:", err);
    return hostDirectoryResultForHosts(publicInput, []);
  });
  let visibleHosts = result.hosts;
  if (visibleHosts.length > 0) {
    visibleHosts = await hydrateAccountHostProfiles(visibleHosts).catch(
      (err) => {
        console.warn("[appview] hydrate account host profiles failed:", err);
        return visibleHosts;
      },
    );
  }
  // Keep the SQL projection cheap, then enforce the full URL/reachability
  // policy on hydrated rows as a defense against unsafe legacy signup URLs.
  visibleHosts = visibleHosts.filter((host) =>
    isAccountHostPubliclyListable(host, publicInput.now)
  );
  return { ...result, hosts: visibleHosts };
}

export function hostDirectoryResultForHosts(
  input: AccountHostDirectoryOptions,
  sourceHosts: AccountHost[],
): AccountHostDirectoryResult {
  const sort = input.sort ?? DEFAULT_ACCOUNT_HOST_SORT;
  const pageSize = positiveDirectoryInteger(input.pageSize, 24, 200);
  const query = input.query?.trim().toLowerCase() ?? "";
  const filteredHosts = sourceHosts.filter((host) => {
    if (input.publicOnly && !isAccountHostPubliclyListable(host, input.now)) {
      return false;
    }
    if (input.hasSignupUrl && !host.signupUrl) return false;
    if (
      input.trustedOnly && host.verificationStatus !== "claimed" &&
      host.verificationStatus !== "verified" && host.source !== "seeded"
    ) return false;
    if (input.signupStatuses?.length) {
      if (!input.signupStatuses.includes(host.signupStatus)) return false;
    } else if (
      input.signupStatus && input.signupStatus !== "all" &&
      host.signupStatus !== input.signupStatus
    ) return false;
    if (
      input.verificationStatus && input.verificationStatus !== "all" &&
      host.verificationStatus !== input.verificationStatus
    ) return false;
    if (!query) return true;
    return [
      host.host,
      host.displayName,
      host.description,
      host.profileHandle ?? "",
      host.dataLocation ?? "",
      host.inferredLocation ?? "",
    ].some((value) => value.toLowerCase().includes(query));
  });
  const hosts = sortAccountHostsForDirectory(filteredHosts, sort);
  const total = hosts.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(
    pageCount,
    positiveDirectoryInteger(input.page, 1),
  );
  return {
    hosts: hosts.slice((page - 1) * pageSize, page * pageSize),
    total,
    page,
    pageSize,
    sort,
  };
}

function positiveDirectoryInteger(
  value: number | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isFinite(value) || value == null) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

export async function getPublicHostDetail(
  hostId: string,
): Promise<PublicHostDetail> {
  let host = await getAccountHost(hostId).catch(() => null);
  if (host && !isAccountHostPubliclyListable(host)) host = null;
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

export function seededHostDetailFallback(hostId: string): AccountHost | null {
  const normalized = hostId.trim().toLowerCase();
  if (!normalized) return null;
  return listSeededAccountHostFallback().find((host) =>
    host.host === normalized
  ) ?? null;
}

async function appviewPageHeaders(
  requestHeaders: Headers,
  currentUrl: URL,
  bodyless: boolean,
): Promise<Headers> {
  const headers = await appviewRequestHeaders(requestHeaders, currentUrl);
  if (bodyless) headers.delete("content-type");
  return headers;
}

async function appviewRequestHeaders(
  requestHeaders: Headers,
  currentUrl: URL,
): Promise<Headers> {
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
      "x-atmosphere-login-bodyless",
    ]
  ) {
    const value = requestHeaders.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-forwarded-host", currentUrl.host);
  headers.set("x-forwarded-proto", currentUrl.protocol.replace(":", ""));
  headers.set("x-atmosphere-public-origin", currentUrl.origin);
  headers.set(
    PROXY_CLIENT_KEY_HEADER,
    await createProxyClientKey(requestHeaders),
  );
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
): Promise<Headers> {
  return appviewRequestHeaders(requestHeaders, currentUrl);
}

function rewriteAppviewHtml(
  body: string,
  remote: string,
  currentUrl: URL,
): string {
  const remoteBase = appviewBaseUrlForRewrite(remote);
  return body
    .replaceAll(
      `${remoteBase}${APPVIEW_ASSET_SOURCE_PREFIX}`,
      `${currentUrl.origin}${APPVIEW_ASSET_PROXY_PREFIX}`,
    )
    .replaceAll(remoteBase, currentUrl.origin)
    .replaceAll(
      /(["'(=])\/assets\//g,
      `$1${APPVIEW_ASSET_PROXY_PREFIX}`,
    );
}

export function rewriteAppviewHtmlForTest(
  body: string,
  remote: string,
  currentUrl: URL,
): string {
  return rewriteAppviewHtml(body, remote, currentUrl);
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
