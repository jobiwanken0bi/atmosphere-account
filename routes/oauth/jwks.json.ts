/**
 * Public JWKS containing the ES256 verification key for our confidential
 * OAuth client. The corresponding private key is held in OAUTH_PRIVATE_JWK
 * and used to sign client_assertion JWTs during PAR + token requests.
 */
import { define } from "../../utils.ts";
import { OAUTH_PUBLIC_JWK } from "../../lib/env.ts";
import { parseJwkEnv } from "../../lib/jose.ts";

export const handler = define.handlers({
  GET(): Response {
    if (!OAUTH_PUBLIC_JWK) {
      return new Response(
        JSON.stringify({ keys: [] }),
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }
    let key: unknown;
    try {
      key = parseJwkEnv("OAUTH_PUBLIC_JWK", OAUTH_PUBLIC_JWK);
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ keys: [key] }, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=300",
        "access-control-allow-origin": "*",
      },
    });
  },
});
