import { define } from "../../../../utils.ts";
import {
  EXAMPLE_ATPROTO_OAUTH_SCOPE,
  exampleAtprotoOAuthCallbackUri,
  exampleAtprotoOAuthClientId,
} from "../../../../lib/example-atproto-oauth.ts";

export const handler = define.handlers({
  GET(ctx): Response {
    const origin = ctx.url.origin;
    const clientId = exampleAtprotoOAuthClientId(origin);
    const body = {
      client_id: clientId,
      application_type: "web",
      client_name: "Atmosphere Login reference app",
      client_uri: new URL("/examples/atmosphere-login/app", origin).toString(),
      logo_uri: new URL("/union.svg", origin).toString(),
      tos_uri: origin,
      policy_uri: origin,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: [exampleAtprotoOAuthCallbackUri(origin)],
      scope: EXAMPLE_ATPROTO_OAUTH_SCOPE,
      dpop_bound_access_tokens: true,
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
      jwks_uri: new URL("/oauth/jwks.json", origin).toString(),
    };
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  },
});
