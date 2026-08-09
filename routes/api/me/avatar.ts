/**
 * Avatar for the currently signed-in user, used by the explore-page
 * AccountMenu. Resolution order:
 *
 *   1. A project account's legacy Atmosphere app-profile avatar.
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
import { proxyAppviewApiResponse } from "../../../lib/appview-client.ts";
import { getProfileByDid } from "../../../lib/registry.ts";
import { loadSession } from "../../../lib/oauth.ts";
import { bskyCdnAvatarUrl } from "../../../lib/avatar.ts";
import { getBskyProfile } from "../../../lib/pds.ts";

function notFound(): Response {
  return new Response("not found", { status: 404 });
}

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("account avatar", err),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) return notFound();

    /** Legacy app accounts still use the registry avatar for their project. */
    if (ctx.state.accountType === "project") {
      const profile = await getProfileByDid(user.did, {
        profileType: "project",
      }).catch(() => null);
      if (profile?.avatarCid) {
        return new Response(null, {
          status: 302,
          headers: {
            location: bskyCdnAvatarUrl(user.did, profile.avatarCid),
            "cache-control":
              "private, max-age=300, stale-while-revalidate=86400",
          },
        });
      }
    }

    /** Ordinary accounts use their Bluesky avatar. Project accounts fall back
     *  to it when their legacy app profile has no avatar. */
    const session = await loadSession(user.did).catch(() => null);
    if (!session) return notFound();
    const bsky = await getBskyProfile(session.pdsUrl, user.did).catch(() =>
      null
    );
    const cid = bsky?.avatar?.ref.$link;
    if (!bsky || !cid) return notFound();
    return new Response(null, {
      status: 302,
      headers: {
        location: bskyCdnAvatarUrl(user.did, cid),
        "cache-control": "private, max-age=600, stale-while-revalidate=86400",
      },
    });
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Avatar is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
