/**
 * Update settings for the signed-in user's profile.
 * Bluesky-sourced name/bio/avatar are refreshed on sign-in; this endpoint
 * only stores local presentation choices such as preferred Bluesky client.
 */
import { define } from "../../../utils.ts";
import {
  getEffectiveAccountType,
  updateAppUserBskyClient,
} from "../../../lib/account-types.ts";
import { BSKY_CLIENT_IDS } from "../../../lib/bsky-clients.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return new Response("not authenticated", { status: 401 });
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "user") {
      return new Response("user account required", { status: 403 });
    }

    const form = await ctx.req.formData().catch(() => null);
    const rawClient = form?.get("bskyClientId");
    if (
      typeof rawClient !== "string" ||
      !BSKY_CLIENT_IDS.includes(rawClient as typeof BSKY_CLIENT_IDS[number])
    ) {
      return new Response("invalid Bluesky client", { status: 400 });
    }

    await updateAppUserBskyClient(user.did, rawClient);
    return new Response(null, {
      status: 303,
      headers: { location: "/account/reviews" },
    });
  },
});
