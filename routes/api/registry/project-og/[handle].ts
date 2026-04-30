/**
 * Same bytes as `/api/registry/og-banner/{did}`, but keyed by registry handle.
 * Used in HTML `og:image` so unfurlers see a short URL without `%3A` / DID
 * encoding (Cardyb double-encodes the inner URL).
 */
import { define } from "../../../../utils.ts";
import { getProfileByHandle } from "../../../../lib/registry.ts";
import { buildOgBannerResponse } from "../../../../lib/og-banner-serve.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const handle = decodeURIComponent(ctx.params.handle).toLowerCase();
    const profile = await getProfileByHandle(handle).catch(() => null);
    if (!profile?.bannerCid) {
      return new Response("not found", { status: 404 });
    }
    const res = await buildOgBannerResponse(profile);
    if (!res) return new Response("not found", { status: 404 });
    return res;
  }),
});
