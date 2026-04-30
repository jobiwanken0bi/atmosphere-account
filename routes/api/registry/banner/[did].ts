/**
 * Compatibility endpoint for registry profile banners. Mirrors the
 * avatar route — primary UI paths can hit Bluesky's CDN directly via
 * `bskyCdnBannerUrl`; this route exists so external link unfurlers,
 * old embeds, or any consumer that just knows the DID can resolve the
 * banner without first looking up the cid.
 */
import { define } from "../../../../utils.ts";
import { bskyCdnBannerUrl } from "../../../../lib/avatar.ts";
import { getProfileByDid } from "../../../../lib/registry.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const did = decodeURIComponent(ctx.params.did);
    const profile = await getProfileByDid(did).catch(() => null);
    const bannerCid = profile?.bannerCid;
    if (!bannerCid) {
      return new Response("not found", { status: 404 });
    }
    return new Response(null, {
      status: 302,
      headers: {
        location: bskyCdnBannerUrl(did, bannerCid),
        "cache-control":
          "public, max-age=300, s-maxage=3600, stale-while-revalidate=3600",
      },
    });
  }),
});
