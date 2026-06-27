import { define } from "../../utils.ts";

export const handler = define.handlers({
  GET(ctx) {
    return new Response(null, {
      status: 308,
      headers: { location: `/apps/manage${ctx.url.search}` },
    });
  },
});
