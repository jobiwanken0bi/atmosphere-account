import { define } from "../../../utils.ts";

export const handler = define.handlers({
  GET(ctx): Response {
    const origin = ctx.url.origin;
    const body = {
      client_id: new URL(
        "/examples/atmosphere-login/client-metadata.json",
        origin,
      ).toString(),
      client_name: "Atmosphere Login reference app",
      client_uri: new URL("/examples/atmosphere-login/app", origin).toString(),
      logo_uri: new URL("/union.svg", origin).toString(),
      allowed_return_uris: [
        new URL("/examples/atmosphere-login/callback", origin).toString(),
      ],
      note:
        "Reference metadata for the Atmosphere Login docs console. Production apps should register trusted return URIs with Atmosphere Account.",
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  },
});
