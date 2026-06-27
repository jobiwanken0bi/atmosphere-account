import { define } from "../../utils.ts";

export const handler = define.handlers({
  GET(ctx) {
    const handle = encodeURIComponent(ctx.params.handle);
    return new Response(null, {
      status: 308,
      headers: { location: `/apps/${handle}${ctx.url.search}` },
    });
  },
});
