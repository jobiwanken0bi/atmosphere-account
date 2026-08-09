/**
 * Proxy + cache the developer-facing black-and-white SVG icon for a
 * registry profile. Mirrors `/api/registry/icon/:did` exactly — same
 * gating (project verification + per-icon approval), same security
 * headers, same caching policy.
 *
 *   GET /api/registry/icon-bw/did:plc:abc123…
 */
import { define } from "../../../../utils.ts";
import { getProfileByDid } from "../../../../lib/registry.ts";
import { fetchBlobPublic } from "../../../../lib/pds.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";
import { iconProxyCacheControl } from "../../../../lib/icon-proxy-cache.ts";
import { isDid } from "../../../../lib/identity.ts";
import {
  readSecureSvgBlob,
  secureSvgErrorResponse,
} from "../../../../lib/svg-blob-security.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = routeDid(ctx.params.did);
    if (!did) return new Response("not found", { status: 404 });
    const profile = await getProfileByDid(did).catch(() => null);
    if (!profile || !profile.iconBwCid) {
      return new Response("not found", { status: 404 });
    }
    const owner = ctx.state.user?.did === did;
    if (!owner) {
      if (profile.iconAccessStatus !== "granted") {
        return new Response("not found", { status: 404 });
      }
      if (profile.iconBwStatus !== "approved") {
        return new Response("not found", { status: 404 });
      }
    }
    try {
      const upstream = await fetchBlobPublic(
        profile.pdsUrl,
        did,
        profile.iconBwCid,
      );
      const secured = await readSecureSvgBlob(upstream, profile.iconBwCid);
      if (!secured.ok) return secureSvgErrorResponse(secured);
      const headers = new Headers();
      headers.set("content-type", "image/svg+xml; charset=utf-8");
      headers.set("x-content-type-options", "nosniff");
      headers.set(
        "content-security-policy",
        "default-src 'none'; sandbox; style-src 'unsafe-inline'; img-src data:",
      );
      headers.set(
        "content-disposition",
        'inline; filename="atmosphere-icon-bw.svg"',
      );
      headers.set(
        "cache-control",
        iconProxyCacheControl(
          profile.iconAccessStatus,
          profile.iconBwStatus,
        ),
      );
      headers.set("etag", profile.iconBwCid);
      headers.set("content-length", String(secured.bytes.byteLength));
      headers.set("cross-origin-resource-policy", "same-origin");
      const body = new Uint8Array(secured.bytes.byteLength);
      body.set(secured.bytes);
      return new Response(body, { status: 200, headers });
    } catch (err) {
      console.warn("icon-bw proxy error:", err);
      return new Response("upstream error", { status: 502 });
    }
  }),
});

function routeDid(raw: string): string | null {
  try {
    const did = decodeURIComponent(raw);
    return isDid(did) ? did : null;
  } catch {
    return null;
  }
}
