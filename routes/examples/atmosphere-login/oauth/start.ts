import { define } from "../../../../utils.ts";
import {
  exampleOAuthLoginHint,
  isExampleOAuthConfigured,
  startExampleAtprotoOAuth,
} from "../../../../lib/example-atproto-oauth.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const loginHint = exampleOAuthLoginHint({
      handle: ctx.url.searchParams.get("handle"),
      did: ctx.url.searchParams.get("did"),
    });
    if (!loginHint) {
      return new Response("missing selected handle or DID", { status: 400 });
    }
    if (!isExampleOAuthConfigured(ctx.url.origin)) {
      return new Response(
        "Example OAuth is not configured on this deployment.",
        { status: 503 },
      );
    }
    try {
      const { redirectUrl } = await startExampleAtprotoOAuth(
        ctx.url.origin,
        loginHint,
      );
      return new Response(null, {
        status: 303,
        headers: { location: redirectUrl },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(`example OAuth start failed: ${message}`, {
        status: 400,
      });
    }
  },
});
