import { define } from "../../../../utils.ts";
import {
  type AppSearchResult,
  searchAppDirectory,
} from "../../../../lib/app-directory.ts";
import { proxyAppviewResponse } from "../../../../lib/appview-client.ts";
import { EdgeStaleCache } from "../../../../lib/edge-cache.ts";

const appsHomeCache = new EdgeStaleCache<AppSearchResult>({
  freshMs: 60_000,
  staleMs: 5 * 60_000,
  maxEntries: 1,
});

export const handler = define.handlers({
  async GET(ctx): Promise<Response> {
    const proxied = await proxyAppviewResponse(ctx.url.pathname, ctx.url);
    if (proxied) return proxied;
    const result = await appsHomeCache.get("home", () =>
      searchAppDirectory({
        includeSections: true,
        includeApps: false,
        includeTotal: false,
        syncLegacy: false,
      }));
    return json(result, {
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
