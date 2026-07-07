import { define } from "../../../../utils.ts";
import {
  type AppDirectorySort,
  searchAppDirectory,
} from "../../../../lib/app-directory.ts";
import { proxyAppviewResponse } from "../../../../lib/appview-client.ts";

export const handler = define.handlers({
  async GET(ctx): Promise<Response> {
    const proxied = await proxyAppviewResponse(
      `${ctx.url.pathname}${ctx.url.search}`,
      ctx.url,
    );
    if (proxied) return proxied;
    const url = ctx.url;
    const query = url.searchParams.get("q")?.trim() || undefined;
    const tag = readTags(url.searchParams);
    const sort = readSort(url.searchParams.get("sort"));
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const result = await searchAppDirectory({
      query,
      tag: tag.length > 0 ? tag : undefined,
      sort,
      page,
      includeSections: false,
      syncLegacy: false,
    });
    return json(result, {
      headers: {
        "cache-control": "public, max-age=30, stale-while-revalidate=120",
      },
    });
  },
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

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}
