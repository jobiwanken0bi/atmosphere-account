import { define } from "../../../utils.ts";
import {
  findPdsEndpoint,
  isDid,
  resolveDidDocument,
} from "../../../lib/identity.ts";

const CID_RE = /^[a-zA-Z0-9]+$/;
const MAX_PROXY_BLOB_BYTES = 8_000_000;
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
    if (!isDid(did) || !cid || !CID_RE.test(cid)) {
      return new Response("invalid blob reference", { status: 400 });
    }
    try {
      const pdsUrl = findPdsEndpoint(await resolveDidDocument(did));
      const url = new URL(
        `${pdsUrl.replace(/\/$/, "")}/xrpc/com.atproto.sync.getBlob`,
      );
      url.searchParams.set("did", did);
      url.searchParams.set("cid", cid);
      const upstream = await fetch(url.toString(), {
        headers: { accept: "*/*" },
        signal: AbortSignal.timeout(10_000),
      });
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
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=86400, s-maxage=604800",
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
