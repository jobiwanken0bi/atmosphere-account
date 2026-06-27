import { define } from "../../utils.ts";
import { OAUTH_PUBLIC_JWK } from "../../lib/env.ts";
import { parseJwkEnv } from "../../lib/jose.ts";

export const handler = define.handlers({
  GET(): Response {
    if (!OAUTH_PUBLIC_JWK) {
      return new Response(JSON.stringify({ keys: [] }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    try {
      const key = parseJwkEnv("OAUTH_PUBLIC_JWK", OAUTH_PUBLIC_JWK);
      return new Response(JSON.stringify({ keys: [key] }, null, 2), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=60, s-maxage=300",
          "access-control-allow-origin": "*",
        },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
  },
});
