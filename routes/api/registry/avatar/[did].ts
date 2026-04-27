/**
 * Proxy + cache the avatar blob for a registry profile. We look up the
 * (pdsUrl, avatar_cid) pair from our own DB, then stream the bytes back
 * with long cache headers. Falls back to 404 if no avatar is set.
 */
import { define } from "../../../../utils.ts";
import { getProfileByDid } from "../../../../lib/registry.ts";
import { fetchBlobPublic } from "../../../../lib/pds.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

function bskyCdnAvatarUrl(did: string, cid: string): string {
  return `https://cdn.bsky.app/img/avatar/plain/${did}/${cid}`;
}

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = decodeURIComponent(ctx.params.did);
    const profile = await getProfileByDid(did).catch(() => null);
    if (!profile || !profile.avatarCid) {
      return new Response("not found", { status: 404 });
    }
    try {
      const upstream = await fetchBlobPublic(
        profile.pdsUrl,
        did,
        profile.avatarCid,
      );
      if (!upstream.ok) {
        return Response.redirect(bskyCdnAvatarUrl(did, profile.avatarCid), 302);
      }
      const headers = new Headers();
      const ct = upstream.headers.get("content-type") ?? profile.avatarMime ??
        "application/octet-stream";
      headers.set("content-type", ct);
      headers.set(
        "cache-control",
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      );
      headers.set("etag", profile.avatarCid);
      return new Response(upstream.body, { status: 200, headers });
    } catch (err) {
      console.warn("avatar proxy error:", err);
      return Response.redirect(bskyCdnAvatarUrl(did, profile.avatarCid), 302);
    }
  }),
});
