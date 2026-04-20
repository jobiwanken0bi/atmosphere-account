/**
 * Returns the signed-in user's app.bsky.actor.profile values (if any) so
 * the create-profile form can pre-fill name + description + avatar.
 */
import { define } from "../../../utils.ts";
import { loadSession } from "../../../lib/oauth.ts";
import { getBskyProfile } from "../../../lib/pds.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return new Response("not authenticated", { status: 401 });
    const session = await loadSession(user.did);
    if (!session) return new Response("session expired", { status: 401 });
    const profile = await getBskyProfile(session.pdsUrl, user.did).catch(() =>
      null
    );
    return new Response(
      JSON.stringify({
        did: user.did,
        handle: user.handle,
        bsky: profile,
      }),
      { headers: { "content-type": "application/json" } },
    );
  },
});
