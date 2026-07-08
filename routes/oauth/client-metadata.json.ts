/**
 * Public OAuth client metadata document, fetched by atproto authorization
 * servers to identify and authenticate this confidential web client.
 *
 * Spec: https://atproto.com/specs/oauth#client-and-server-metadata
 */
import { define } from "../../utils.ts";
import { oauthClientConfigForRequest } from "../../lib/atmosphere-origins.ts";
import { siteOrigin } from "../../lib/env.ts";
import { DEFAULT_OAUTH_SCOPE } from "../../lib/oauth-scopes.ts";

export const handler = define.handlers({
  GET(ctx): Response {
    const oauth = oauthClientConfigForRequest(ctx.url, ctx.req.headers);
    const body = {
      client_id: oauth.clientId,
      application_type: "web",
      client_name: "Atmosphere Account Registry",
      client_uri: siteOrigin(),
      logo_uri: `${oauth.origin}/union.svg`,
      tos_uri: siteOrigin(),
      policy_uri: siteOrigin(),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: [oauth.redirectUri],
      scope: DEFAULT_OAUTH_SCOPE,
      dpop_bound_access_tokens: true,
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
      jwks_uri: oauth.jwksUri,
    };
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=300",
        "access-control-allow-origin": "*",
      },
    });
  },
});
