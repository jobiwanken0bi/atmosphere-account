import { define } from "../utils.ts";
import { IS_DEV } from "./env.ts";

const SDK_ASSETS = new Map([
  ["/atmosphere-login.js", "static/atmosphere-login.js"],
  ["/atmosphere-login-server.js", "static/atmosphere-login-server.js"],
]);

export const sdkAssetMiddleware = define.middleware(async (ctx) => {
  if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") {
    return ctx.next();
  }
  const asset = SDK_ASSETS.get(ctx.url.pathname);
  if (!asset) return ctx.next();

  const body = ctx.req.method === "HEAD" ? null : await Deno.readFile(asset);
  return new Response(body, {
    status: 200,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": IS_DEV
        ? "no-store"
        : "public, max-age=300, s-maxage=3600",
      "content-type": "text/javascript; charset=utf-8",
    },
  });
});
