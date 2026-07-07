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

const APPVIEW_BASE_URL = Deno.env.get("ATMOSPHERE_APPVIEW_URL")?.trim() ||
  Deno.env.get("APPVIEW_BASE_URL")?.trim() ||
  "";

const APPVIEW_FETCH_TIMEOUT_MS = Math.max(
  1000,
  Number(Deno.env.get("APPVIEW_FETCH_TIMEOUT_MS") ?? "5000") || 5000,
);

export interface PublicHostDetail {
  host: AccountHost | null;
  claim: AccountHostClaim | null;
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
  const headers = new Headers(res.headers);
  headers.set("x-atmosphere-appview-proxy", remote);
  headers.delete("content-length");
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

  const res = await fetch(url, {
    headers: appviewPageHeaders(request.headers, currentUrl),
    redirect: "manual",
    signal: AbortSignal.timeout(APPVIEW_FETCH_TIMEOUT_MS),
  });
  const headers = proxiedHeaders(res.headers, remote);

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
  const headers = proxiedHeaders(res.headers, remote);
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
): Headers {
  const headers = appviewRequestHeaders(requestHeaders, currentUrl);
  headers.delete("content-type");
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
      "user-agent",
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

function proxiedHeaders(source: Headers, remote: string): Headers {
  const headers = new Headers(source);
  headers.set("x-atmosphere-appview-proxy", remote);
  headers.set("x-atmosphere-appview-page-proxy", remote);
  headers.delete("content-length");
  return headers;
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
