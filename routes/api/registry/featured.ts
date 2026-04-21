import { define } from "../../../utils.ts";
import { listFeaturedProfiles } from "../../../lib/registry.ts";
import { withRateLimit } from "../../../lib/rate-limit.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const limit = Number(ctx.url.searchParams.get("limit") ?? "12") || 12;
    const profiles = await listFeaturedProfiles(
      Math.min(48, Math.max(1, limit)),
    );
    return new Response(JSON.stringify({ profiles }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=30, s-maxage=120",
      },
    });
  }),
});
