import { define } from "../utils.ts";
import { trustedRequestOrigin } from "./atmosphere-origins.ts";
import { IS_DEV } from "./env.ts";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const PROD_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "connect-src 'self' https: wss:",
  "media-src 'self' https: blob:",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const DEV_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' http: https: data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "connect-src 'self' http: https: ws: wss:",
  "media-src 'self' http: https: blob:",
  "worker-src 'self' blob:",
].join("; ");

function setDefault(headers: Headers, name: string, value: string): void {
  if (!headers.has(name)) headers.set(name, value);
}

export function requestBodyTooLarge(req: Request, maxBytes: number): boolean {
  const raw = req.headers.get("content-length");
  if (!raw) return false;
  const contentLength = Number(raw);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

export function rejectLargeRequest(
  req: Request,
  maxBytes: number,
): Response | null {
  return requestBodyTooLarge(req, maxBytes)
    ? new Response("request body too large", { status: 413 })
    : null;
}

export function isJsonMediaType(value: string | null | undefined): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" ||
    mediaType === "application/dns-json" ||
    mediaType?.endsWith("+json") === true;
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readJsonRequestWithLimit(
  req: Request,
  maxBytes: number,
): Promise<unknown> {
  const bytes = await readRequestBytesWithLimit(req, maxBytes);
  if (bytes === null) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** Parse form data only after enforcing a runtime byte ceiling. */
export async function readFormDataRequestWithLimit(
  req: Request,
  maxBytes: number,
): Promise<FormData | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (
    !contentType.toLowerCase().includes("application/x-www-form-urlencoded") &&
    !contentType.toLowerCase().includes("multipart/form-data")
  ) return null;
  const bytes = await readRequestBytesWithLimit(req, maxBytes);
  if (bytes === null) return new FormData();
  const parsed = new Request("https://request.invalid/", {
    method: "POST",
    headers: { "content-type": contentType },
    body: new Uint8Array(bytes).buffer,
  });
  return await parsed.formData().catch(() => null);
}

async function readRequestBytesWithLimit(
  req: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (requestBodyTooLarge(req, maxBytes)) {
    throw new RequestBodyTooLargeError();
  }
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const bounded = await readResponseBytesWithLimit(response, maxBytes);
  return bounded.ok
    ? { ok: true, text: new TextDecoder().decode(bounded.bytes) }
    : bounded;
}

/** Consume an upstream response through a hard byte ceiling. A declared
 * Content-Length is only an early rejection hint; the streaming counter is
 * authoritative for chunked and incorrectly declared responses. */
export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number,
): Promise<
  { ok: true; bytes: Uint8Array } | { ok: false; error: string }
> {
  const rawLength = response.headers.get("content-length");
  if (rawLength) {
    const contentLength = Number(rawLength);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, error: "response too large" };
    }
  }

  if (!response.body) {
    return { ok: true, bytes: new Uint8Array() };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: "response too large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "response read failed" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export function isSafeRelativePath(raw: string | null | undefined): boolean {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return false;
  if (raw.startsWith("/\\")) return false;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

export function isPrivateNetworkHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(
    /\.$/,
    "",
  );
  if (
    host === "localhost" || host.endsWith(".localhost") ||
    host === "local" || host.endsWith(".local") ||
    host === "internal" || host.endsWith(".internal") ||
    host === "home.arpa" || host.endsWith(".home.arpa") ||
    host === "test" || host.endsWith(".test") ||
    host === "invalid" || host.endsWith(".invalid") ||
    host === "example" || host.endsWith(".example") ||
    host === "onion" || host.endsWith(".onion") ||
    host === "::" || host === "::1"
  ) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map((part) => Number(part));
    if (
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return false;
    }
    return isNonPublicIpv4(parts);
  }

  const ipv6 = parseIpv6Words(host);
  if (!ipv6) return false;
  const [first] = ipv6;
  if (ipv6.every((word) => word === 0)) return true;
  if (ipv6.slice(0, 7).every((word) => word === 0) && ipv6[7] === 1) {
    return true;
  }

  if (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00
  ) return true;

  if (
    first === 0x0100 && ipv6.slice(1, 4).every((word) => word === 0) ||
    first === 0x2001 && ipv6[1] === 0x0002 && ipv6[2] === 0 ||
    first === 0x2001 && ipv6[1] === 0x0db8 ||
    first === 0x3fff && (ipv6[1] & 0xf000) === 0
  ) return true;

  const mapped = ipv6.slice(0, 5).every((word) => word === 0) &&
    ipv6[5] === 0xffff;
  const compatible = ipv6.slice(0, 6).every((word) => word === 0);
  if (mapped || compatible) {
    return isNonPublicIpv4([
      ipv6[6] >>> 8,
      ipv6[6] & 0xff,
      ipv6[7] >>> 8,
      ipv6[7] & 0xff,
    ]);
  }
  return false;
}

function isNonPublicIpv4([a, b, c]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 ||
    a === 100 && b >= 64 && b <= 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
    a === 203 && b === 0 && c === 113 ||
    a >= 224;
}

function parseIpv6Words(host: string): number[] | null {
  if (!host.includes(":")) return null;
  const dottedTail = host.match(
    /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (dottedTail) {
    const octets = dottedTail.slice(2).map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return null;
    return parseIpv6Words(
      `${dottedTail[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${
        ((octets[2] << 8) | octets[3]).toString(16)
      }`,
    );
  }
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < (halves.length === 2 ? 1 : 0)) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right].map((part) =>
    /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : -1
  );
  return words.length === 8 && words.every((word) => word >= 0) ? words : null;
}

export function isPrivateNetworkUrl(
  value: string,
  options: { allowHttp?: boolean } = {},
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  if (url.username || url.password) return true;
  if (
    url.protocol !== "https:" &&
    !(options.allowHttp && url.protocol === "http:")
  ) {
    return true;
  }
  return isPrivateNetworkHostname(url.hostname);
}

export function isSameOriginUnsafeRequest(
  req: Request,
  expectedOrigin: string,
): boolean {
  if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return true;

  const origin = req.headers.get("origin");
  if (origin) return origin === expectedOrigin;

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin") return true;
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;

  return !req.headers.has("cookie");
}

export function isCrossOriginReadonlyRequest(
  req: Request,
  pathname: string,
): boolean {
  return req.method.toUpperCase() === "POST" &&
    pathname === "/api/login/selection";
}

function isTokenBearingLoginRoute(pathname: string): boolean {
  return pathname === "/signin" ||
    pathname === "/oauth/add-account" ||
    pathname === "/oauth/switch" ||
    pathname === "/oauth/login" ||
    pathname === "/oauth/create" ||
    pathname === "/login/select" ||
    pathname === "/api/login/selection" ||
    pathname === "/examples/atmosphere-login/callback" ||
    pathname === "/hosts/claim" ||
    pathname === "/hosts/register" ||
    /^\/hosts\/[^/]+\/claim$/.test(pathname);
}

function isHostClaimRoute(pathname: string): boolean {
  return pathname === "/hosts/claim" ||
    /^\/hosts\/[^/]+\/claim$/.test(pathname);
}

function isPopupCompatibleLoginRoute(pathname: string): boolean {
  return pathname === "/login/select" ||
    pathname === "/examples/atmosphere-login/app" ||
    pathname === "/examples/atmosphere-login/callback";
}

function isRenderedAccountHtml(headers: Headers, pathname: string): boolean {
  if (pathname !== "/account" && !pathname.startsWith("/account/")) {
    return false;
  }
  return headers.get("content-type")?.toLowerCase().startsWith("text/html") ===
    true;
}

function applySecurityHeaders(headers: Headers, pathname: string): void {
  setDefault(headers, "x-content-type-options", "nosniff");
  setDefault(headers, "x-frame-options", "DENY");
  setDefault(headers, "referrer-policy", "strict-origin-when-cross-origin");
  setDefault(
    headers,
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), publickey-credentials-create=(), publickey-credentials-get=()",
  );
  setDefault(headers, "cross-origin-opener-policy", "same-origin");
  setDefault(headers, "content-security-policy", IS_DEV ? DEV_CSP : PROD_CSP);
  if (!IS_DEV) {
    setDefault(
      headers,
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
  }
  if (isTokenBearingLoginRoute(pathname)) {
    // Some embedded browsers omit Origin on native form submissions. Keep a
    // same-origin Referer available as the strict CSRF fallback without ever
    // sending claim tokens or contextual URLs to another origin.
    headers.set(
      "referrer-policy",
      isHostClaimRoute(pathname) ? "same-origin" : "no-referrer",
    );
    headers.set("cache-control", "no-store");
    headers.set("x-robots-tag", "noindex, nofollow");
  }
  if (isRenderedAccountHtml(headers, pathname)) {
    headers.set("cache-control", "private, no-store");
  }
  if (isPopupCompatibleLoginRoute(pathname)) {
    headers.set("cross-origin-opener-policy", "same-origin-allow-popups");
  }
  if (
    pathname === "/atmosphere-login.js" ||
    pathname === "/atmosphere-login-server.js"
  ) {
    setDefault(headers, "access-control-allow-origin", "*");
  }
}

function applyPersonalizedHtmlCachePolicy(
  headers: Headers,
  personalizedHtml: boolean,
): void {
  if (personalizedHtml) headers.set("cache-control", "private, no-store");
}

export function applySecurityHeadersForTest(
  pathname: string,
  headers = new Headers(),
  personalizedHtml = false,
): Headers {
  applySecurityHeaders(headers, pathname);
  applyPersonalizedHtmlCachePolicy(headers, personalizedHtml);
  return headers;
}

export const securityHeadersMiddleware = define.middleware(async (ctx) => {
  const response = await ctx.next();
  try {
    applySecurityHeaders(response.headers, ctx.url.pathname);
    const isHtml = response.headers.get("content-type")?.toLowerCase()
      .startsWith("text/html") ?? false;
    applyPersonalizedHtmlCachePolicy(
      response.headers,
      isHtml && Boolean(
        ctx.state.user || ctx.state.rememberedAccounts?.length,
      ),
    );
    return response;
  } catch {
    return response;
  }
});

export const csrfMiddleware = define.middleware((ctx) => {
  if (isCrossOriginReadonlyRequest(ctx.req, ctx.url.pathname)) {
    return ctx.next();
  }
  if (
    isSameOriginUnsafeRequest(
      ctx.req,
      trustedRequestOrigin(ctx.url, ctx.req.headers),
    )
  ) {
    return ctx.next();
  }
  return new Response("cross-site request rejected", { status: 403 });
});

export function csrfExpectedOriginForTest(
  url: URL,
  headers?: Headers,
): string {
  return trustedRequestOrigin(url, headers);
}
