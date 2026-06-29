import { define } from "../../../../utils.ts";
import {
  buildExampleAppSessionCookie,
  exampleOAuthLoginHint,
  isExampleLocalDevSelection,
  isExampleOAuthConfigured,
  startExampleAtprotoOAuth,
} from "../../../../lib/example-atproto-oauth.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const handle = ctx.url.searchParams.get("handle");
    const did = ctx.url.searchParams.get("did");
    const loginHint = exampleOAuthLoginHint({
      handle,
      did,
    });
    if (!loginHint) {
      return new Response("missing selected handle or DID", { status: 400 });
    }
    if (isExampleLocalDevSelection({ handle, did })) {
      const normalizedHandle = handle?.trim().replace(/^@/, "").toLowerCase();
      const normalizedDid = did?.trim();
      if (!normalizedHandle || !normalizedDid) {
        return new Response(
          "Local dev OAuth simulation needs both handle and DID.",
          { status: 400 },
        );
      }
      const headers = new Headers({
        location:
          "/examples/atmosphere-login/app?signed_in=1&oauth=dev_simulated",
      });
      headers.append(
        "set-cookie",
        await buildExampleAppSessionCookie({
          did: normalizedDid,
          handle: normalizedHandle,
          pdsUrl: `https://${normalizedHandle}`,
          oauthMode: "dev_simulated",
        }),
      );
      return new Response(null, { status: 303, headers });
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
