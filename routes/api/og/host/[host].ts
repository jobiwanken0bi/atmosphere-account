import { define } from "../../../../utils.ts";
import { getHostDetailFromAppview } from "../../../../lib/appview-client.ts";
import {
  loadAtmosphereHandleIconDataUrl,
  renderHostSocialCardPng,
} from "../../../../lib/host-social-card.ts";
import {
  matchesRasterImageSignature,
  readRasterImageBytesWithLimit,
  safeRasterImageMime,
} from "../../../../lib/raster-image-security.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";
import { isPrivateNetworkUrl } from "../../../../lib/security.ts";
import { assertPublicDnsHostname } from "../../../../lib/identity.ts";
import { hostPdsDomain } from "../../../../lib/host-friendly.ts";

const MAX_AVATAR_BYTES = 2_000_000;
const CACHE_CONTROL =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const hostId = decodeURIComponent(ctx.params.host).trim().toLowerCase();
    const { host } = await getHostDetailFromAppview(hostId).catch(() => ({
      host: null,
      claim: null,
    }));
    if (!host) return new Response("not found", { status: 404 });

    const [avatarDataUrl, handleIconDataUrl] = await Promise.all([
      host.avatarUrl
        ? loadAvatarDataUrl(host.avatarUrl, ctx.url.origin).catch(() => null)
        : null,
      loadAtmosphereHandleIconDataUrl(),
    ]);
    const png = await renderHostSocialCardPng({
      name: host.displayName,
      handle: host.profileHandle,
      domain: hostPdsDomain(host),
      avatarDataUrl,
      handleIconDataUrl,
    });
    const body = new Uint8Array(png.byteLength);
    body.set(png);
    return new Response(body.buffer, {
      headers: {
        "content-type": "image/png",
        "content-length": String(png.byteLength),
        "cache-control": CACHE_CONTROL,
        "content-disposition": "inline",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
        etag: `"host-${host.updatedAt}"`,
      },
    });
  }),
});

async function loadAvatarDataUrl(
  source: string,
  requestOrigin: string,
): Promise<string | null> {
  const url = new URL(source, requestOrigin);
  const sameOrigin = url.origin === requestOrigin;
  if (
    url.username || url.password ||
    (!sameOrigin && isPrivateNetworkUrl(url.toString())) ||
    (sameOrigin && url.pathname.startsWith("/api/og/"))
  ) return null;
  if (!sameOrigin) await assertPublicDnsHostname(url.hostname);

  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(3_500),
    headers: { accept: "image/png,image/jpeg,image/webp" },
  });
  if (!response.ok || response.status >= 300) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const mime = safeRasterImageMime(response.headers.get("content-type"));
  const bytes = await readRasterImageBytesWithLimit(response, MAX_AVATAR_BYTES);
  if (!mime || !bytes || !matchesRasterImageSignature(bytes, mime)) return null;
  return `data:${mime};base64,${bytes.toBase64()}`;
}
