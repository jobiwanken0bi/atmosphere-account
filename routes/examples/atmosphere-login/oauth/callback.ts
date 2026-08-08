import { define } from "../../../../utils.ts";
import {
  buildExampleAppSessionCookie,
  cancelExampleAtprotoOAuth,
  completeExampleAtprotoOAuthCallback,
} from "../../../../lib/example-atproto-oauth.ts";
import {
  InvalidOAuthRequestInputError,
  singleSearchValue,
} from "../../../../lib/oauth-request-input.ts";
import {
  clearOAuthFlowBindingCookie,
  readOAuthFlowBindingCookie,
} from "../../../../lib/oauth-flow-binding.ts";

const MAX_EXAMPLE_CALLBACK_QUERY_BYTES = 16_384;

export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.url.search.length > MAX_EXAMPLE_CALLBACK_QUERY_BYTES) {
      return new Response("invalid callback", { status: 414 });
    }
    let state: string | null;
    let code: string | null;
    let iss: string | null;
    let error: string | null;
    try {
      state = singleSearchValue(ctx.url.searchParams, "state");
      code = singleSearchValue(ctx.url.searchParams, "code");
      iss = singleSearchValue(ctx.url.searchParams, "iss");
      error = singleSearchValue(ctx.url.searchParams, "error");
      if (error !== null && code !== null) {
        throw new InvalidOAuthRequestInputError();
      }
    } catch {
      return new Response("invalid callback", { status: 400 });
    }
    if (!state) {
      return new Response("missing state, code, or iss", { status: 400 });
    }
    const browserBinding = readOAuthFlowBindingCookie(ctx.req, state);
    if (!browserBinding) {
      return new Response("example callback browser mismatch", {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    if (error) {
      await cancelExampleAtprotoOAuth(
        state,
        ctx.url.origin,
        browserBinding,
      ).catch(() => false);
      return clearFlowCookie(
        new Response("example authorization denied", { status: 400 }),
        state,
      );
    }
    if (!code || !iss) {
      return clearFlowCookie(
        new Response("missing state, code, or iss", { status: 400 }),
        state,
      );
    }
    try {
      const result = await completeExampleAtprotoOAuthCallback({
        state,
        code,
        iss,
        origin: ctx.url.origin,
        browserBinding,
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
      const flowCookie = clearOAuthFlowBindingCookie(state);
      if (flowCookie) headers.append("set-cookie", flowCookie);
      return new Response(null, { status: 303, headers });
    } catch {
      await cancelExampleAtprotoOAuth(
        state,
        ctx.url.origin,
        browserBinding,
      ).catch(() => false);
      // OAuth errors can retain private keys and token exchange payloads.
      console.warn("[example-oauth] callback failed");
      return clearFlowCookie(
        new Response("example callback failed", {
          status: 400,
          headers: { "cache-control": "no-store" },
        }),
        state,
      );
    }
  },
});

function clearFlowCookie(response: Response, state: string): Response {
  const cookie = clearOAuthFlowBindingCookie(state);
  if (cookie) response.headers.append("set-cookie", cookie);
  return response;
}
