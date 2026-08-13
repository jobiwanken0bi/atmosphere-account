/**
 * Private S3-compatible write-through cache for verified, immutable media.
 *
 * The canonical source remains the AT Protocol PDS. A cache hit redirects the
 * browser to a short-lived signed bucket URL, removing the PDS fetch, Sharp
 * transform, and web-service byte transfer from the hot path. A cache miss is
 * handled by the existing verified media pipeline and stored asynchronously.
 */

import { matchesRasterImageSignature } from "./raster-image-security.ts";

const SERVICE = "s3";
const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const DEFAULT_HEAD_TIMEOUT_MS = 800;
const DEFAULT_PUT_TIMEOUT_MS = 3_000;
const DEFAULT_VERIFY_TIMEOUT_MS = 5_000;
const DEFAULT_SIGNED_GET_SECONDS = 7 * 24 * 60 * 60;
const MAX_SIGNED_GET_SECONDS = 7 * 24 * 60 * 60;
const MAX_DERIVED_MEDIA_BYTES = 8_000_000;

export interface DerivedMediaCacheConfig {
  endpoint: URL;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  urlStyle: "path" | "virtual-hosted";
}

interface DerivedMediaOptions {
  config?: DerivedMediaCacheConfig | null;
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
}

export interface StoreDerivedMediaInput extends DerivedMediaOptions {
  key: string;
  bytes: Uint8Array;
  contentType: string;
  cacheControl?: string;
  filename?: string;
}

function envValue(key: string): string | undefined {
  try {
    return Deno.env.get(key)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function derivedMediaCacheConfig(
  env: (key: string) => string | undefined = envValue,
): DerivedMediaCacheConfig | null {
  const endpointRaw = env("DERIVED_MEDIA_S3_ENDPOINT") ??
    env("AWS_ENDPOINT_URL");
  const accessKeyId = env("DERIVED_MEDIA_S3_ACCESS_KEY_ID") ??
    env("AWS_ACCESS_KEY_ID");
  const secretAccessKey = env("DERIVED_MEDIA_S3_SECRET_ACCESS_KEY") ??
    env("AWS_SECRET_ACCESS_KEY");
  const bucket = env("DERIVED_MEDIA_S3_BUCKET") ??
    env("AWS_S3_BUCKET_NAME");
  const region = env("DERIVED_MEDIA_S3_REGION") ??
    env("AWS_DEFAULT_REGION");
  if (!endpointRaw || !accessKeyId || !secretAccessKey || !bucket || !region) {
    return null;
  }
  let endpoint: URL;
  try {
    endpoint = new URL(endpointRaw);
  } catch {
    return null;
  }
  if (
    endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
    endpoint.search || endpoint.hash || !validBucketName(bucket) ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(region)
  ) return null;
  const rawStyle = (env("DERIVED_MEDIA_S3_URL_STYLE") ??
    env("AWS_S3_URL_STYLE") ?? "path").toLowerCase();
  const urlStyle = rawStyle === "virtual" || rawStyle === "virtual-host" ||
      rawStyle === "virtual-hosted"
    ? "virtual-hosted"
    : rawStyle === "path"
    ? "path"
    : null;
  if (!urlStyle) return null;
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    region,
    urlStyle,
  };
}

function validBucketName(value: string): boolean {
  return value.length >= 3 && value.length <= 63 &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value) &&
    !value.includes("..") && !/^\d+\.\d+\.\d+\.\d+$/.test(value);
}

export function atprotoDerivedMediaKey(input: {
  did: string;
  cid: string;
  width?: number | null;
}): string {
  const variant = input.width ? `w-${input.width}.webp` : "original";
  return `v1/atproto/${safeKeyPart(input.did)}/${
    safeKeyPart(input.cid)
  }/${variant}`;
}

export function profileDerivedMediaKey(input: {
  kind: "banner" | "screenshot" | "og";
  did: string;
  cid: string;
  width?: number | null;
  index?: number | null;
}): string {
  const index = input.index == null ? "" : `/i-${input.index}`;
  const variant = input.kind === "og"
    ? "1200x630.jpg"
    : input.width
    ? `w-${input.width}.webp`
    : "original";
  return `v1/profile/${input.kind}/${safeKeyPart(input.did)}/${
    safeKeyPart(input.cid)
  }${index}/${variant}`;
}

function safeKeyPart(value: string): string {
  return encodeURIComponent(value.trim()).replaceAll("%", "~");
}

export async function cachedDerivedMediaRedirect(
  key: string,
  options: DerivedMediaOptions = {},
): Promise<Response | null> {
  const config = options.config === undefined
    ? derivedMediaCacheConfig()
    : options.config;
  if (!config || !validMediaKey(key)) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const request = await signedRequest({
    config,
    method: "HEAD",
    key,
    now,
    payloadHash: EMPTY_SHA256,
  });
  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: "HEAD",
      headers: request.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_HEAD_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  await response.body?.cancel().catch(() => {});
  if (response.status !== 200) return null;
  const location = await presignedGetUrl(config, key, now);
  return new Response(null, {
    status: 302,
    headers: {
      location: location.toString(),
      "cache-control":
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate=432000, stale-if-error=432000",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function storeDerivedMedia(
  input: StoreDerivedMediaInput,
): Promise<boolean> {
  const config = input.config === undefined
    ? derivedMediaCacheConfig()
    : input.config;
  if (
    !config || !validMediaKey(input.key) || input.bytes.byteLength === 0 ||
    input.bytes.byteLength > MAX_DERIVED_MEDIA_BYTES ||
    !matchesRasterImageSignature(input.bytes, input.contentType)
  ) return false;
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  const payloadHash = await sha256Hex(input.bytes);
  const cacheControl = input.cacheControl ??
    "public, max-age=31536000, immutable";
  const extraHeaders: Record<string, string> = {
    "cache-control": cacheControl,
    "content-type": input.contentType,
  };
  if (input.filename) {
    extraHeaders["content-disposition"] = `inline; filename="${
      input.filename.replace(/["\\\r\n]/g, "")
    }"`;
  }
  const request = await signedRequest({
    config,
    method: "PUT",
    key: input.key,
    now,
    payloadHash,
    extraHeaders,
  });
  try {
    const response = await fetchImpl(request.url, {
      method: "PUT",
      headers: request.headers,
      body: Uint8Array.from(input.bytes),
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_PUT_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => {});
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

/**
 * Verify the exact bytes already stored under an immutable cache key.
 *
 * This deliberately performs a signed GET rather than trusting object
 * existence or metadata. It is used by destructive backfills before the
 * database copy is removed; hot request paths should continue to use the
 * inexpensive HEAD-based redirect helper above.
 */
export async function verifyCachedDerivedMedia(
  key: string,
  expectedBytes: Uint8Array,
  options: DerivedMediaOptions = {},
): Promise<boolean> {
  const config = options.config === undefined
    ? derivedMediaCacheConfig()
    : options.config;
  if (
    !config || !validMediaKey(key) || expectedBytes.byteLength === 0 ||
    expectedBytes.byteLength > MAX_DERIVED_MEDIA_BYTES
  ) return false;

  const now = options.now ?? new Date();
  const url = await presignedGetUrl(config, key, now, 60);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(
        options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS,
      ),
    });
  } catch {
    return false;
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    return false;
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    (!Number.isSafeInteger(declaredLength) ||
      declaredLength !== expectedBytes.byteLength)
  ) {
    await response.body.cancel().catch(() => {});
    return false;
  }
  const actual = await readStreamWithExactLimit(
    response.body,
    expectedBytes.byteLength,
  );
  if (!actual || actual.byteLength !== expectedBytes.byteLength) return false;
  const [actualHash, expectedHash] = await Promise.all([
    sha256Hex(actual),
    sha256Hex(expectedBytes),
  ]);
  return actualHash === expectedHash;
}

/** Store a response that has already passed the bounded raster/CID pipeline. */
export async function storeVerifiedMediaResponse(
  key: string,
  response: Response,
  filename?: string,
  options: DerivedMediaOptions = {},
): Promise<boolean> {
  if (!response.ok || !response.body) return false;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]
    .trim().toLowerCase() ?? "";
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    !/^(?:image\/jpeg|image\/png|image\/webp)$/.test(contentType) ||
    !Number.isSafeInteger(declaredLength) || declaredLength <= 0 ||
    declaredLength > MAX_DERIVED_MEDIA_BYTES
  ) return false;
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.byteLength !== declaredLength ||
      !matchesRasterImageSignature(bytes, contentType)
    ) return false;
    return await storeDerivedMedia({
      key,
      bytes,
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
      filename,
      ...options,
    });
  } catch {
    return false;
  }
}

async function readStreamWithExactLimit(
  body: ReadableStream<Uint8Array>,
  expectedBytes: number,
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > expectedBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }
  if (total !== expectedBytes) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validMediaKey(key: string): boolean {
  return key.length > 0 && key.length <= 768 && !key.startsWith("/") &&
    !key.endsWith("/") && !key.includes("//") && !key.includes("..") &&
    /^[A-Za-z0-9._~/-]+$/.test(key);
}

async function signedRequest(input: {
  config: DerivedMediaCacheConfig;
  method: "HEAD" | "PUT";
  key: string;
  now: Date;
  payloadHash: string;
  extraHeaders?: Record<string, string>;
}): Promise<{ url: URL; headers: Headers }> {
  const url = objectUrl(input.config, input.key);
  const amzDate = formatAmzDate(input.now);
  const date = amzDate.slice(0, 8);
  const headerValues: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": amzDate,
    ...input.extraHeaders,
  };
  const names = Object.keys(headerValues).map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names.map((name) =>
    `${name}:${normalizeHeaderValue(headerValues[name])}\n`
  ).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    input.method,
    canonicalUri(url),
    "",
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const scope = `${date}/${input.config.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");
  const signature = await signatureHex(
    input.config.secretAccessKey,
    date,
    input.config.region,
    stringToSign,
  );
  const headers = new Headers();
  for (const name of names) {
    if (name !== "host") headers.set(name, headerValues[name]);
  }
  headers.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${input.config.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );
  return { url, headers };
}

async function presignedGetUrl(
  config: DerivedMediaCacheConfig,
  key: string,
  now: Date,
  expiresSeconds = DEFAULT_SIGNED_GET_SECONDS,
): Promise<URL> {
  const url = objectUrl(config, key);
  const amzDate = formatAmzDate(now);
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${config.region}/${SERVICE}/aws4_request`;
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(
      Math.max(1, Math.min(MAX_SIGNED_GET_SECONDS, expiresSeconds)),
    ),
    "X-Amz-SignedHeaders": "host",
  });
  const canonicalQuery = canonicalQueryString(params);
  const canonicalRequest = [
    "GET",
    canonicalUri(url),
    canonicalQuery,
    `host:${url.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");
  params.set(
    "X-Amz-Signature",
    await signatureHex(
      config.secretAccessKey,
      date,
      config.region,
      stringToSign,
    ),
  );
  url.search = canonicalQueryString(params);
  return url;
}

function objectUrl(config: DerivedMediaCacheConfig, key: string): URL {
  const url = new URL(config.endpoint);
  const encodedKey = key.split("/").map(rfc3986).join("/");
  const basePath = url.pathname.replace(/\/+$/, "");
  if (config.urlStyle === "virtual-hosted") {
    url.hostname = `${config.bucket}.${url.hostname}`;
    url.pathname = `${basePath}/${encodedKey}`;
  } else {
    url.pathname = `${basePath}/${rfc3986(config.bucket)}/${encodedKey}`;
  }
  return url;
}

function canonicalUri(url: URL): string {
  return url.pathname || "/";
}

function canonicalQueryString(params: URLSearchParams): string {
  return [...params.entries()].map((
    [key, value],
  ) => [rfc3986(key), rfc3986(value)])
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey)
    ).map(([key, value]) => `${key}=${value}`).join("&");
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function formatAmzDate(value: Date): string {
  return value.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function signatureHex(
  secret: string,
  date: string,
  region: string,
  stringToSign: string,
): Promise<string> {
  const dateKey = await hmac(
    new TextEncoder().encode(`AWS4${secret}`),
    date,
  );
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, SERVICE);
  const signingKey = await hmac(serviceKey, "aws4_request");
  return toHex(await hmac(signingKey, stringToSign));
}

async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(value),
    ),
  );
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  return toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(value)),
    ),
  );
}

function toHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
