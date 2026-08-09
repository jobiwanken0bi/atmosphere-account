/**
 * Compatibility redirect for the retired Atmosphere user-profile surface.
 *
 * Regular reviewers use their existing microblog identity; Atmosphere only
 * owns public profiles for apps and hosts. Keep old `/users/:handle` links
 * useful without reading or deleting any historical registry records.
 */
import { define } from "../../utils.ts";
import { getProfileMicroblogViewer } from "../../lib/bsky-clients.ts";
import { isDid, isHandle } from "../../lib/identity.ts";

export function legacyUserProfileRedirect(
  raw: string | undefined,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw ?? "").trim().replace(/^@/, "");
  } catch {
    return null;
  }
  const identifier = isDid(decoded) ? decoded : decoded.toLowerCase();
  if (!isDid(identifier) && !isHandle(identifier)) return null;
  return getProfileMicroblogViewer(null).profileUrl(identifier);
}

export const handler = define.handlers({
  GET(ctx) {
    const location = legacyUserProfileRedirect(ctx.params.handle);
    if (!location) {
      return new Response("user not found", {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }
    return new Response(null, {
      status: 302,
      headers: {
        location,
        "cache-control": "private, no-store",
      },
    });
  },
});
