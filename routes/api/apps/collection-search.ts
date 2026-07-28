import { proxyAppviewApiResponse } from "../../../lib/appview-client.ts";
import {
  normalizeCollectionSearchQuery,
  searchPublishedCollections,
} from "../../../lib/published-collection-catalog.ts";
import { define, withRateLimit } from "../../../lib/rate-limit.ts";

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (error) => {
        console.error("[appview] collection search proxy failed:", error);
        return jsonResponse(503, {
          suggestions: [],
          unavailable: true,
        }, { "cache-control": "no-store" });
      },
    );
    if (proxied) return proxied;

    const rawQuery = ctx.url.searchParams.get("q") ?? "";
    const query = normalizeCollectionSearchQuery(rawQuery);
    if (!query) {
      return jsonResponse(400, {
        error: "invalid_query",
        suggestions: [],
        unavailable: false,
      }, { "cache-control": "no-store" });
    }

    const result = await searchPublishedCollections(query, {
      signal: ctx.req.signal,
    });
    return jsonResponse(200, {
      query,
      suggestions: result.suggestions,
      unavailable: result.unavailable,
      source: "lexicon_garden",
    }, {
      "cache-control": result.unavailable
        ? "public, max-age=15"
        : "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    });
  }, {
    scope: "published-collection-search",
    capacity: 120,
    refillMs: 60_000,
  }),
});

function jsonResponse(
  status: number,
  body: unknown,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}
