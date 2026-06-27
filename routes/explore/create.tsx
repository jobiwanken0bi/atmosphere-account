import { define } from "../../utils.ts";

export const handler = define.handlers({
  GET(ctx) {
    return redirect(ctx.url);
  },
  POST(ctx) {
    return redirect(ctx.url);
  },
});

function redirect(url: URL): Response {
  return new Response(null, {
    status: 308,
    headers: { location: `/apps/create${url.search}` },
  });
}
