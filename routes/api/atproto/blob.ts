import { define } from "../../../utils.ts";
import {
  findPdsEndpoint,
  isDid,
  resolveDidDocument,
} from "../../../lib/identity.ts";
import { fetchBlobPublic } from "../../../lib/pds.ts";
import {
  hasImageSignature,
  isValidAtprotoBlobCid,
  verifyAtprotoBlobCid,
} from "../../../lib/atproto-blob-security.ts";
import { withRateLimit } from "../../../lib/rate-limit.ts";
import { readResponseBytesWithLimit } from "../../../lib/security.ts";
import {
  atprotoDerivedMediaKey,
  cachedDerivedMediaRedirect,
  storeDerivedMedia,
} from "../../../lib/derived-media-cache.ts";

const MAX_PROXY_BLOB_BYTES = 8_000_000;
const ALLOWED_IMAGE_WIDTHS = new Set([320, 640, 800, 1200]);
const RESIZED_IMAGE_QUALITY = 82;
const SAFE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = ctx.url.searchParams.get("did")?.trim() ?? "";
    const cid = ctx.url.searchParams.get("cid")?.trim() ?? "";
    const fallbackDid = ctx.url.searchParams.get("fallbackDid")?.trim() ?? "";
    const fallbackCid = ctx.url.searchParams.get("fallbackCid")?.trim() ?? "";
    const requestedWidth = Number(ctx.url.searchParams.get("w") ?? 0);
    const maxWidth = ALLOWED_IMAGE_WIDTHS.has(requestedWidth)
      ? requestedWidth
      : null;
    if (!isDid(did) || !isValidAtprotoBlobCid(cid)) {
      return errorResponse("invalid blob reference", 400);
    }
    const hasFallback = !!fallbackDid || !!fallbackCid;
    if (
      hasFallback &&
      (!isDid(fallbackDid) || !isValidAtprotoBlobCid(fallbackCid))
    ) {
      return errorResponse("invalid fallback blob reference", 400);
    }
    try {
      const primaryCacheKey = maxWidth
        ? atprotoDerivedMediaKey({ did, cid, width: maxWidth })
        : null;
      if (primaryCacheKey) {
        const primaryCached = await cachedDerivedMediaRedirect(primaryCacheKey);
        if (primaryCached) return primaryCached;
      }
      let upstream = await fetchAtprotoBlob(did, cid);
      let usedFallback = false;
      if ((!upstream?.ok || !upstream.body) && hasFallback) {
        await upstream?.body?.cancel().catch(() => {});
        if (maxWidth) {
          const fallbackCached = await cachedDerivedMediaRedirect(
            atprotoDerivedMediaKey({
              did: fallbackDid,
              cid: fallbackCid,
              width: maxWidth,
            }),
          );
          if (fallbackCached) return fallbackCached;
        }
        upstream = await fetchAtprotoBlob(fallbackDid, fallbackCid);
        usedFallback = true;
      }
      if (!upstream) return errorResponse("blob not found", 404);
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel().catch(() => {});
        return errorResponse("blob not found", 404);
      }
      const contentLength = Number(upstream.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) && contentLength > MAX_PROXY_BLOB_BYTES
      ) {
        await upstream.body.cancel().catch(() => {});
        return errorResponse("blob too large", 413);
      }
      const contentType =
        upstream.headers.get("content-type")?.split(";")[0]?.trim()
          .toLowerCase() ?? "application/octet-stream";
      if (!SAFE_IMAGE_MIME_TYPES.has(contentType)) {
        await upstream.body.cancel().catch(() => {});
        return errorResponse("unsupported blob type", 415);
      }
      const bounded = await readResponseBytesWithLimit(
        upstream,
        MAX_PROXY_BLOB_BYTES,
      );
      if (!bounded.ok) {
        return errorResponse(
          bounded.error === "response too large"
            ? "blob too large"
            : "blob unavailable",
          bounded.error === "response too large" ? 413 : 502,
        );
      }
      const bytes = bounded.bytes;
      const expectedCid = usedFallback ? fallbackCid : cid;
      if (!await verifyAtprotoBlobCid(expectedCid, bytes)) {
        return errorResponse("blob integrity check failed", 502);
      }
      if (!hasImageSignature(bytes, contentType)) {
        return errorResponse("blob content does not match its image type", 415);
      }
      const cacheControl = usedFallback
        ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"
        : "public, max-age=86400, s-maxage=31536000, immutable";
      let responseBytes = bytes;
      let responseType = contentType;
      let resized = false;
      if (maxWidth) {
        try {
          const { fitWebp } = await import(
            "../../../lib/image-processing.ts"
          );
          responseBytes = await fitWebp(
            bytes,
            maxWidth,
            RESIZED_IMAGE_QUALITY,
          );
          responseType = "image/webp";
          resized = true;
        } catch (err) {
          console.warn("[atproto-blob] resize failed; serving original:", err);
        }
      }
      const responseBody = new Uint8Array(responseBytes.byteLength);
      responseBody.set(responseBytes);
      if (maxWidth && resized) {
        const storedDid = usedFallback ? fallbackDid : did;
        const storedCid = usedFallback ? fallbackCid : cid;
        void storeDerivedMedia({
          key: atprotoDerivedMediaKey({
            did: storedDid,
            cid: storedCid,
            width: maxWidth,
          }),
          bytes: responseBytes,
          contentType: responseType,
          filename: `atmosphere-${maxWidth}.webp`,
        });
      }
      return new Response(responseBody, {
        status: 200,
        headers: blobResponseHeaders({
          contentType: responseType,
          cacheControl,
          contentLength: responseBytes.byteLength,
        }),
      });
    } catch {
      return errorResponse("blob not found", 404);
    }
  }, {
    scope: "atproto-blob",
    capacity: 120,
    refillMs: 60_000,
  }),
});

function blobResponseHeaders(input: {
  contentType: string;
  cacheControl: string;
  contentLength: number;
}): HeadersInit {
  return {
    "content-type": input.contentType,
    "content-length": String(input.contentLength),
    "cache-control": input.cacheControl,
    "content-disposition": `inline; filename="atproto-blob"`,
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
  };
}

function errorResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

async function fetchAtprotoBlob(
  did: string,
  cid: string,
): Promise<Response | null> {
  try {
    const pdsUrl = findPdsEndpoint(await resolveDidDocument(did));
    return await fetchBlobPublic(pdsUrl, did, cid).then(async (response) => {
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      return response;
    });
  } catch {
    return null;
  }
}
