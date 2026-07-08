import { define } from "../../utils.ts";
import { runtimeRelease } from "../../lib/release.ts";

export const handler = define.handlers({
  GET(): Response {
    return json({
      ok: true,
      service: "atmosphere-account-web",
      release: runtimeRelease(),
      timestamp: new Date().toISOString(),
    });
  },
});

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers ?? {}),
    },
  });
}
