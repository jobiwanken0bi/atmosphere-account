/**
 * Avatar for the currently signed-in user, used by the explore-page
 * AccountMenu. Resolution order:
 *
 *   1. Registry profile avatar redirected to the Bluesky CDN.
 *   2. Bluesky `app.bsky.actor.profile` avatar redirected to the same CDN —
 *      covers the case where the user has signed in but hasn't published a
 *      registry profile yet.
 *   3. 404 — the AccountMenu falls back to a handle-initial avatar.
 *
 * No request body, no params: identity comes from the session cookie via
 * `ctx.state.user`. Cached aggressively because avatars rarely change
 * and the registry/PDS endpoints already return long-lived blobs.
 */
import { define } from "../../../utils.ts";
import { getProfileByDid } from "../../../lib/registry.ts";
import { loadSession } from "../../../lib/oauth.ts";
import { bskyCdnAvatarUrl } from "../../../lib/avatar.ts";
import { getBskyProfile } from "../../../lib/pds.ts";

const NOT_FOUND = new Response("not found", { status: 404 });

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return NOT_FOUND;

    /** Prefer the registry avatar. This route stays per-session for cache
     *  busting, but the image bytes come from Bluesky's CDN. */
    const profile = await getProfileByDid(user.did).catch(() => null);
    if (profile?.avatarCid) {
      return new Response(null, {
        status: 302,
        headers: {
          location: bskyCdnAvatarUrl(user.did, profile.avatarCid),
          "cache-control": "private, max-age=300, stale-while-revalidate=86400",
        },
      });
    }

    /** No registry profile yet — fall back to the user's Bluesky avatar so
     *  the menu still shows something familiar after their first sign-in. */
    const session = await loadSession(user.did).catch(() => null);
    if (!session) return NOT_FOUND;
    const bsky = await getBskyProfile(session.pdsUrl, user.did).catch(() =>
      null
    );
    const cid = bsky?.avatar?.ref.$link;
    if (!bsky || !cid) return NOT_FOUND;
    return new Response(null, {
      status: 302,
      headers: {
        location: bskyCdnAvatarUrl(user.did, cid),
        "cache-control": "private, max-age=600, stale-while-revalidate=86400",
      },
    });
  },
});
