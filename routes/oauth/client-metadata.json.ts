/**
 * Public OAuth client metadata document, fetched by atproto authorization
 * servers to identify and authenticate this confidential web client.
 *
 * Spec: https://atproto.com/specs/oauth#client-and-server-metadata
 */
import { define } from "../../utils.ts";
import { clientId, jwksUri, redirectUri } from "../../lib/env.ts";

export const handler = define.handlers({
  GET(): Response {
    const body = {
      client_id: clientId(),
      application_type: "web",
      client_name: "Atmosphere Account Registry",
      client_uri: clientId().replace(/\/oauth\/client-metadata\.json$/, ""),
      logo_uri: clientId().replace(
        /\/oauth\/client-metadata\.json$/,
        "/union.svg",
      ),
      tos_uri: clientId().replace(/\/oauth\/client-metadata\.json$/, ""),
      policy_uri: clientId().replace(/\/oauth\/client-metadata\.json$/, ""),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: [redirectUri()],
      /**
       * Minimum-permission scope: only writes to our own profile
       * collection plus image-blob uploads (for avatars). The
       * permission-set lexicon is published at
       *   /.well-known/atproto-lexicon/com.atmosphereaccount.registry.fullPermissions
       * and rendered in the consent dialog via its title/detail.
       *
       * Inline-form equivalent (kept as a reference for maintainers):
       *   atproto repo:com.atmosphereaccount.registry.profile blob:image/*
       */
      scope:
        "atproto include:com.atmosphereaccount.registry.fullPermissions",
      dpop_bound_access_tokens: true,
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
      jwks_uri: jwksUri(),
    };
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=300",
      },
    });
  },
});
