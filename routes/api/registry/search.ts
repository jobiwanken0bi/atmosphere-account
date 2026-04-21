import { define } from "../../../utils.ts";
import { CATEGORIES } from "../../../lib/lexicons.ts";
import { searchProfiles } from "../../../lib/registry.ts";
import { toPublicProfileJson } from "../../../lib/public-profile.ts";
import { withRateLimit } from "../../../lib/rate-limit.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const url = ctx.url;
    const q = url.searchParams.get("q") ?? undefined;
    const categoryRaw = url.searchParams.get("category") ?? undefined;
    const category =
      categoryRaw && (CATEGORIES as readonly string[]).includes(categoryRaw)
        ? categoryRaw
        : undefined;
    const subcategory = url.searchParams.get("subcategory") ?? undefined;
    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const pageSize = Number(url.searchParams.get("pageSize") ?? "24") || 24;

    const origin = new URL(ctx.req.url).origin;
    const result = await searchProfiles({
      query: q,
      category,
      subcategory,
      page,
      pageSize,
    });
    const publicResult = {
      ...result,
      profiles: result.profiles.map((p) => toPublicProfileJson(p, origin)),
    };
    return new Response(JSON.stringify(publicResult), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=10, s-maxage=30",
      },
    });
  }),
});
