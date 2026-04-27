/**
 * Compatibility endpoint for registry profile avatars. Primary UI paths use
 * the Bluesky CDN directly; this route redirects existing consumers there.
 */
import { define } from "../../../../utils.ts";
import { getAppUser } from "../../../../lib/account-types.ts";
import { bskyCdnAvatarUrl } from "../../../../lib/avatar.ts";
import { getProfileByDid } from "../../../../lib/registry.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = decodeURIComponent(ctx.params.did);
    const profile = await getProfileByDid(did).catch(() => null);
    const avatarCid = profile?.avatarCid ??
      (await getAppUser(did).catch(() => null))?.avatarCid;
    if (!avatarCid) {
      return new Response("not found", { status: 404 });
    }
    return new Response(null, {
      status: 302,
      headers: {
        location: bskyCdnAvatarUrl(did, avatarCid),
        "cache-control":
          "public, max-age=300, s-maxage=3600, stale-while-revalidate=3600",
      },
    });
  }),
});
