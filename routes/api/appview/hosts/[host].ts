import { define } from "../../../../utils.ts";
import {
  getPublicHostDetail,
  proxyAppviewResponse,
  type PublicHostDetail,
} from "../../../../lib/appview-client.ts";
import { EdgeStaleCache } from "../../../../lib/edge-cache.ts";

const hostDetailCache = new EdgeStaleCache<PublicHostDetail>({
  freshMs: 60_000,
  staleMs: 5 * 60_000,
  maxEntries: 256,
});

export const handler = define.handlers({
  async GET(ctx): Promise<Response> {
    const proxied = await proxyAppviewResponse(
      `${ctx.url.pathname}${ctx.url.search}`,
      ctx.url,
    );
    if (proxied) return proxied;

    const hostId = decodeURIComponent(ctx.params.host).toLowerCase();
    const detail = await hostDetailCache.get(
      hostId,
      () => getPublicHostDetail(hostId),
    );
    return json(detail, {
      status: detail.host ? 200 : 404,
      headers: {
        "cache-control": detail.host
          ? "public, max-age=60, stale-while-revalidate=300"
          : "public, max-age=15, stale-while-revalidate=60",
      },
    });
  },
});

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}
