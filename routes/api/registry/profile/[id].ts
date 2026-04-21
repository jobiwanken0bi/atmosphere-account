/**
 * Public read endpoint: fetch a single registry profile by handle or DID.
 *
 *   GET /api/registry/profile/alice.bsky.social
 *   GET /api/registry/profile/did:plc:abc123...
 *
 * Returns a **public** projection (`PublicProfileJson`) — lexicon-shaped
 * fields plus identity, avatar URLs, and indexing metadata. Does not
 * include AppView moderation, SVG review, or verification-request fields.
 *
 * Adds synthesised convenience fields — `avatarUrl`, optional `iconUrl`,
 * and `verified` — aligned with what anonymous clients should see.
 */
import { define } from "../../../../utils.ts";
import {
  getProfileByDid,
  getProfileByHandle,
} from "../../../../lib/registry.ts";
import { toPublicProfileJson } from "../../../../lib/public-profile.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

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
    const body = toPublicProfileJson(profile, origin);

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
