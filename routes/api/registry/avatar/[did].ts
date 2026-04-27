/**
 * Compatibility endpoint for registry profile avatars. Primary UI paths use
 * the Bluesky CDN directly; this route redirects existing consumers there.
 */
import { define } from "../../../../utils.ts";
import { bskyCdnAvatarUrl } from "../../../../lib/avatar.ts";
import { getProfileByDid } from "../../../../lib/registry.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = decodeURIComponent(ctx.params.did);
    const profile = await getProfileByDid(did).catch(() => null);
    if (!profile || !profile.avatarCid) {
      return new Response("not found", { status: 404 });
    }
    return new Response(null, {
      status: 302,
      headers: {
        location: bskyCdnAvatarUrl(did, profile.avatarCid),
        "cache-control":
          "public, max-age=300, s-maxage=3600, stale-while-revalidate=3600",
      },
    });
  }),
});
