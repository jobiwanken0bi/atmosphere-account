import { define } from "../../utils.ts";
import { ATMOSPHERE_LOGIN_MANIFEST_VERSION } from "../../lib/atmosphere-login.ts";

export const handler = define.handlers({
  GET(ctx) {
    const origin = ctx.url.origin;
    const body = {
      version: ATMOSPHERE_LOGIN_MANIFEST_VERSION,
      apps: [
        {
          client_id: new URL(
            "/examples/atmosphere-login/client-metadata.json",
            origin,
          ).toString(),
          app_name: "Atmosphere Login reference app",
          homepage: new URL("/examples/atmosphere-login/app", origin)
            .toString(),
          logo_uri: new URL("/union.svg", origin).toString(),
          allowed_return_uris: [
            new URL("/examples/atmosphere-login/callback", origin).toString(),
          ],
        },
      ],
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  },
});
