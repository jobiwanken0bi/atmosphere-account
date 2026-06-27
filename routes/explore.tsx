import { define } from "../utils.ts";

function redirectToApps(url: URL): Response {
  const target = new URL(url);
  target.pathname = "/apps";
  return new Response(null, {
    status: 308,
    headers: { location: `${target.pathname}${target.search}` },
  });
}

export const handler = define.handlers({
  GET(ctx) {
    return redirectToApps(ctx.url);
  },
});
