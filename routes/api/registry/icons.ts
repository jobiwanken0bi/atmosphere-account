import { define } from "../../../utils.ts";
import { listApprovedSvgIconProfiles } from "../../../lib/registry.ts";
import { publicSvgIconDownload } from "../../../lib/svg-icon-downloads.ts";
import { withRateLimit } from "../../../lib/rate-limit.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const origin = new URL(ctx.req.url).origin;
    const profiles = await listApprovedSvgIconProfiles();
    const icons = profiles.map((profile) =>
      publicSvgIconDownload(profile, origin)
    );

    return new Response(JSON.stringify({ icons }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=10, s-maxage=30",
      },
    });
  }),
});
