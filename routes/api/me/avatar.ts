/**
 * Avatar for the currently signed-in user, used by the explore-page
 * AccountMenu. Resolution order:
 *
 *   1. Registry profile avatar (proxied through /api/registry/avatar/:did,
 *      so we benefit from its cache headers + ETag).
 *   2. Bluesky `app.bsky.actor.profile` avatar fetched from the user's
 *      PDS via getBlob — covers the case where the user has signed in
 *      but hasn't published a registry profile yet.
 *   3. 404 — the AccountMenu falls back to a handle-initial avatar.
 *
 * No request body, no params: identity comes from the session cookie via
 * `ctx.state.user`. Cached aggressively because avatars rarely change
 * and the registry/PDS endpoints already return long-lived blobs.
 */
import { define } from "../../../utils.ts";
import { getProfileByDid } from "../../../lib/registry.ts";
import { loadSession } from "../../../lib/oauth.ts";
import { fetchBlobPublic, getBskyProfile } from "../../../lib/pds.ts";

const NOT_FOUND = new Response("not found", { status: 404 });

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return NOT_FOUND;

    /** Prefer the registry-cached avatar — it's already proxied with
     *  long cache headers and an ETag, and works even if the user later
     *  signs out (still public). Internal redirect (303) keeps this
     *  route cheap; the browser follows once and then caches the
     *  resolved URL. */
    const profile = await getProfileByDid(user.did).catch(() => null);
    if (profile?.avatarCid) {
      return new Response(null, {
        status: 302,
        headers: {
          location: `/api/registry/avatar/${encodeURIComponent(user.did)}`,
          "cache-control": "private, max-age=300, stale-while-revalidate=86400",
        },
      });
    }

    /** No registry profile yet — fall back to the user's Bluesky avatar
     *  on their PDS, so the menu still shows something familiar after
     *  their first sign-in. We stream the bytes directly because the
     *  PDS getBlob URL isn't cacheable on its own (it's pinned to the
     *  CID though, so once we've seen it we can cache it here). */
    const session = await loadSession(user.did).catch(() => null);
    if (!session) return NOT_FOUND;
    const bsky = await getBskyProfile(session.pdsUrl, user.did).catch(() =>
      null
    );
    const cid = bsky?.avatar?.ref.$link;
    if (!bsky || !cid) return NOT_FOUND;

    try {
      const upstream = await fetchBlobPublic(session.pdsUrl, user.did, cid);
      if (!upstream.ok) return NOT_FOUND;
      const headers = new Headers();
      headers.set(
        "content-type",
        upstream.headers.get("content-type") ?? bsky.avatar?.mimeType ??
          "application/octet-stream",
      );
      headers.set(
        "cache-control",
        "private, max-age=600, stale-while-revalidate=86400",
      );
      headers.set("etag", cid);
      return new Response(upstream.body, { status: 200, headers });
    } catch {
      return NOT_FOUND;
    }
  },
});
