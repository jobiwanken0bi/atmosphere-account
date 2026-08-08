/**
 * Legacy account-type chooser. The chooser modal has been retired —
 * sign-in intent now classifies new accounts automatically (default
 * sign-in = user; "Register an app" = project) and existing users
 * who want to convert to a project use the upgrade modal on
 * /account/reviews.
 *
 * This route still exists so old bookmarks, hashed redirects from the
 * OAuth callback (in case any are still in flight from older deploys),
 * and any cached AccountMenu links resolve cleanly. It just routes
 * the request to the appropriate dashboard.
 */
import { define } from "../../utils.ts";
import { proxyAppviewPageResponse } from "../../lib/appview-client.ts";
import { getEffectiveAccountType } from "../../lib/account-types.ts";
import { isSafeRelativePath } from "../../lib/security.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("account type redirect", err),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) {
      return new Response(null, {
        status: 303,
        headers: { location: "/signin?next=/account" },
      });
    }

    const rawNext = ctx.url.searchParams.get("next");
    const next = rawNext && isSafeRelativePath(rawNext) ? rawNext : null;

    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    // Legacy untyped DIDs use the user landing without mutating account state
    // from this compatibility GET. Explicit type changes remain POST-only.
    return new Response(null, {
      status: 303,
      headers: {
        location: next ??
          (accountType === "project" ? "/apps/manage" : "/account"),
      },
    });
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Account setup is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
