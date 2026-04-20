/**
 * Public JWKS containing the ES256 verification key for our confidential
 * OAuth client. The corresponding private key is held in OAUTH_PRIVATE_JWK
 * and used to sign client_assertion JWTs during PAR + token requests.
 */
import { define } from "../../utils.ts";
import { OAUTH_PUBLIC_JWK } from "../../lib/env.ts";

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
      key = JSON.parse(OAUTH_PUBLIC_JWK);
    } catch {
      return new Response(
        JSON.stringify({ error: "OAUTH_PUBLIC_JWK is not valid JSON" }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ keys: [key] }, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=300",
      },
    });
  },
});
