/**
 * Compatibility endpoint for registry profile avatars. Primary UI paths use
 * the Bluesky CDN directly; this route redirects existing consumers there.
 */
import { define } from "../../../../utils.ts";
import { getAppUser } from "../../../../lib/account-types.ts";
import { bskyCdnAvatarUrl } from "../../../../lib/avatar.ts";
import { devPickerAvatarUrl } from "../../../../lib/dev-picker-demo.ts";
import { IS_DEV } from "../../../../lib/env.ts";
import { getProfileByDid } from "../../../../lib/registry.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

const EMPTY_AVATAR_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>`;

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = decodeURIComponent(ctx.params.did);
    const devAvatar = IS_DEV ? devPickerAvatarUrl(did) : null;
    if (devAvatar) {
      return new Response(null, {
        status: 302,
        headers: {
          location: devAvatar,
          "cache-control": "no-store",
        },
      });
    }
    const profile = await getProfileByDid(did).catch(() => null);
    const avatarCid = profile?.avatarCid ??
      (await getAppUser(did).catch(() => null))?.avatarCid;
    if (!avatarCid) {
      return new Response(EMPTY_AVATAR_SVG, {
        status: 200,
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "public, max-age=60, s-maxage=300",
        },
      });
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
