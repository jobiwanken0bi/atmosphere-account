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
  type RememberedAccount,
  removeRememberedAccountCookies,
} from "../../lib/remembered-accounts.ts";
import {
  readFormDataRequestWithLimit,
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../lib/security.ts";
import { clearPasskeyManagementCookie } from "../../lib/passkey-management.ts";
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
  const proxied = await proxyAppviewApiResponse(url, ctx.req).catch((err) =>
    appviewUnavailable("oauth forget", err)
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

  // OAuth sessions are keyed only by DID, so accepting an arbitrary browser
  // value here would let an anonymous caller revoke another account's stored
  // refresh grant. Require proof that this browser either owns the active app
  // session or carries the signed remembered-account entry for the target.
  if (!canForgetOAuthSession(did, sessionUser, remembered)) {
    return new Response("account not remembered on this device", {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }

  // SQL deletion is already idempotent. A database failure is different from
  // an absent row: do not remove the browser's only visible account control
  // while silently leaving its durable refresh grant active server-side.
  if (!await revokeOAuthSessionForForget(did)) {
    return new Response("Removing this account is temporarily unavailable.", {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const headers = new Headers({ location: "/account" });
  headers.append("set-cookie", clearPasskeyManagementCookie());
  for (const cookie of await removeRememberedAccountCookies(remembered, did)) {
    headers.append("set-cookie", cookie);
  }

  /** If they're forgetting the account they're currently signed in
   *  as, clear the live app session too. */
  if (sessionUser?.did === did) {
    if (!await destroyActiveAppSessionForForget(ctx.req)) {
      return new Response("Removing this account is temporarily unavailable.", {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
        },
      });
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
