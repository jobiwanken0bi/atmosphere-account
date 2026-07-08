import { define } from "../../../utils.ts";
import {
  exampleAtmosphereLoginCallbackUri,
  exampleAtmosphereLoginClientId,
  exampleAtmosphereLoginPopupCallbackUri,
} from "../../../lib/example-atproto-oauth.ts";

export const handler = define.handlers({
  GET(ctx): Response {
    const origin = ctx.url.origin;
    const body = {
      client_id: exampleAtmosphereLoginClientId(origin),
      client_name: "Atmosphere Login reference app",
      client_uri: new URL("/examples/atmosphere-login/app", origin).toString(),
      logo_uri: new URL("/app-icon.svg", origin).toString(),
      allowed_return_uris: [
        exampleAtmosphereLoginCallbackUri(origin),
        exampleAtmosphereLoginPopupCallbackUri(origin),
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
