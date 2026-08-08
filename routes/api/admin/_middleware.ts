import { define } from "../../../utils.ts";
import { requireAdminApi } from "../../../lib/admin.ts";
import { proxyAppviewApiResponse } from "../../../lib/appview-client.ts";

export const handler = define.middleware(async (ctx) => {
  const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
    (err) => appviewUnavailable("admin API", err),
  );
  if (proxied) return proxied;
  const gate = requireAdminApi(ctx);
  if (!gate.ok) return gate.response;
  return ctx.next();
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response(JSON.stringify({ error: "appview_unavailable" }), {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
