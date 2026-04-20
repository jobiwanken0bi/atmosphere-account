/**
 * /api/identity/preview?handle=<prefix or full handle>
 *
 * Typeahead for sign-in: uses Bluesky AppView `app.bsky.actor.searchActors` so
 * we can match from the first typed character (prefix / fuzzy), not only after
 * a complete atproto handle. Results are ranked so closer handle-prefix matches
 * float to the top as the query approaches a full handle.
 *
 * Optional: paste a full `did:…` — we resolve and return a single row.
 */

import { define } from "../../../utils.ts";
import { isDid, isHandle, resolveIdentity } from "../../../lib/identity.ts";
import { getBskyProfile } from "../../../lib/pds.ts";

const BSKY_SEARCH =
  "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors";

export interface PreviewMatch {
  did: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
}

interface PreviewSuccess {
  found: true;
  matches: PreviewMatch[];
}

interface PreviewMiss {
  found: false;
  reason: "invalid_handle" | "not_found";
}

type PreviewResponse = PreviewSuccess | PreviewMiss;

function json(
  body: PreviewResponse,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=15, s-maxage=30",
      ...(init.headers ?? {}),
    },
  });
}

function parseActor(a: unknown): PreviewMatch | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const did = typeof o.did === "string" ? o.did : "";
  const handle = typeof o.handle === "string" ? o.handle : "";
  if (!did || !handle) return null;
  const displayName = typeof o.displayName === "string"
    ? o.displayName
    : undefined;
  const avatarUrl = typeof o.avatar === "string" ? o.avatar : undefined;
  return { did, handle, displayName, avatarUrl };
}

/** Prefer exact handle, then handle prefix, then substring / display name. */
function rankMatches(query: string, matches: PreviewMatch[]): PreviewMatch[] {
  const q = query.toLowerCase();
  const score = (m: PreviewMatch): number => {
    const h = m.handle.toLowerCase();
    const dn = (m.displayName ?? "").toLowerCase();
    if (h === q) return 0;
    if (h.startsWith(q)) return 1;
    if (dn.startsWith(q)) return 2;
    if (h.includes(q)) return 3;
    if (dn.includes(q)) return 4;
    return 5;
  };
  return [...matches].sort((a, b) => {
    const diff = score(a) - score(b);
    if (diff !== 0) return diff;
    return a.handle.localeCompare(b.handle);
  });
}

async function searchActors(query: string): Promise<PreviewMatch[]> {
  const url = new URL(BSKY_SEARCH);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "12");
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`searchActors HTTP ${res.status}`);
  }
  const json = await res.json() as { actors?: unknown[] };
  const out: PreviewMatch[] = [];
  for (const a of json.actors ?? []) {
    const m = parseActor(a);
    if (m) out.push(m);
  }
  return out;
}

export const handler = define.handlers({
  async GET(ctx) {
    const raw = (ctx.url.searchParams.get("handle") ??
      ctx.url.searchParams.get("q") ?? "").trim()
      .replace(/^@/, "");
    if (!raw) {
      return json({ found: false, reason: "invalid_handle" });
    }

    // Pasted DID — single resolved row (not in search index the same way).
    if (isDid(raw)) {
      try {
        const identity = await resolveIdentity(raw);
        const profile = await getBskyProfile(identity.pdsUrl, identity.did);
        let avatarUrl: string | undefined;
        const cid = profile?.avatar?.ref?.$link;
        if (cid) {
          const u = new URL(
            `${
              identity.pdsUrl.replace(/\/$/, "")
            }/xrpc/com.atproto.sync.getBlob`,
          );
          u.searchParams.set("did", identity.did);
          u.searchParams.set("cid", cid);
          avatarUrl = u.toString();
        }
        return json({
          found: true,
          matches: [
            {
              did: identity.did,
              handle: identity.handle,
              displayName: profile?.displayName,
              avatarUrl,
            },
          ],
        });
      } catch {
        return json({ found: true, matches: [] });
      }
    }

    try {
      let matches = rankMatches(raw, await searchActors(raw));
      const exact = matches.some((m) => m.handle.toLowerCase() === raw);
      if (!exact && isHandle(raw)) {
        try {
          const identity = await resolveIdentity(raw);
          const profile = await getBskyProfile(identity.pdsUrl, identity.did);
          let avatarUrl: string | undefined;
          const cid = profile?.avatar?.ref?.$link;
          if (cid) {
            const u = new URL(
              `${
                identity.pdsUrl.replace(/\/$/, "")
              }/xrpc/com.atproto.sync.getBlob`,
            );
            u.searchParams.set("did", identity.did);
            u.searchParams.set("cid", cid);
            avatarUrl = u.toString();
          }
          matches = rankMatches(raw, [
            {
              did: identity.did,
              handle: identity.handle,
              displayName: profile?.displayName,
              avatarUrl,
            },
            ...matches.filter((m) => m.did !== identity.did),
          ]);
        } catch {
          /* keep search-only results */
        }
      }
      return json({ found: true, matches });
    } catch {
      return json({ found: false, reason: "not_found" });
    }
  },
});
