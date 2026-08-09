/** Remove a remembered account and its durable OAuth refresh grant. */
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
  type RememberedAccount,
  removeRememberedAccountCookies,
} from "../../lib/remembered-accounts.ts";
import {
  readFormDataRequestWithLimit,
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../lib/security.ts";
import {
  InvalidOAuthRequestInputError,
  optionalJsonString,
  plainJsonRecord,
  singleFormString,
} from "../../lib/oauth-request-input.ts";

const MAX_FORGET_BODY_BYTES = 8_192;

async function readDid(req: Request): Promise<string | null> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const body = plainJsonRecord(
      await readJsonRequestWithLimit(req, MAX_FORGET_BODY_BYTES),
    );
    return optionalJsonString(body, "did")?.trim() || null;
  }
  const form = await readFormDataRequestWithLimit(
    req,
    MAX_FORGET_BODY_BYTES,
  );
  if (!form) throw new InvalidOAuthRequestInputError();
  return singleFormString(form, "did")?.trim() || null;
}

async function handle(ctx: { req: Request }): Promise<Response> {
  const url = new URL(ctx.req.url);
  const proxied = await proxyAppviewApiResponse(url, ctx.req).catch(() =>
    appviewUnavailable()
  );
  if (proxied) return proxied;

  const large = rejectLargeRequest(ctx.req, MAX_FORGET_BODY_BYTES);
  if (large) return large;
  let did: string | null;
  try {
    did = await readDid(ctx.req);
  } catch (error) {
    return new Response(
      error instanceof RequestBodyTooLargeError
        ? "request body too large"
        : "invalid request",
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!did) return new Response("missing did", { status: 400 });

  const remembered = await readRememberedAccountsFromHeader(
    ctx.req.headers.get("cookie"),
  );
  const sessionUser = await peekSessionUser(ctx.req).catch(() => null);
  // OAuth sessions are keyed only by DID. Never let an arbitrary browser
  // value revoke another account's stored refresh grant.
  if (!canForgetOAuthSession(did, sessionUser, remembered)) {
    return new Response("account not remembered on this device", {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }
  if (!await revokeOAuthSessionForForget(did)) {
    return appviewUnavailable();
  }

  const headers = new Headers({ location: "/account" });
  for (const cookie of await removeRememberedAccountCookies(remembered, did)) {
    headers.append("set-cookie", cookie);
  }
  if (sessionUser?.did === did) {
    if (!await destroyActiveAppSessionForForget(ctx.req)) {
      return appviewUnavailable();
    }
    headers.append("set-cookie", clearSessionCookie());
  }
  return new Response(null, { status: 303, headers });
}

export function canForgetOAuthSession(
  did: string,
  sessionUser: { did: string } | null,
  remembered: readonly Pick<RememberedAccount, "did">[],
): boolean {
  return sessionUser?.did === did ||
    remembered.some((account) => account.did === did);
}

export async function revokeOAuthSessionForForget(
  did: string,
  revoke: (did: string) => Promise<void> = deleteSession,
): Promise<boolean> {
  try {
    await revoke(did);
    return true;
  } catch {
    return false;
  }
}

export async function destroyActiveAppSessionForForget(
  req: Request,
  destroy: (req: Request) => Promise<void> = destroySession,
): Promise<boolean> {
  try {
    await destroy(req);
    return true;
  } catch {
    return false;
  }
}

export const handler = define.handlers({ POST: handle });

function appviewUnavailable(): Response {
  console.error("[appview] OAuth forget operation unavailable");
  return new Response("Removing this account is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
