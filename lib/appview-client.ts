import {
  type AccountHost,
  type AccountHostClaim,
  type AccountHostDirectoryOptions,
  type AccountHostDirectoryResult,
  type AccountHostLinkedApp,
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
  getVisibleAppsForAccountHosts,
  searchAppDirectory,
} from "./app-directory.ts";
import { define } from "../utils.ts";
import { trustedAtmosphereOrigins } from "./atmosphere-origins.ts";
import {
  createProxyClientKey,
  PROXY_CLIENT_KEY_HEADER,
} from "./proxy-client-key.ts";
import { legacyHostClaimEdgeResponse } from "./host-claim-legacy.ts";
import { isJsonMediaType, readResponseTextWithLimit } from "./security.ts";
import { safeBrowserNavigationUrl } from "./browser-navigation.ts";
import { isBrowserDocumentRequest } from "./canonical-origin.ts";

const APPVIEW_BASE_URL = Deno.env.get("ATMOSPHERE_APPVIEW_URL")?.trim() ||
  Deno.env.get("APPVIEW_BASE_URL")?.trim() ||
  "";

const DEFAULT_APPVIEW_FETCH_TIMEOUT_MS = 5000;
const MIN_APPVIEW_FETCH_TIMEOUT_MS = 1000;
const HOST_CLAIM_ROUTE_FETCH_TIMEOUT_MS = 20_000;
const MAX_APPVIEW_HANDOFF_BODY_BYTES = 64 * 1024;
const DEFAULT_APPVIEW_REQUEST_BODY_BYTES = 256 * 1024;
const PROFILE_APPVIEW_REQUEST_BODY_BYTES = 36_000_000;
const MAX_APPVIEW_HTML_BYTES = 4 * 1024 * 1024;
const MAX_APPVIEW_JSON_BYTES = 4 * 1024 * 1024;
const APPVIEW_ASSET_PROXY_PREFIX = "/_appview/assets/";
const APPVIEW_ASSET_SOURCE_PREFIX = "/assets/";
const DERIVED_MEDIA_REDIRECT_ORIGINS_ENV = "DERIVED_MEDIA_REDIRECT_ORIGINS";

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

/**
 * Host-claim pages can perform bounded direct handle/DID/contact lookups; writes
 * can additionally include an 8s transactional email delivery or DNS lookup.
 * Keep the ordinary public-shell budget short while allowing the claim route
 * to finish instead of aborting after work may already have taken effect.
 */
export function appviewPageFetchTimeoutMs(
  pathname: string,
  method: string,
  configured = APPVIEW_FETCH_TIMEOUT_MS,
): number {
  const normalizedMethod = method.toUpperCase();
  return (normalizedMethod === "GET" || normalizedMethod === "HEAD" ||
      normalizedMethod === "POST") &&
      /^\/hosts\/[^/]+\/claim$/.test(pathname)
    ? Math.max(configured, HOST_CLAIM_ROUTE_FETCH_TIMEOUT_MS)
    : configured;
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
  const retiredHostClaim = await legacyHostClaimEdgeResponse(ctx.url, ctx.req);
  if (retiredHostClaim) return retiredHostClaim;

  const activeSessionDocument = shouldProxyActiveSessionDocument(
    ctx.url.pathname,
    ctx.req,
  );
  if (
    !shouldProxyAppviewBeforeSession(ctx.url.pathname) &&
    !activeSessionDocument
  ) {
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
    if (activeSessionDocument) {
      proxied.headers.set("cache-control", "private, no-store");
    }
    return proxied;
  }
  return await ctx.next();
});

export function shouldProxyAppviewBeforeSession(pathname: string): boolean {
  if (isEdgeOwnedOauthDocument(pathname)) return false;
  if (isEdgeRenderedPublicDirectory(pathname)) return false;
  // Keep the retired shell route local so it can reliably redirect during a
  // rolling AppView deploy. The canonical management page remains proxied.
  if (pathname === "/account/products") return false;
  return pathname === "/apps" || pathname.startsWith("/apps/") ||
    pathname === "/hosts" || pathname.startsWith("/hosts/") ||
    pathname === "/account" || pathname.startsWith("/account/") ||
    pathname === "/admin" || pathname.startsWith("/admin/") ||
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

/**
 * Public directory and shell pages normally render on the Deno edge. An
 * active account session, however, is minted and stored by the AppView. Send
 * only those personalized document requests to the authoritative runtime so
 * the global account control cannot appear signed out immediately after a
 * successful account switch. Anonymous pages remain edge-rendered.
 */
export function shouldProxyActiveSessionDocument(
  pathname: string,
  request: Request,
  appviewConfigured = appviewBaseUrl() !== null,
): boolean {
  if (!appviewConfigured || isEdgeOwnedOauthDocument(pathname)) return false;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  if (!isBrowserDocumentRequest(request)) return false;
  return requestHasNonEmptyCookie(request.headers, "atmo_sid");
}

function requestHasNonEmptyCookie(headers: Headers, name: string): boolean {
  const raw = headers.get("cookie");
  if (!raw) return false;
  return raw.split(";").some((part) => {
    const cookie = part.trim();
    if (!cookie.startsWith(`${name}=`)) return false;
    return cookie.slice(name.length + 1).trim().length > 0;
  });
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

export async function loadAppsHomeFromAppview(
  requestHeaders?: Headers,
): Promise<AppSearchResult> {
  const remote = appviewBaseUrl();
  if (remote) {
    return await fetchAppviewJson<AppSearchResult>(
      remote,
      "/api/appview/apps/home",
      requestHeaders,
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
}, requestHeaders?: Headers): Promise<AppSearchResult> {
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
      requestHeaders,
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
    if (input.includeLinkedApps) params.set("includeApps", "1");
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
    const hosts = result.hosts.filter((host) =>
      isAccountHostPubliclyListable(host)
    );
    const linkedApps: Record<string, AccountHostLinkedApp[]> | undefined =
      result.linkedApps
        ? Object.fromEntries(
          hosts.flatMap((host) => {
            const apps = result.linkedApps?.[host.host];
            return apps?.length ? [[host.host, apps]] : [];
          }),
        )
        : result.linkedAppSlugs
        ? Object.fromEntries(
          hosts.flatMap((host) => {
            const slug = result.linkedAppSlugs?.[host.host];
            return slug
              ? [[host.host, [{
                slug,
                name: slug,
                relationship: "inferred" as const,
              }]]]
              : [];
          }),
        )
        : undefined;
    return {
      ...result,
      hosts,
      linkedApps,
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
  requestHeaders?: Headers,
): Promise<Response | null> {
  const remote = appviewBaseUrl();
  if (!remote) return null;
  const url = appviewTargetUrl(remote, pathWithSearch);
  if (currentUrl && url.origin === currentUrl.origin) return null;
  const res = await fetch(url, {
    headers: await appviewJsonHeaders(requestHeaders),
    redirect: "manual",
    signal: AbortSignal.timeout(APPVIEW_FETCH_TIMEOUT_MS),
  });
  if (isRedirectResponse(res)) {
    await res.body?.cancel().catch(() => {});
    throw new Error("appview JSON request returned a redirect");
  }
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
  const url = appviewTargetUrl(
    remote,
    `${currentUrl.pathname}${currentUrl.search}`,
  );
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
    signal: AbortSignal.timeout(
      appviewPageFetchTimeoutMs(currentUrl.pathname, request.method),
    ),
  });
  const headers = proxiedHeaders(res.headers, { page: true });

  const location = headers.get("location");
  if (location || isRedirectResponse(res)) {
    const rewritten = location
      ? rewriteAppviewUrl(location, remote, currentUrl)
      : null;
    if (!rewritten) {
      await res.body?.cancel().catch(() => {});
      return unsafeAppviewRedirectResponse(false);
    }
    headers.set("location", rewritten);
  }

  const contentType = headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  // Fresh renderers may derive absolute URLs from the AppView request origin.
  // Keep this bounded rewrite even when releases match: stream-through is not
  // safe until every proxied renderer consumes the signed public origin when
  // constructing URLs, forms, metadata, and defaults.
  const bounded = await readResponseTextWithLimit(res, MAX_APPVIEW_HTML_BYTES);
  if (!bounded.ok) throw new Error(`appview HTML ${bounded.error}`);
  const body = rewriteAppviewHtml(bounded.text, remote, currentUrl);
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
  const url = appviewTargetUrl(
    remote,
    `${currentUrl.pathname}${currentUrl.search}`,
  );
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
  if (location || isRedirectResponse(res)) {
    const rewritten = location
      ? rewriteAppviewApiUrl(location, remote, currentUrl)
      : null;
    if (!rewritten) {
      await res.body?.cancel().catch(() => {});
      return unsafeAppviewRedirectResponse(true);
    }
    headers.set("location", rewritten);
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
  const maxBytes = appviewRequestBodyLimit(currentUrl.pathname);
  rejectDeclaredAppviewBodySize(request, maxBytes);
  if (!shouldBufferAppviewRequestBody(currentUrl.pathname)) {
    return request.body
      ? limitedRequestBodyStream(request.body, maxBytes)
      : undefined;
  }
  if (request.headers.get("x-atmosphere-login-bodyless") === "1") {
    return undefined;
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

function appviewRequestBodyLimit(pathname: string): number {
  if (pathname === "/api/registry/profile") {
    return PROFILE_APPVIEW_REQUEST_BODY_BYTES;
  }
  if (shouldBufferAppviewRequestBody(pathname)) {
    return MAX_APPVIEW_HANDOFF_BODY_BYTES;
  }
  return DEFAULT_APPVIEW_REQUEST_BODY_BYTES;
}

function rejectDeclaredAppviewBodySize(
  request: Request,
  maxBytes: number,
): void {
  const raw = request.headers.get("content-length");
  if (!raw) return;
  if (!/^\d{1,12}$/.test(raw)) throw new AppviewProxyBodyTooLargeError();
  const declaredLength = Number(raw);
  if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
    throw new AppviewProxyBodyTooLargeError();
  }
}

function limitedRequestBodyStream(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  let total = 0;
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          await source.cancel().catch(() => {});
          controller.error(new AppviewProxyBodyTooLargeError());
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
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

export function appviewRequestBodyLimitForTest(pathname: string): number {
  return appviewRequestBodyLimit(pathname);
}

export function appviewTargetUrlForTest(
  remote: string,
  pathWithSearch: string,
): URL {
  return appviewTargetUrl(remote, pathWithSearch);
}

export async function listPublicAccountHosts(
  input: AccountHostDirectoryOptions = {},
  loadDirectory: (
    input: AccountHostDirectoryOptions,
  ) => Promise<AccountHostDirectoryResult> = listAccountHostDirectory,
): Promise<AccountHostDirectoryResult> {
  const publicInput = { ...input, publicOnly: true };
  // The directory read is authoritative. Let failures reach EdgeStaleCache so
  // it can retain a last-known-good value; converting an outage to an empty
  // success would replace both the in-process stale value and the CDN entry.
  const result = await loadDirectory(publicInput);
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
  const linkedApps: Record<string, AccountHostLinkedApp[]> | undefined =
    publicInput.includeLinkedApps
      ? await getVisibleAppsForAccountHosts(visibleHosts).catch((err) => {
        console.warn("[appview] resolve host app links failed:", err);
        return {} as Record<string, AccountHostLinkedApp[]>;
      })
      : undefined;
  const linkedAppSlugs = linkedApps
    ? Object.fromEntries(
      Object.entries(linkedApps).flatMap(([host, apps]) =>
        apps[0]?.slug ? [[host, apps[0].slug]] : []
      ),
    )
    : undefined;
  return { ...result, hosts: visibleHosts, linkedApps, linkedAppSlugs };
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
  loadHost: (hostId: string) => Promise<AccountHost | null> = getAccountHost,
): Promise<PublicHostDetail> {
  // A failed primary lookup is not the same as a missing host. Propagate the
  // failure so stale data remains usable and a cold request returns 503 rather
  // than caching a false 404. Optional profile/claim enrichment stays
  // best-effort below.
  let host = await loadHost(hostId);
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
  "x-atmosphere-render-origin",
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
): string | null {
  try {
    const remoteUrl = new URL(remote);
    const target = new URL(value, remoteUrl);
    const candidate = target.origin === remoteUrl.origin
      ? `${currentUrl.origin}${target.pathname}${target.search}${target.hash}`
      : target.toString();
    return safeBrowserNavigationUrl(candidate, currentUrl.toString());
  } catch {
    return null;
  }
}

/**
 * Media cache hits intentionally leave Atmosphere for a signed object-store
 * URL. Limit that exceptional API redirect to exact configured origins and
 * the query shape emitted by the SigV4 cache implementation. Other AppView
 * redirects retain the existing browser-navigation policy (OAuth handoffs,
 * account completion, and same-origin redirects).
 */
function rewriteAppviewApiUrl(
  value: string,
  remote: string,
  currentUrl: URL,
  derivedMediaOrigins: ReadonlySet<string> =
    configuredDerivedMediaRedirectOrigins(),
): string | null {
  const rewritten = rewriteAppviewUrl(value, remote, currentUrl);
  if (!rewritten) return null;
  let target: URL;
  try {
    target = new URL(rewritten, currentUrl);
  } catch {
    return null;
  }
  if (target.origin === currentUrl.origin) return target.toString();
  if (!isDerivedMediaApiPath(currentUrl.pathname)) return target.toString();
  return isAllowedDerivedMediaRedirect(target, derivedMediaOrigins)
    ? target.toString()
    : null;
}

function configuredDerivedMediaRedirectOrigins(): ReadonlySet<string> {
  let raw = "";
  try {
    raw = Deno.env.get(DERIVED_MEDIA_REDIRECT_ORIGINS_ENV)?.trim() ?? "";
  } catch {
    return new Set();
  }
  const origins = new Set<string>();
  for (const candidate of raw.split(",").slice(0, 8)) {
    const value = candidate.trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (
        parsed.protocol === "https:" && !parsed.username &&
        !parsed.password && !parsed.search && !parsed.hash
      ) {
        origins.add(parsed.origin);
      }
    } catch {
      // Invalid entries are ignored; an empty allowlist fails closed.
    }
  }
  return origins;
}

function isDerivedMediaApiPath(pathname: string): boolean {
  return pathname === "/api/atproto/blob" ||
    /^\/api\/registry\/(?:banner|og-banner)\/[^/]+$/.test(pathname) ||
    /^\/api\/registry\/project-og\/[^/]+$/.test(pathname) ||
    /^\/api\/registry\/screenshot\/[^/]+\/[0-3]$/.test(pathname);
}

function isAllowedDerivedMediaRedirect(
  target: URL,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (
    !allowedOrigins.has(target.origin) || target.protocol !== "https:" ||
    target.username || target.password || target.hash || target.pathname === "/"
  ) return false;
  const expectedKeys = [
    "X-Amz-Algorithm",
    "X-Amz-Credential",
    "X-Amz-Date",
    "X-Amz-Expires",
    "X-Amz-Signature",
    "X-Amz-SignedHeaders",
  ];
  const keys = [...target.searchParams.keys()];
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key) => target.searchParams.getAll(key).length !== 1)
  ) return false;
  if (
    target.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
    target.searchParams.get("X-Amz-SignedHeaders") !== "host" ||
    !/^\d{8}T\d{6}Z$/.test(
      target.searchParams.get("X-Amz-Date") ?? "",
    ) ||
    !/^[a-f0-9]{64}$/.test(
      target.searchParams.get("X-Amz-Signature") ?? "",
    ) ||
    !/^[^/\s?&#]+\/\d{8}\/[a-z0-9-]{1,63}\/s3\/aws4_request$/.test(
      target.searchParams.get("X-Amz-Credential") ?? "",
    )
  ) return false;
  const expires = Number(target.searchParams.get("X-Amz-Expires"));
  return Number.isInteger(expires) && expires >= 1 && expires <= 604_800;
}

export function rewriteAppviewUrlForTest(
  value: string,
  remote: string,
  currentUrl: URL,
): string | null {
  return rewriteAppviewUrl(value, remote, currentUrl);
}

export function rewriteAppviewApiUrlForTest(
  value: string,
  remote: string,
  currentUrl: URL,
  derivedMediaOrigins: readonly string[],
): string | null {
  return rewriteAppviewApiUrl(
    value,
    remote,
    currentUrl,
    new Set(derivedMediaOrigins.map((origin) => new URL(origin).origin)),
  );
}

function isRedirectResponse(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

function unsafeAppviewRedirectResponse(api: boolean): Response {
  return new Response(
    api
      ? JSON.stringify({ error: "appview_unsafe_redirect" })
      : "This page returned an unsafe redirect.",
    {
      status: 502,
      headers: {
        "cache-control": "no-store",
        "content-type": api
          ? "application/json; charset=utf-8"
          : "text/plain; charset=utf-8",
      },
    },
  );
}

function appviewBaseUrlForRewrite(remote: string): string {
  return remote.replace(/\/+$/, "");
}

async function fetchAppviewJson<T>(
  baseUrl: string,
  path: string,
  requestHeaders?: Headers,
): Promise<T> {
  const url = appviewTargetUrl(baseUrl, path);
  const res = await fetch(url, {
    headers: await appviewJsonHeaders(requestHeaders),
    redirect: "manual",
    signal: AbortSignal.timeout(APPVIEW_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`appview request failed: HTTP ${res.status}`);
  }
  if (!isJsonMediaType(res.headers.get("content-type"))) {
    await res.body?.cancel().catch(() => {});
    throw new Error("appview returned a non-JSON response");
  }
  const bounded = await readResponseTextWithLimit(res, MAX_APPVIEW_JSON_BYTES);
  if (!bounded.ok) throw new Error(`appview JSON ${bounded.error}`);
  return JSON.parse(bounded.text) as T;
}

function appviewTargetUrl(remote: string, pathWithSearch: string): URL {
  const target = new URL(remote);
  const path = new URL(pathWithSearch, "https://appview-path.invalid");
  target.pathname = path.pathname;
  target.search = path.search;
  target.hash = "";
  return target;
}

async function appviewJsonHeaders(
  requestHeaders?: Headers,
): Promise<Headers> {
  const headers = new Headers({ accept: "application/json" });
  if (requestHeaders) {
    headers.set(
      PROXY_CLIENT_KEY_HEADER,
      await createProxyClientKey(requestHeaders),
    );
  }
  return headers;
}

export async function appviewJsonHeadersForTest(
  requestHeaders?: Headers,
): Promise<Headers> {
  return await appviewJsonHeaders(requestHeaders);
}
