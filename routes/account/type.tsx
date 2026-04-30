/**
 * Legacy account-type chooser. The chooser modal has been retired —
 * sign-in intent now classifies new accounts automatically (default
 * sign-in = user; "Submit your project" = project) and existing users
 * who want to convert to a project use the upgrade modal on
 * /account/reviews.
 *
 * This route still exists so old bookmarks, hashed redirects from the
 * OAuth callback (in case any are still in flight from older deploys),
 * and any cached AccountMenu links resolve cleanly. It just routes
 * the request to the appropriate dashboard.
 */
import { define } from "../../utils.ts";
import {
  getEffectiveAccountType,
  setAppUserType,
} from "../../lib/account-types.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return new Response(null, {
        status: 303,
        headers: { location: "/explore/create" },
      });
    }

    const rawNext = ctx.url.searchParams.get("next");
    const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : null;

    let accountType = await getEffectiveAccountType(user.did).catch(() => null);
    /**
     * Legacy DIDs that signed in before the auto-classification rollout
     * may still be untyped. Default them to user, matching the new
     * sign-in flow's default, and route them to their dashboard.
     */
    if (accountType == null) {
      await setAppUserType({
        did: user.did,
        handle: user.handle,
        accountType: "user",
      }).catch(() => {});
      accountType = "user";
    }

    return new Response(null, {
      status: 303,
      headers: {
        location: next ??
          (accountType === "project" ? "/explore/manage" : "/account/reviews"),
      },
    });
  },
});
