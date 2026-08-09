/**
 * Forget a remembered account. Removes it from the per-device
 * `atmo_accounts` cookie and deletes the server-side OAuth session
 * row so the refresh token can no longer be used. If the account
 * being forgotten happens to be the currently active one, the app
 * session cookie is cleared as well so the user is signed out.
 */
import { define } from "../../utils.ts";
import { proxyAppviewApiResponse } from "../../lib/appview-client.ts";
import { deleteSession } from "../../lib/oauth.ts";
import {
  clearSessionCookie,
  destroySession,
  peekSessionUser,
} from "../../lib/session.ts";
import {
  readRememberedAccountsFromHeader,
  removeRememberedAccountCookies,
} from "../../lib/remembered-accounts.ts";
import { rejectLargeRequest } from "../../lib/security.ts";

const MAX_FORGET_BODY_BYTES = 8_192;

async function readDid(req: Request): Promise<string | null> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null) as
      | { did?: string }
      | null;
    return body?.did?.trim() ?? null;
  }
  const form = await req.formData().catch(() => null);
  if (!form) return null;
  const v = form.get("did");
  return typeof v === "string" ? v.trim() : null;
}

async function handle(ctx: { req: Request }): Promise<Response> {
  const url = new URL(ctx.req.url);
  const proxied = await proxyAppviewApiResponse(url, ctx.req).catch((err) =>
    appviewUnavailable("oauth forget", err)
  );
  if (proxied) return proxied;

  const large = rejectLargeRequest(ctx.req, MAX_FORGET_BODY_BYTES);
  if (large) return large;
  const did = await readDid(ctx.req);
  if (!did) return new Response("missing did", { status: 400 });

  const remembered = await readRememberedAccountsFromHeader(
    ctx.req.headers.get("cookie"),
  );

  /** Best-effort revoke of the server-side OAuth session row. We
   *  don't surface the error if the row was already gone — the
   *  user's intent is "remove this from my list" either way. */
  await deleteSession(did).catch(() => {});

  const headers = new Headers({ location: "/account" });
  for (const cookie of await removeRememberedAccountCookies(remembered, did)) {
    headers.append("set-cookie", cookie);
  }

  /** If they're forgetting the account they're currently signed in
   *  as, clear the live app session too. */
  const sessionUser = await peekSessionUser(ctx.req).catch(() => null);
  if (sessionUser?.did === did) {
    await destroySession(ctx.req).catch(() => {});
    headers.append("set-cookie", clearSessionCookie());
  }

  return new Response(null, { status: 303, headers });
}

export const handler = define.handlers({ POST: handle });

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Removing this account is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
