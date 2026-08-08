import { define } from "../../../../utils.ts";
import {
  type AppDirectorySort,
  type AppSearchResult,
  searchAppDirectory,
} from "../../../../lib/app-directory.ts";
import { proxyAppviewResponse } from "../../../../lib/appview-client.ts";
import { EdgeStaleCache } from "../../../../lib/edge-cache.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

const appSearchCache = new EdgeStaleCache<AppSearchResult>({
  freshMs: 30_000,
  staleMs: 2 * 60_000,
  maxEntries: 128,
});
const MAX_SEARCH_QUERY_LENGTH = 128;
const MAX_SEARCH_TAGS = 12;
const MAX_SEARCH_TAG_LENGTH = 64;
const MAX_SEARCH_PAGE = 1_000;

export const handler = define.handlers({
  GET: withRateLimit(async (ctx): Promise<Response> => {
    const proxied = await proxyAppviewResponse(
      `${ctx.url.pathname}${ctx.url.search}`,
      ctx.url,
      ctx.req.headers,
    );
    if (proxied) return proxied;
    const url = ctx.url;
    const input = readSearchInput(url.searchParams);
    if (!input) {
      return json({ error: "invalid_search" }, {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    const { query, tag, page } = input;
    const sort = readSort(url.searchParams.get("sort"));
    const result = await appSearchCache.get(
      cacheKey({ query, tag, sort, page }),
      () =>
        searchAppDirectory({
          query,
          tag: tag.length > 0 ? tag : undefined,
          sort,
          page,
          includeSections: false,
          syncLegacy: false,
        }),
    );
    return json(result, {
      headers: {
        "cache-control": "public, max-age=30, stale-while-revalidate=120",
      },
    });
  }, {
    scope: "appview-app-search",
    capacity: 60,
    refillMs: 60_000,
  }),
});

function readSort(value: string | null): AppDirectorySort {
  return value === "newest" || value === "az" ? value : "trending";
}

function readTags(searchParams: URLSearchParams): string[] {
  const tags = searchParams.getAll("tag").flatMap((tag) =>
    tag.split(",").map((part) => part.trim()).filter(Boolean)
  );
  return [...new Set(tags)];
}

function readSearchInput(
  searchParams: URLSearchParams,
): { query?: string; tag: string[]; page: number } | null {
  const rawQueries = searchParams.getAll("q");
  const rawPages = searchParams.getAll("page");
  const rawSorts = searchParams.getAll("sort");
  const rawTags = searchParams.getAll("tag");
  if (
    rawQueries.length > 1 || rawPages.length > 1 || rawSorts.length > 1 ||
    rawTags.length > MAX_SEARCH_TAGS ||
    rawTags.some((value) => value.length > 768)
  ) return null;
  const rawQuery = rawQueries[0] ?? "";
  if (rawQuery.length > MAX_SEARCH_QUERY_LENGTH) return null;
  const query = rawQuery.trim() || undefined;
  const tag = readTags(searchParams);
  if (
    tag.length > MAX_SEARCH_TAGS ||
    tag.some((value) => value.length > MAX_SEARCH_TAG_LENGTH)
  ) return null;
  const rawPage = rawPages[0] ?? null;
  if (rawPage && !/^\d{1,6}$/.test(rawPage)) return null;
  const page = Math.min(
    MAX_SEARCH_PAGE,
    Math.max(1, Number(rawPage ?? "1")),
  );
  return { query, tag, page };
}

export function readAppSearchInputForTest(
  searchParams: URLSearchParams,
): { query?: string; tag: string[]; page: number } | null {
  return readSearchInput(searchParams);
}

function cacheKey(input: {
  query?: string;
  tag: string[];
  sort: AppDirectorySort;
  page: number;
}): string {
  const tags = [...input.tag].sort();
  return JSON.stringify({
    q: input.query?.toLowerCase() ?? "",
    tag: tags,
    sort: input.sort,
    page: input.page,
  });
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}
