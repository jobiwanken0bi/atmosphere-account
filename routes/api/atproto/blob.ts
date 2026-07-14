import { define } from "../../../utils.ts";
import {
  findPdsEndpoint,
  isDid,
  resolveDidDocument,
} from "../../../lib/identity.ts";
import { fitWebp } from "../../../lib/image-processing.ts";

const CID_RE = /^[a-zA-Z0-9]+$/;
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
  async GET(ctx) {
    const did = ctx.url.searchParams.get("did")?.trim() ?? "";
    const cid = ctx.url.searchParams.get("cid")?.trim() ?? "";
    const fallbackDid = ctx.url.searchParams.get("fallbackDid")?.trim() ?? "";
    const fallbackCid = ctx.url.searchParams.get("fallbackCid")?.trim() ?? "";
    const requestedWidth = Number(ctx.url.searchParams.get("w") ?? 0);
    const maxWidth = ALLOWED_IMAGE_WIDTHS.has(requestedWidth)
      ? requestedWidth
      : null;
    if (!isDid(did) || !cid || !CID_RE.test(cid)) {
      return new Response("invalid blob reference", { status: 400 });
    }
    const hasFallback = !!fallbackDid || !!fallbackCid;
    if (
      hasFallback &&
      (!isDid(fallbackDid) || !fallbackCid || !CID_RE.test(fallbackCid))
    ) {
      return new Response("invalid fallback blob reference", { status: 400 });
    }
    try {
      let upstream = await fetchAtprotoBlob(did, cid);
      let usedFallback = false;
      if ((!upstream?.ok || !upstream.body) && hasFallback) {
        upstream = await fetchAtprotoBlob(fallbackDid, fallbackCid);
        usedFallback = true;
      }
      if (!upstream) return new Response("blob not found", { status: 404 });
      if (!upstream.ok || !upstream.body) {
        return new Response("blob not found", { status: upstream.status });
      }
      const contentLength = Number(upstream.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) && contentLength > MAX_PROXY_BLOB_BYTES
      ) {
        return new Response("blob too large", { status: 413 });
      }
      const contentType =
        upstream.headers.get("content-type")?.split(";")[0]?.trim()
          .toLowerCase() ?? "application/octet-stream";
      if (!SAFE_IMAGE_MIME_TYPES.has(contentType)) {
        return new Response("unsupported blob type", { status: 415 });
      }
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      if (bytes.byteLength > MAX_PROXY_BLOB_BYTES) {
        return new Response("blob too large", { status: 413 });
      }
      let responseBytes = bytes;
      let responseType = contentType;
      if (maxWidth) {
        try {
          responseBytes = await fitWebp(
            bytes,
            maxWidth,
            RESIZED_IMAGE_QUALITY,
          );
          responseType = "image/webp";
        } catch (err) {
          console.warn("[atproto-blob] resize failed; serving original:", err);
        }
      }
      return new Response(responseBytes, {
        status: 200,
        headers: {
          "content-type": responseType,
          "cache-control": usedFallback
            ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"
            : "public, max-age=86400, s-maxage=31536000, immutable",
          "content-disposition": `inline; filename="atproto-blob"`,
          "content-security-policy": "default-src 'none'; sandbox",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return new Response("blob not found", { status: 404 });
    }
  },
});

async function fetchAtprotoBlob(
  did: string,
  cid: string,
): Promise<Response | null> {
  try {
    const pdsUrl = findPdsEndpoint(await resolveDidDocument(did));
    const url = new URL(
      `${pdsUrl.replace(/\/$/, "")}/xrpc/com.atproto.sync.getBlob`,
    );
    url.searchParams.set("did", did);
    url.searchParams.set("cid", cid);
    return await fetch(url.toString(), {
      headers: { accept: "*/*" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
}
