import { define } from "../utils.ts";
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

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const rawLength = response.headers.get("content-length");
  if (rawLength) {
    const contentLength = Number(rawLength);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return { ok: false, error: "response too large" };
    }
  }

  if (!response.body) {
    const text = await response.text().catch(() => null);
    if (text == null) return { ok: false, error: "response read failed" };
    return new TextEncoder().encode(text).byteLength > maxBytes
      ? { ok: false, error: "response too large" }
      : { ok: true, text };
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
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
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
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host === "::" || host === "::1"
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
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 ||
      a === 100 && b >= 64 && b <= 127;
  }

  if (host.startsWith("::ffff:")) {
    return isPrivateNetworkHostname(host.slice("::ffff:".length));
  }

  return host.startsWith("fc") || host.startsWith("fd") ||
    host.startsWith("fe80:");
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
  if (fetchSite === "cross-site") return false;

  return true;
}

export function isCrossOriginReadonlyRequest(
  req: Request,
  pathname: string,
): boolean {
  return req.method.toUpperCase() === "POST" &&
    pathname === "/api/login/selection";
}

export const securityHeadersMiddleware = define.middleware(async (ctx) => {
  const response = await ctx.next();

  const applySecurityHeaders = (headers: Headers) => {
    setDefault(headers, "x-content-type-options", "nosniff");
    setDefault(headers, "x-frame-options", "DENY");
    setDefault(headers, "referrer-policy", "strict-origin-when-cross-origin");
    setDefault(
      headers,
      "permissions-policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
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
    if (
      ctx.url.pathname === "/atmosphere-login.js" ||
      ctx.url.pathname === "/atmosphere-login-server.js"
    ) {
      setDefault(headers, "access-control-allow-origin", "*");
    }
  };

  try {
    applySecurityHeaders(response.headers);
    return response;
  } catch {
    return response;
  }
});

export const csrfMiddleware = define.middleware((ctx) => {
  if (isCrossOriginReadonlyRequest(ctx.req, ctx.url.pathname)) {
    return ctx.next();
  }
  if (isSameOriginUnsafeRequest(ctx.req, ctx.url.origin)) {
    return ctx.next();
  }
  return new Response("cross-site request rejected", { status: 403 });
});
