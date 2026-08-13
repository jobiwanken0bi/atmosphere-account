import { define } from "../utils.ts";
import { IS_DEV } from "./env.ts";

const CACHE_POLICY_VERSION = "public-v1";
const DEFAULT_EDGE_TTL_SECONDS = 60;
const QUERY_EDGE_TTL_SECONDS = 30;
const STALE_WHILE_REVALIDATE_SECONDS = 300;
const MIN_COMPRESSIBLE_CONTENT_LENGTH = 256;

type CompressionEncoding = "br" | "gzip";

interface PublicCacheDescriptor {
  scope: "home" | "apps" | "hosts" | "docs" | "legal";
  tags: string[];
  ttlSeconds: number;
}

/**
 * Compress text responses as a stream. This covers both Fresh static files and
 * proxied AppView responses without collecting either body in memory. The
 * explicit middleware is intentional: the current Deno Deploy runtime did not
 * negotiate compression for the generated Fresh server automatically.
 */
export const responseCompressionMiddleware = define.middleware(async (ctx) => {
  const response = await ctx.next();
  // Fresh's Vite development adapter currently serializes transformed binary
  // chunks as UTF-8 text. Compressing there corrupts the representation and
  // leaves browsers waiting forever on DOMContentLoaded. Production uses the
  // compiled Deno server, which preserves binary response streams.
  if (!shouldApplyResponseCompression()) return response;
  return compressResponse(ctx.req, response);
});

export function shouldApplyResponseCompression(isDev = IS_DEV): boolean {
  return !isDev;
}

/**
 * Give Deno's CDN a deliberately small, auditable public surface. Anything
 * carrying a cookie or authorization value is made private instead of merely
 * relying on the CDN's Set-Cookie safeguard. `Vary: Cookie` is also present on
 * every stored response, so a later account-bearing request cannot match the
 * anonymous cache variant before application code runs.
 */
export const edgeCachePolicyMiddleware = define.middleware(async (ctx) => {
  const response = await ctx.next();
  return applyEdgeCachePolicy(ctx.req, ctx.url, response);
});

export function compressResponse(
  request: Request,
  response: Response,
): Response {
  if (!isCompressibleResponse(request, response)) return response;

  // Content negotiation still happened when the client selected the identity
  // representation. Mark every eligible response so a CDN can never reuse an
  // unqualified identity response for a Brotli/gzip-capable request.
  const headers = new Headers(response.headers);
  appendVary(headers, "Accept-Encoding");
  const encoding = preferredCompressionEncoding(
    request.headers.get("accept-encoding"),
  );
  if (!encoding) return cloneResponse(response, headers);

  let compression: TransformStream<Uint8Array, Uint8Array>;
  try {
    // Deno 2.7 added Brotli at runtime before its bundled DOM typings added
    // the `brotli` member to CompressionFormat.
    const format = (encoding === "br" ? "brotli" : "gzip") as CompressionFormat;
    compression = new CompressionStream(format) as TransformStream<
      Uint8Array,
      Uint8Array
    >;
  } catch {
    // Older self-hosted runtimes may not support Brotli. Falling back to the
    // identity representation is safer than failing an otherwise valid page;
    // it remains a negotiated variant and therefore retains Vary.
    return cloneResponse(response, headers);
  }

  const body = response.body!.pipeThrough(compression);
  headers.set("content-encoding", encoding);
  headers.delete("content-length");
  const etag = headers.get("etag");
  if (etag && !etag.trim().startsWith("W/")) {
    // Compression changes the representation bytes. A weak validator retains
    // semantic revalidation without claiming byte-for-byte equivalence.
    headers.set("etag", `W/${etag.trim()}`);
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function preferredCompressionEncoding(
  acceptEncoding: string | null,
): CompressionEncoding | null {
  if (!acceptEncoding) return null;
  const qualities = new Map<string, number>();
  for (const rawPart of acceptEncoding.split(",")) {
    const [rawName, ...rawParameters] = rawPart.trim().split(";");
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let quality = 1;
    const qParameter = rawParameters.find((parameter) =>
      parameter.trim().toLowerCase().startsWith("q=")
    );
    if (qParameter) {
      const parsed = Number(qParameter.trim().slice(2));
      quality = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
        ? parsed
        : 0;
    }
    qualities.set(name, quality);
  }
  const wildcard = qualities.get("*") ?? 0;
  const br = qualities.has("br") ? qualities.get("br")! : wildcard;
  const gzip = qualities.has("gzip") ? qualities.get("gzip")! : wildcard;
  if (br <= 0 && gzip <= 0) return null;
  return br >= gzip ? "br" : "gzip";
}

function isCompressibleResponse(request: Request, response: Response): boolean {
  if (request.method.toUpperCase() === "HEAD" || !response.body) return false;
  if (
    response.status < 200 || response.status === 204 ||
    response.status === 205 || response.status === 304
  ) return false;
  if (
    request.headers.has("range") || response.headers.has("content-range") ||
    response.headers.has("content-encoding")
  ) return false;
  if (
    cacheControlHasDirective(
      request.headers.get("cache-control"),
      "no-transform",
    ) ||
    cacheControlHasDirective(
      response.headers.get("cache-control"),
      "no-transform",
    )
  ) return false;
  const declaredLengthRaw = response.headers.get("content-length");
  if (declaredLengthRaw !== null) {
    const declaredLength = Number(declaredLengthRaw);
    if (
      Number.isFinite(declaredLength) && declaredLength >= 0 &&
      declaredLength < MIN_COMPRESSIBLE_CONTENT_LENGTH
    ) return false;
  }
  return isCompressibleContentType(response.headers.get("content-type"));
}

function isCompressibleContentType(value: string | null): boolean {
  const type = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return type !== "text/event-stream" && (type.startsWith("text/") ||
    type === "application/json" || type.endsWith("+json") ||
    type === "application/javascript" ||
    type === "application/x-javascript" ||
    type === "application/manifest+json" ||
    type === "application/xml" || type.endsWith("+xml") ||
    type === "application/wasm" || type === "image/svg+xml");
}

export function applyEdgeCachePolicy(
  request: Request,
  url: URL,
  response: Response,
): Response {
  const descriptor = publicCacheDescriptor(url);
  if (!descriptor) return response;

  if (!isAnonymousPublicCacheRequest(request)) {
    if (!isCacheableRepresentation(response)) return response;
    const headers = new Headers(response.headers);
    forcePrivateCachePolicy(headers);
    return cloneResponse(response, headers);
  }

  if (!isPublicCacheableResponse(response)) return response;
  const headers = new Headers(response.headers);
  headers.set(
    "cache-control",
    "public, max-age=0, must-revalidate",
  );
  headers.set(
    "deno-cdn-cache-control",
    `public, s-maxage=${descriptor.ttlSeconds}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`,
  );
  headers.set("deno-cache-tag", descriptor.tags.join(","));
  headers.set("x-atmosphere-cache-policy", CACHE_POLICY_VERSION);
  appendVary(headers, "Cookie");
  appendVary(headers, "Accept-Language");

  // Deliberately omit Deno-Cache-Id. It opts responses out of automatic
  // deployment invalidation and is an invalidation tag, not a request cache
  // key. Dynamic HTML/JSON must expire at deploy so it cannot retain links to
  // a previous Fresh asset build.
  return cloneResponse(response, headers);
}

function isAnonymousPublicCacheRequest(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  // Requiring an entirely cookie-free request is conservative on purpose. It
  // prevents future flow, preference, or experiment cookies from silently
  // becoming personalization inputs that this policy forgot to enumerate.
  if (request.headers.has("cookie") || request.headers.has("authorization")) {
    return false;
  }
  if (request.headers.has("range")) return false;
  return request.headers.get("x-atmosphere-login") !== "1";
}

function isPublicCacheableResponse(response: Response): boolean {
  if (response.status !== 200 || !isCacheableRepresentation(response)) {
    return false;
  }
  if (response.headers.has("set-cookie")) return false;
  const cacheControl = response.headers.get("cache-control");
  return !["private", "no-store", "no-cache"].some((directive) =>
    cacheControlHasDirective(cacheControl, directive)
  );
}

function isCacheableRepresentation(response: Response): boolean {
  const type = response.headers.get("content-type")?.split(";", 1)[0]
    ?.trim().toLowerCase();
  return type === "text/html" || type === "application/xhtml+xml" ||
    type === "application/json" || type?.endsWith("+json") === true;
}

function forcePrivateCachePolicy(headers: Headers): void {
  headers.set("cache-control", "private, no-store");
  headers.set("deno-cdn-cache-control", "private, no-store");
  headers.delete("deno-cache-id");
  headers.delete("deno-cache-tag");
  headers.delete("x-atmosphere-cache-policy");
  appendVary(headers, "Cookie");
}

function publicCacheDescriptor(url: URL): PublicCacheDescriptor | null {
  if (url.search.length > 512) return null;
  const path = url.pathname;
  if (path === "/" && hasOnlyQueryKeys(url, [])) {
    return descriptor("home", ["home"], DEFAULT_EDGE_TTL_SECONDS);
  }
  if (path === "/apps" && hasOnlyQueryKeys(url, [])) {
    return descriptor("apps", ["apps", "apps-home"], DEFAULT_EDGE_TTL_SECONDS);
  }
  if (
    path === "/apps/all" &&
    hasOnlyQueryKeys(url, ["q", "tag", "sort", "page"])
  ) {
    return descriptor(
      "apps",
      ["apps", "apps-directory"],
      QUERY_EDGE_TTL_SECONDS,
    );
  }
  if (path === "/apps/categories" && hasOnlyQueryKeys(url, [])) {
    return descriptor(
      "apps",
      ["apps", "app-categories"],
      DEFAULT_EDGE_TTL_SECONDS,
    );
  }
  const app = singlePublicPathIdentifier(path, "/apps/", APP_RESERVED_PATHS);
  if (app && hasOnlyQueryKeys(url, [])) {
    return descriptor(
      "apps",
      ["apps", `app-${cacheTagPart(app)}`],
      DEFAULT_EDGE_TTL_SECONDS,
    );
  }
  if (
    path === "/hosts" &&
    hasOnlyQueryKeys(url, ["q", "sort", "signup", "verification", "page"])
  ) {
    return descriptor(
      "hosts",
      ["hosts", "hosts-directory"],
      url.search ? QUERY_EDGE_TTL_SECONDS : DEFAULT_EDGE_TTL_SECONDS,
    );
  }
  const host = singlePublicPathIdentifier(path, "/hosts/", HOST_RESERVED_PATHS);
  if (host && hasOnlyQueryKeys(url, [])) {
    return descriptor(
      "hosts",
      ["hosts", `host-${cacheTagPart(host)}`],
      DEFAULT_EDGE_TTL_SECONDS,
    );
  }
  if (
    path === "/api/appview/apps/home" && hasOnlyQueryKeys(url, [])
  ) {
    return descriptor(
      "apps",
      ["apps", "apps-home-api"],
      DEFAULT_EDGE_TTL_SECONDS,
    );
  }
  if (
    path === "/api/appview/apps/search" &&
    hasOnlyQueryKeys(url, ["q", "tag", "sort", "page"])
  ) {
    return descriptor(
      "apps",
      ["apps", "apps-search-api"],
      QUERY_EDGE_TTL_SECONDS,
    );
  }
  if (
    path === "/api/appview/hosts" &&
    hasOnlyQueryKeys(url, [
      "q",
      "includeApps",
      "sort",
      "signup",
      "verification",
      "hasSignupUrl",
      "trusted",
      "page",
      "pageSize",
    ])
  ) {
    return descriptor(
      "hosts",
      ["hosts", "hosts-directory-api"],
      url.search ? QUERY_EDGE_TTL_SECONDS : DEFAULT_EDGE_TTL_SECONDS,
    );
  }
  const apiHost = singlePublicPathIdentifier(
    path,
    "/api/appview/hosts/",
    new Set(),
  );
  if (apiHost && hasOnlyQueryKeys(url, [])) {
    return descriptor(
      "hosts",
      ["hosts", `host-${cacheTagPart(apiHost)}`],
      DEFAULT_EDGE_TTL_SECONDS,
    );
  }
  if (
    (path === "/docs" || path.startsWith("/docs/") ||
      path === "/developer-resources") && hasOnlyQueryKeys(url, [])
  ) {
    return descriptor("docs", ["docs"], DEFAULT_EDGE_TTL_SECONDS);
  }
  if (
    (path === "/terms" || path === "/privacy") &&
    hasOnlyQueryKeys(url, [])
  ) {
    return descriptor("legal", ["legal"], DEFAULT_EDGE_TTL_SECONDS);
  }
  return null;
}

const APP_RESERVED_PATHS = new Set([
  "all",
  "categories",
  "create",
  "manage",
  "migrate-from-legacy",
]);

const HOST_RESERVED_PATHS = new Set([
  "claim",
  "oauth-entry",
  "register",
]);

function singlePublicPathIdentifier(
  pathname: string,
  prefix: string,
  reserved: ReadonlySet<string>,
): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length);
  if (!raw || raw.includes("/")) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw).trim().toLowerCase();
  } catch {
    return null;
  }
  return value && !reserved.has(value) ? value : null;
}

function hasOnlyQueryKeys(url: URL, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  for (const key of url.searchParams.keys()) {
    if (!allowedSet.has(key)) return false;
  }
  return true;
}

function descriptor(
  scope: PublicCacheDescriptor["scope"],
  tags: string[],
  ttlSeconds: number,
): PublicCacheDescriptor {
  return {
    scope,
    ttlSeconds,
    tags: ["atmosphere-public", CACHE_POLICY_VERSION, ...tags],
  };
}

function cacheTagPart(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9.-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "").slice(0, 160) || "unknown";
}

function cacheControlHasDirective(
  value: string | null,
  expected: string,
): boolean {
  return (value ?? "").split(",").some((part) =>
    part.trim().split("=", 1)[0]?.toLowerCase() === expected
  );
}

function appendVary(headers: Headers, field: string): void {
  const values = (headers.get("vary") ?? "").split(",")
    .map((value) => value.trim()).filter(Boolean);
  if (values.includes("*")) return;
  if (!values.some((value) => value.toLowerCase() === field.toLowerCase())) {
    values.push(field);
  }
  headers.set("vary", values.join(", "));
}

function cloneResponse(response: Response, headers: Headers): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function publicCacheDescriptorForTest(
  url: URL,
): PublicCacheDescriptor | null {
  return publicCacheDescriptor(url);
}
