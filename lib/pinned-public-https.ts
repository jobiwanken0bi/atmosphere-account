import { connect as tlsConnect, type ConnectionOptions } from "node:tls";
import type { Duplex } from "node:stream";
import { isPrivateNetworkHostname } from "./security.ts";

const DNS_TIMEOUT_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_ADDRESS_ANSWERS = 32;

type AddressRecordType = "A" | "AAAA";
type AddressResolver = (
  hostname: string,
  type: AddressRecordType,
) => Promise<string[]>;
type TlsConnector = (
  options: ConnectionOptions,
  secureConnectListener?: () => void,
) => Duplex;

export interface PinnedPublicHttpsOptions {
  timeoutMs?: number;
  maxBodyBytes: number;
  /** Test seams. Production callers always use runtime DNS and TLS. */
  resolve?: AddressResolver;
  connect?: TlsConnector;
}

const systemResolver: AddressResolver = async (hostname, type) =>
  await Deno.resolveDns(hostname, type) as string[];

/**
 * Fetch one small HTTPS resource while pinning the TLS connection to an IP
 * that was already classified public. This closes the DNS-rebinding gap in a
 * separate "resolve, then ordinary fetch" check while retaining the original
 * hostname for certificate verification and SNI.
 */
export async function fetchPinnedPublicHttps(
  input: string | URL,
  init: RequestInit = {},
  options: PinnedPublicHttpsOptions,
): Promise<Response> {
  const url = new URL(input);
  const method = (init.method ?? "GET").toUpperCase();
  if (
    url.protocol !== "https:" || url.username || url.password ||
    (url.port && url.port !== "443") ||
    (method !== "GET" && method !== "HEAD") || init.body != null
  ) throw new Error("unsafe pinned HTTPS request");
  if (init.redirect && init.redirect !== "manual") {
    throw new Error("pinned HTTPS redirects must be manual");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || isPrivateNetworkHostname(hostname)) {
    throw new Error("pinned HTTPS hostname is private or invalid");
  }
  const addresses = await resolvePublicAddresses(
    hostname,
    options.resolve ?? systemResolver,
  );
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const maxBodyBytes = boundedBodyLimit(options.maxBodyBytes);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (const address of addresses) {
    if (init.signal?.aborted) throw init.signal.reason;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    try {
      return await requestPinnedAddress(
        url,
        method,
        init.headers,
        address,
        remainingMs,
        maxBodyBytes,
        options.connect ?? tlsConnect,
        init.signal,
      );
    } catch (error) {
      if (init.signal?.aborted) throw init.signal.reason;
      lastError = error;
    }
  }
  throw new Error(
    `pinned HTTPS request failed (${safeErrorName(lastError)})`,
  );
}

async function resolvePublicAddresses(
  hostname: string,
  resolve: AddressResolver,
): Promise<string[]> {
  const lookups = await Promise.allSettled([
    resolveWithTimeout(resolve, hostname, "A"),
    resolveWithTimeout(resolve, hostname, "AAAA"),
  ]);
  const addresses = [
    ...new Set(
      lookups.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      ),
    ),
  ];
  if (
    addresses.length < 1 || addresses.length > MAX_ADDRESS_ANSWERS ||
    addresses.some((address) => isPrivateNetworkHostname(address))
  ) throw new Error("hostname did not resolve exclusively to public addresses");
  return addresses;
}

async function resolveWithTimeout(
  resolve: AddressResolver,
  hostname: string,
  type: AddressRecordType,
): Promise<string[]> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      resolve(hostname, type),
      new Promise<string[]>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("DNS resolution timed out")),
          DNS_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function requestPinnedAddress(
  url: URL,
  method: string,
  rawHeaders: HeadersInit | undefined,
  address: string,
  timeoutMs: number,
  maxBodyBytes: number,
  connect: TlsConnector,
  signal?: AbortSignal | null,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => fail(new Error("pinned HTTPS request timed out")),
      timeoutMs,
    );
    const abort = () =>
      fail(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket?.destroy();
      reject(error);
    };
    let socket: Duplex | null = null;
    try {
      socket = connect({
        host: address,
        port: 443,
        servername: url.hostname,
        rejectUnauthorized: true,
      }, () => {
        try {
          socket!.write(serializeRequest(url, method, rawHeaders));
        } catch (error) {
          fail(error);
        }
      });
    } catch (error) {
      fail(error);
      return;
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    const wireLimit = MAX_HEADER_BYTES + maxBodyBytes * 2 + 1024;
    if (signal?.aborted) {
      fail(signal.reason);
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    socket.on("data", (chunk: Uint8Array) => {
      total += chunk.byteLength;
      if (total > wireLimit) {
        fail(new Error("pinned HTTPS response too large"));
        return;
      }
      chunks.push(new Uint8Array(chunk));
    });
    socket.on("error", fail);
    socket.on("close", () => {
      if (!settled) fail(new Error("pinned HTTPS connection closed"));
    });
    socket.on("end", () => {
      if (settled) return;
      try {
        const response = parseHttpResponse(
          concatenate(chunks, total),
          maxBodyBytes,
          method === "HEAD",
        );
        settled = true;
        cleanup();
        resolve(response);
      } catch (error) {
        fail(error);
      }
    });
  });
}

function serializeRequest(
  url: URL,
  method: string,
  rawHeaders: HeadersInit | undefined,
): Uint8Array {
  const headers = new Headers(rawHeaders);
  for (
    const forbidden of [
      "connection",
      "content-length",
      "host",
      "proxy-authorization",
      "transfer-encoding",
    ]
  ) headers.delete(forbidden);
  headers.set("host", url.hostname);
  headers.set("connection", "close");
  if (!headers.has("accept")) headers.set("accept", "*/*");
  const path = `${url.pathname || "/"}${url.search}`;
  if (/\r|\n/.test(path)) throw new Error("unsafe pinned HTTPS path");
  const lines = [`${method} ${path} HTTP/1.1`];
  for (const [name, value] of headers) {
    if (/\r|\n/.test(name) || /\r|\n/.test(value)) {
      throw new Error("unsafe pinned HTTPS header");
    }
    lines.push(`${name}: ${value}`);
  }
  return new TextEncoder().encode(`${lines.join("\r\n")}\r\n\r\n`);
}

function parseHttpResponse(
  bytes: Uint8Array,
  maxBodyBytes: number,
  headRequest: boolean,
): Response {
  const separator = indexOfBytes(bytes, new Uint8Array([13, 10, 13, 10]));
  if (separator < 0 || separator > MAX_HEADER_BYTES) {
    throw new Error("invalid pinned HTTPS response headers");
  }
  const headerText = new TextDecoder("latin1").decode(
    bytes.slice(0, separator),
  );
  const lines = headerText.split("\r\n");
  const status = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: [^\r\n]*)?$/.exec(
    lines.shift() ?? "",
  );
  if (!status || Number(status[1]) < 200) {
    throw new Error("invalid pinned HTTPS response status");
  }
  const headers = new Headers();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 1 || /^[ \t]/.test(line)) {
      throw new Error("invalid pinned HTTPS response header");
    }
    headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  let body: Uint8Array = new Uint8Array(bytes.slice(separator + 4));
  const transferEncoding = headers.get("transfer-encoding");
  const contentLength = headers.get("content-length");
  if (transferEncoding && contentLength) {
    throw new Error("ambiguous pinned HTTPS response framing");
  }
  if (headRequest || Number(status[1]) === 204 || Number(status[1]) === 304) {
    body = new Uint8Array();
  } else if (transferEncoding) {
    if (transferEncoding.toLowerCase() !== "chunked") {
      throw new Error("unsupported pinned HTTPS transfer encoding");
    }
    body = new Uint8Array(decodeChunkedBody(body, maxBodyBytes));
    headers.delete("transfer-encoding");
  } else if (contentLength) {
    if (!/^\d{1,12}$/.test(contentLength)) {
      throw new Error("invalid pinned HTTPS content length");
    }
    const length = Number(contentLength);
    if (length > maxBodyBytes || body.byteLength !== length) {
      throw new Error("invalid pinned HTTPS response body length");
    }
  } else if (body.byteLength > maxBodyBytes) {
    throw new Error("pinned HTTPS response body too large");
  }
  headers.delete("connection");
  headers.delete("content-length");
  return new Response(Uint8Array.from(body).buffer, {
    status: Number(status[1]),
    headers,
  });
}

function decodeChunkedBody(
  wire: Uint8Array,
  maxBodyBytes: number,
): Uint8Array {
  let cursor = 0;
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const lineEnd = indexOfBytes(
      wire,
      new Uint8Array([13, 10]),
      cursor,
    );
    if (lineEnd < 0 || lineEnd - cursor > 32) {
      throw new Error("invalid chunked HTTPS response");
    }
    const sizeText = new TextDecoder("ascii").decode(
      wire.slice(cursor, lineEnd),
    ).split(";", 1)[0].trim();
    if (!/^[0-9a-fA-F]+$/.test(sizeText)) {
      throw new Error("invalid chunked HTTPS response size");
    }
    const size = Number.parseInt(sizeText, 16);
    cursor = lineEnd + 2;
    if (size === 0) {
      // Only an empty trailer block is accepted; these proof endpoints do not
      // need trailers and rejecting them avoids another parsing surface.
      if (
        cursor + 2 !== wire.byteLength || wire[cursor] !== 13 ||
        wire[cursor + 1] !== 10
      ) throw new Error("invalid chunked HTTPS response trailer");
      break;
    }
    total += size;
    if (
      !Number.isSafeInteger(size) || total > maxBodyBytes ||
      cursor + size + 2 > wire.byteLength ||
      wire[cursor + size] !== 13 || wire[cursor + size + 1] !== 10
    ) throw new Error("invalid chunked HTTPS response body");
    chunks.push(wire.slice(cursor, cursor + size));
    cursor += size + 2;
  }
  return concatenate(chunks, total);
}

function concatenate(chunks: Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function indexOfBytes(
  source: Uint8Array,
  needle: Uint8Array,
  start = 0,
): number {
  outer:
  for (let index = start; index <= source.length - needle.length; index++) {
    for (let part = 0; part < needle.length; part++) {
      if (source[index + part] !== needle[part]) continue outer;
    }
    return index;
  }
  return -1;
}

function boundedTimeout(value: number | undefined): number {
  return Number.isFinite(value)
    ? Math.max(500, Math.min(30_000, Math.floor(value!)))
    : DEFAULT_TIMEOUT_MS;
}

function boundedBodyLimit(value: number): number {
  if (!Number.isFinite(value) || value < 1 || value > 1024 * 1024) {
    throw new Error("invalid pinned HTTPS body limit");
  }
  return Math.floor(value);
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z0-9_.-]{1,64}$/.test(error.name)
    ? error.name
    : "Error";
}

export const parsePinnedHttpResponseForTest = parseHttpResponse;
