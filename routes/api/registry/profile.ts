/**
 * Authenticated registry profile mutations. The session must hold a
 * valid OAuth session for the authoring DID; we then write the record
 * directly to the user's PDS via DPoP-bound XRPC. The Jetstream-fed
 * indexer picks it up shortly after.
 *
 *   PUT     /api/registry/profile   (create or update one's own profile)
 *   DELETE  /api/registry/profile   (delete one's own profile)
 */
import { define } from "../../../utils.ts";
import { loadSession } from "../../../lib/oauth.ts";
import {
  deleteProfileRecord,
  putProfileRecord,
  uploadBlob,
} from "../../../lib/pds.ts";
import { type ProfileRecord, validateProfile } from "../../../lib/lexicons.ts";

interface ProfileFormPayload {
  name?: string;
  description?: string;
  category?: string;
  subcategories?: string[];
  website?: string;
  bskyClient?: string;
  tags?: string[];
  /** Either keep an existing avatar (passed as the BlobRef) or upload new bytes */
  avatar?: {
    $type: "blob";
    ref: { $link: string };
    mimeType: string;
    size: number;
  } | null;
  avatarUpload?: { dataBase64: string; mimeType: string };
}

function trimOrNull(s: unknown): string | undefined {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  return t.length === 0 ? undefined : t;
}

function asArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string =>
    typeof x === "string" && x.trim().length > 0
  )
    .map((x) => x.trim().slice(0, 32));
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export const handler = define.handlers({
  async PUT(ctx) {
    const user = ctx.state.user;
    if (!user) return new Response("not authenticated", { status: 401 });

    const session = await loadSession(user.did);
    if (!session) {
      return new Response("OAuth session expired, please sign in again", {
        status: 401,
      });
    }

    const body = await ctx.req.json().catch(() => null) as
      | ProfileFormPayload
      | null;
    if (!body) return new Response("invalid JSON body", { status: 400 });

    let avatar = body.avatar ?? undefined;
    if (body.avatarUpload?.dataBase64) {
      const bytes = decodeBase64(body.avatarUpload.dataBase64);
      if (bytes.byteLength > 1_000_000) {
        return new Response("avatar exceeds 1MB", { status: 400 });
      }
      try {
        avatar = await uploadBlob(
          user.did,
          session.pdsUrl,
          bytes,
          body.avatarUpload.mimeType,
        );
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        return new Response(`avatar upload failed: ${m}`, { status: 502 });
      }
    }

    const draft: ProfileRecord = {
      name: trimOrNull(body.name) ?? "",
      description: trimOrNull(body.description) ?? "",
      category: trimOrNull(body.category) ?? "",
      subcategories: asArray(body.subcategories),
      website: trimOrNull(body.website),
      bskyClient: trimOrNull(body.bskyClient),
      tags: asArray(body.tags),
      avatar: avatar ?? undefined,
      createdAt: new Date().toISOString(),
    };

    const validation = validateProfile(draft);
    if (!validation.ok || !validation.value) {
      return new Response(`invalid profile: ${validation.error}`, {
        status: 400,
      });
    }

    try {
      const result = await putProfileRecord(
        user.did,
        session.pdsUrl,
        validation.value,
      );
      return new Response(
        JSON.stringify({ ok: true, uri: result.uri, cid: result.cid }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return new Response(`putRecord failed: ${m}`, { status: 502 });
    }
  },

  async DELETE(ctx) {
    const user = ctx.state.user;
    if (!user) return new Response("not authenticated", { status: 401 });

    const session = await loadSession(user.did);
    if (!session) return new Response("OAuth session expired", { status: 401 });

    try {
      await deleteProfileRecord(user.did, session.pdsUrl);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return new Response(`deleteRecord failed: ${m}`, { status: 502 });
    }
  },
});
