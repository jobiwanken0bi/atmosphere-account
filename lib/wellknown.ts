/**
 * Middleware that serves the registry lexicons at:
 *   - /.well-known/atproto-lexicon/<NSID>   (atproto convention)
 *   - /lexicons/<NSID>                       (convenience alias)
 *
 * Lives in middleware (rather than as a Fresh route) because Fresh's
 * filesystem routing doesn't accept `.well-known` as a directory name,
 * and NSIDs themselves contain dots that would be parsed as extensions.
 */
import { define } from "../utils.ts";
import { loadLexiconJson, REGISTRY_NSIDS } from "./lexicons.ts";

const WELL_KNOWN_PREFIX = "/.well-known/atproto-lexicon/";
const LEXICONS_PREFIX = "/lexicons/";

export const wellKnownMiddleware = define.middleware(async (ctx) => {
  const url = new URL(ctx.req.url);
  let nsid: string | null = null;

  if (url.pathname.startsWith(WELL_KNOWN_PREFIX)) {
    nsid = url.pathname.slice(WELL_KNOWN_PREFIX.length);
  } else if (url.pathname.startsWith(LEXICONS_PREFIX)) {
    nsid = url.pathname.slice(LEXICONS_PREFIX.length).replace(/\.json$/, "");
  }

  if (nsid === null) {
    return ctx.next();
  }

  if (!(REGISTRY_NSIDS as readonly string[]).includes(nsid)) {
    return new Response("not found", { status: 404 });
  }

  const json = await loadLexiconJson(nsid);
  if (!json) {
    return new Response("not found", { status: 404 });
  }
  return new Response(JSON.stringify(json, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=86400",
      "access-control-allow-origin": "*",
    },
  });
});
