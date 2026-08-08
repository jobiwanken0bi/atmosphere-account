import { define } from "../../../../utils.ts";
import {
  buildExampleAppSessionCookie,
  exampleOAuthLoginHint,
  isExampleLocalDevSelection,
  isExampleOAuthConfigured,
  startExampleAtprotoOAuth,
} from "../../../../lib/example-atproto-oauth.ts";
import { singleSearchValue } from "../../../../lib/oauth-request-input.ts";
import { buildOAuthFlowBindingCookie } from "../../../../lib/oauth-flow-binding.ts";

const MAX_EXAMPLE_OAUTH_START_QUERY_BYTES = 8_192;

export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.url.search.length > MAX_EXAMPLE_OAUTH_START_QUERY_BYTES) {
      return new Response("request URL too large", { status: 414 });
    }
    let handle: string | null;
    let did: string | null;
    try {
      handle = singleSearchValue(ctx.url.searchParams, "handle");
      did = singleSearchValue(ctx.url.searchParams, "did");
    } catch {
      return new Response("invalid selected account", { status: 400 });
    }
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
      const { redirectUrl, state, browserBinding } =
        await startExampleAtprotoOAuth(
          ctx.url.origin,
          loginHint,
        );
      const headers = new Headers({
        location: redirectUrl,
        "cache-control": "no-store",
      });
      headers.append(
        "set-cookie",
        buildOAuthFlowBindingCookie(state, browserBinding),
      );
      return new Response(null, {
        status: 303,
        headers,
      });
    } catch {
      // OAuth errors can retain private client-key material in their causes.
      console.warn("[example-oauth] start failed");
      return new Response("example OAuth start failed", {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
  },
});
