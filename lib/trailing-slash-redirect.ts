/**
 * Many clients normalize URLs with a trailing slash. Our Fresh routes only
 * match paths without one, so `/explore/foo/` was a 404 — link unfurlers
 * (Bluesky Cardyb, Slack, etc.) then saw no HTML metadata and produced empty
 * preview cards. Redirect GET/HEAD to the canonical no-slash URL.
 */
import { define } from "../utils.ts";

export const trailingSlashRedirectMiddleware = define.middleware((ctx) => {
  if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") {
    return ctx.next();
  }
  const url = new URL(ctx.req.url);
  if (url.pathname.length <= 1 || !url.pathname.endsWith("/")) {
    return ctx.next();
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return Response.redirect(url.toString(), 308);
});
