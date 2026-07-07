import { define } from "../../../../utils.ts";
import { searchAppDirectory } from "../../../../lib/app-directory.ts";

export const handler = define.handlers({
  async GET(): Promise<Response> {
    const result = await searchAppDirectory({
      includeSections: true,
      includeApps: false,
      includeTotal: false,
      syncLegacy: false,
    });
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
