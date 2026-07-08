import { define } from "../../../utils.ts";
import {
  listPublicAccountHosts,
  proxyAppviewResponse,
} from "../../../lib/appview-client.ts";
import { EdgeStaleCache } from "../../../lib/edge-cache.ts";
import type { AccountHost } from "../../../lib/account-hosts.ts";

const hostsCache = new EdgeStaleCache<AccountHost[]>({
  freshMs: 60_000,
  staleMs: 5 * 60_000,
  maxEntries: 128,
});

export const handler = define.handlers({
  async GET(ctx): Promise<Response> {
    const proxied = await proxyAppviewResponse(
      `${ctx.url.pathname}${ctx.url.search}`,
      ctx.url,
    );
    if (proxied) return proxied;
    const query = ctx.url.searchParams.get("q")?.trim() ?? "";
    const hosts = await hostsCache.get(
      query.toLowerCase(),
      () => listPublicAccountHosts({ query }),
    );
    return json(hosts, {
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
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
