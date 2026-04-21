/**
 * Gate every /admin/* route on the ADMIN_DIDS allowlist.
 *
 * Non-admin and signed-out callers see the same 404 we'd render for a
 * truly missing path, so we don't leak that the section exists.
 *
 * `/api/admin/*` lives under `/api`, not `/admin`, so it goes through
 * its own JSON-shaped gate (`requireAdminApi`).
 */
import { define } from "../../utils.ts";
import { isAdmin } from "../../lib/admin.ts";

export const handler = define.middleware((ctx) => {
  const user = ctx.state.user;
  if (!user) {
    const url = new URL(ctx.req.url);
    const next = url.pathname + url.search;
    return new Response(null, {
      status: 303,
      headers: { location: `/oauth/login?next=${encodeURIComponent(next)}` },
    });
  }
  if (!isAdmin(user.did)) {
    return new Response("not found", { status: 404 });
  }
  return ctx.next();
});
