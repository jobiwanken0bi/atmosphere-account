import { verifyAtprotoBlobCid } from "./atproto-blob-security.ts";

const SAFE_RASTER_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function safeRasterImageMime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const mime = value.split(";", 1)[0].trim().toLowerCase();
  return SAFE_RASTER_MIME_TYPES.has(mime) ? mime : null;
}

/**
 * Reject files whose bytes do not match the raster format claimed by the
 * browser. This is deliberately a lightweight signature check: image decoding
 * still belongs to the image pipeline, while this boundary prevents HTML or
 * script bytes from being persisted and later served as an image.
 */
export function matchesRasterImageSignature(
  bytes: Uint8Array,
  claimedMime: unknown,
): boolean {
  const mime = safeRasterImageMime(claimedMime);
  if (!mime) return false;
  if (mime === "image/png") {
    return bytes.byteLength >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (mime === "image/jpeg") {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
  }
  return bytes.byteLength >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50;
}

function declaredContentLengthWithinLimit(
  response: Response,
  maxBytes: number,
): { ok: true; length: number | null } | { ok: false } {
  const raw = response.headers.get("content-length");
  if (raw === null) return { ok: true, length: null };
  const length = Number(raw);
  return Number.isSafeInteger(length) && length >= 0 && length <= maxBytes
    ? { ok: true, length }
    : { ok: false };
}

export async function secureRasterImageProxyResponse(
  upstream: Response,
  options: {
    cid: string;
    declaredMime?: string | null;
    maxBytes: number;
    cacheControl: string;
    etag?: string | null;
    filename?: string;
    crossOrigin?: boolean;
  },
): Promise<Response> {
  if (!upstream.ok || !upstream.body) {
    return new Response("not found", { status: 404 });
  }
  const length = declaredContentLengthWithinLimit(upstream, options.maxBytes);
  if (!length.ok) {
    void upstream.body.cancel().catch(() => {});
    return new Response("image too large", { status: 413 });
  }

  // The validated profile record is canonical. If an account host attempts to
  // answer with text/html, force the safe recorded raster type instead.
  const contentType = safeRasterImageMime(options.declaredMime) ??
    safeRasterImageMime(upstream.headers.get("content-type"));
  if (!contentType) {
    void upstream.body.cancel().catch(() => {});
    return new Response("unsupported image type", { status: 415 });
  }

  const bytes = await readRasterImageBytesWithLimit(
    upstream,
    options.maxBytes,
  );
  if (!bytes) {
    return new Response("image unavailable", {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }
  if (!await verifyAtprotoBlobCid(options.cid, bytes)) {
    return new Response("image integrity check failed", {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }
  if (!matchesRasterImageSignature(bytes, contentType)) {
    return new Response("image content does not match its type", {
      status: 415,
      headers: { "cache-control": "no-store" },
    });
  }

  const headers = new Headers({
    "content-type": contentType,
    "cache-control": options.cacheControl,
    "content-disposition": options.filename
      ? `inline; filename="${options.filename.replace(/["\\]/g, "")}"`
      : "inline",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
    "content-length": String(bytes.byteLength),
  });
  if (options.etag) headers.set("etag", options.etag);
  if (options.crossOrigin) {
    headers.set("access-control-allow-origin", "*");
    headers.set("cross-origin-resource-policy", "cross-origin");
  }
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, {
    status: 200,
    headers,
  });
}

/** Read an image into memory for server-side processing while enforcing the
 * same limit for both declared and chunked upstream responses. */
export async function readRasterImageBytesWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = declaredContentLengthWithinLimit(response, maxBytes);
  if (!declared.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    return null;
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
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
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
