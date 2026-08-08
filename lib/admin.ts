/**
 * Admin allowlist + helpers.
 *
 * The list of admin DIDs is supplied via the `ADMIN_DIDS` env var
 * (comma-separated). All `/admin/*` pages are gated by
 * `routes/admin/_middleware.ts` which calls `requireAdmin`; admin API
 * routes under `/api/admin/*` should call `requireAdminApi` directly
 * because they need to return JSON 401/403 instead of an HTML redirect.
 *
 * Admins authenticate exactly like normal users (via the existing
 * atproto OAuth flow); admin status is purely a server-side allowlist
 * check on the resulting session DID.
 */
import { ADMIN_DIDS } from "./env.ts";
import { adminAuthorizationHref } from "./oauth-entry-context.ts";

export function isAdmin(did: string | null | undefined): boolean {
  if (!did) return false;
  return ADMIN_DIDS.includes(did);
}

/** Are any admins configured at all? Useful for hiding admin links from
 *  navigation in deployments that haven't opted in. */
export function adminConfigured(): boolean {
  return ADMIN_DIDS.length > 0;
}

interface AdminCtxLike {
  state: { user: { did: string } | null };
  req: Request;
}

/**
 * Throws via redirect to the contextual account picker when signed out.
 * Page routes should call `requireAdmin(ctx)` at the top of their handler.
 * Returns the verified admin DID on success.
 */
export function requireAdmin(ctx: AdminCtxLike): string {
  const user = ctx.state.user;
  if (!user) {
    throw redirectResponse(loginUrl(ctx.req.url));
  }
  if (!isAdmin(user.did)) {
    throw notFoundResponse();
  }
  return user.did;
}

/**
 * API-shaped admin gate. Returns `{ ok: false, response }` so handlers
 * can early-return; or `{ ok: true, did }` to proceed.
 */
export function requireAdminApi(
  ctx: AdminCtxLike,
):
  | { ok: true; did: string }
  | { ok: false; response: Response } {
  const user = ctx.state.user;
  if (!user) {
    return {
      ok: false,
      response: jsonResponse(401, { error: "not_authenticated" }),
    };
  }
  if (!isAdmin(user.did)) {
    return { ok: false, response: jsonResponse(403, { error: "forbidden" }) };
  }
  return { ok: true, did: user.did };
}

function loginUrl(currentUrl: string): string {
  try {
    return adminAuthorizationHref(new URL(currentUrl));
  } catch {
    return adminAuthorizationHref(
      new URL("https://atmosphere.invalid/admin"),
    );
  }
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

/** Surface admin routes as 404 to signed-in non-admin users. */
function notFoundResponse(): Response {
  return new Response("not found", { status: 404 });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
