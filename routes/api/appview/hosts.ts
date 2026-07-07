import { define } from "../../../utils.ts";
import { listPublicAccountHosts } from "../../../lib/appview-client.ts";

export const handler = define.handlers({
  async GET(ctx): Promise<Response> {
    const query = ctx.url.searchParams.get("q")?.trim() ?? "";
    const hosts = await listPublicAccountHosts({ query });
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
