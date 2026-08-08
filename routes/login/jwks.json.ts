import { define } from "../../utils.ts";
import { OAUTH_PUBLIC_JWK } from "../../lib/env.ts";
import { parseJwkEnv, publicJwkOnly } from "../../lib/jose.ts";

export const handler = define.handlers({
  GET(): Response {
    if (!OAUTH_PUBLIC_JWK) {
      return new Response(JSON.stringify({ keys: [] }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    try {
      const key = publicJwkOnly(
        parseJwkEnv("OAUTH_PUBLIC_JWK", OAUTH_PUBLIC_JWK),
      );
      return new Response(JSON.stringify({ keys: [key] }, null, 2), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=60, s-maxage=300",
          "access-control-allow-origin": "*",
        },
      });
    } catch {
      // Do not log the parser exception: a misconfigured public-key variable
      // may contain the private JWK that this endpoint is designed to strip.
      console.error("[login] invalid public JWK configuration");
      return new Response(
        JSON.stringify({ error: "jwks_unavailable" }),
        {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }
  },
});
