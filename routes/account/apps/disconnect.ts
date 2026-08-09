import { define } from "../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../lib/appview-client.ts";
import { deleteLoginConnectionForAccount } from "../../../lib/atmosphere-login.ts";
import {
  readFormDataRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../lib/security.ts";

const MAX_DISCONNECT_BODY_BYTES = 8_192;

async function readClientId(req: Request): Promise<string | null> {
  const form = await readFormDataRequestWithLimit(
    req,
    MAX_DISCONNECT_BODY_BYTES,
  );
  const value = form?.get("client_id");
  return typeof value === "string" ? value.trim() : null;
}

export const handler = define.handlers({
  async POST(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("account app disconnect", err),
    );
    if (proxied) return proxied;

    const large = rejectLargeRequest(ctx.req, MAX_DISCONNECT_BODY_BYTES);
    if (large) return large;

    const user = ctx.state.user;
    if (!user) {
      return new Response(null, {
        status: 303,
        headers: { location: "/signin?next=/account" },
      });
    }

    let clientId: string | null;
    try {
      clientId = await readClientId(ctx.req);
    } catch (error) {
      return new Response(
        error instanceof RequestBodyTooLargeError
          ? "request body too large"
          : "invalid request",
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      );
    }
    if (!clientId) {
      return new Response("Missing connected app.", {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    try {
      await deleteLoginConnectionForAccount(user.did, clientId);
    } catch (err) {
      console.error("[account] connected app removal failed:", err);
      return new Response(
        "The connected app could not be removed. Try again.",
        {
          status: 503,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
        },
      );
    }

    return new Response(null, {
      status: 303,
      headers: { location: "/account#applications" },
    });
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Disconnecting this app is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
