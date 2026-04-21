/**
 * Public read endpoint: fetch a single registry profile by handle or DID.
 *
 *   GET /api/registry/profile/alice.bsky.social
 *   GET /api/registry/profile/did:plc:abc123...
 *
 * Returns the same `ProfileRow` shape that powers the SSR
 * `/explore/[handle]` page so the public response stays in sync with
 * the rendered profile view.
 *
 * Adds one synthesised convenience field — `avatarUrl` — derived from
 * the request origin so callers don't have to know about the
 * `/api/registry/avatar/<did>` proxy route. `null` when the profile
 * has no avatar set.
 */
import { define } from "../../../../utils.ts";
import {
  getProfileByDid,
  getProfileByHandle,
  type ProfileRow,
} from "../../../../lib/registry.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

interface PublicProfileResponse extends ProfileRow {
  /** Fully-qualified URL for the profile's avatar, or null if unset. */
  avatarUrl: string | null;
  /**
   * Fully-qualified URL for the profile's developer-facing SVG icon,
   * or null if unset / pending review / rejected. Served as
   * `image/svg+xml` with strict CSP + `nosniff`; safe for `<img src>`
   * embedding.
   *
   * SDK consumers that want to hint at pending/rejected state should
   * read `iconStatus` directly.
   */
  iconUrl: string | null;
}

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const raw = decodeURIComponent(ctx.params.id ?? "").trim();
    if (!raw) {
      return jsonError(400, "missing_id");
    }

    // DIDs always start with `did:`; everything else is treated as a
    // handle. We don't normalise handles to lowercase here because the
    // DB stores them lowercase already and Fresh routes are
    // case-sensitive — callers should match the registry's canonical
    // lowercase form.
    const profile = raw.startsWith("did:")
      ? await getProfileByDid(raw).catch(() => null)
      : await getProfileByHandle(raw.toLowerCase()).catch(() => null);

    if (!profile) {
      return jsonError(404, "not_found");
    }

    const origin = new URL(ctx.req.url).origin;
    const body: PublicProfileResponse = {
      ...profile,
      avatarUrl: profile.avatarCid
        ? `${origin}/api/registry/avatar/${encodeURIComponent(profile.did)}`
        : null,
      iconUrl: profile.iconCid && profile.iconStatus === "approved"
        ? `${origin}/api/registry/icon/${encodeURIComponent(profile.did)}`
        : null,
    };

    return new Response(JSON.stringify(body), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=30, s-maxage=120",
      },
    });
  }),
});

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
