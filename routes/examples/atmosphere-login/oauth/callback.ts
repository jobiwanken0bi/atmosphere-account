import { define } from "../../../../utils.ts";
import {
  buildExampleAppSessionCookie,
  completeExampleAtprotoOAuthCallback,
} from "../../../../lib/example-atproto-oauth.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const state = ctx.url.searchParams.get("state");
    const code = ctx.url.searchParams.get("code");
    const iss = ctx.url.searchParams.get("iss");
    const error = ctx.url.searchParams.get("error");
    if (error) {
      return new Response(`example authorization denied: ${error}`, {
        status: 400,
      });
    }
    if (!state || !code || !iss) {
      return new Response("missing state, code, or iss", { status: 400 });
    }
    try {
      const result = await completeExampleAtprotoOAuthCallback({
        state,
        code,
        iss,
      });
      const headers = new Headers({
        location: "/examples/atmosphere-login/app?signed_in=1",
      });
      headers.append(
        "set-cookie",
        await buildExampleAppSessionCookie({
          did: result.did,
          handle: result.handle,
          pdsUrl: result.pdsUrl,
        }),
      );
      return new Response(null, { status: 303, headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(`example callback failed: ${message}`, {
        status: 400,
      });
    }
  },
});
