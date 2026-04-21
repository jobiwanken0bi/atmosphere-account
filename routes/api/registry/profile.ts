/**
 * Authenticated registry profile mutations. The session must hold a
 * valid OAuth session for the authoring DID; we then write the profile
 * record directly to the user's PDS via DPoP-bound XRPC and mirror it
 * into the local index. The Jetstream-fed indexer picks up the same
 * write shortly after for any other consumers of the registry.
 *
 *   PUT     /api/registry/profile   (create/update profile)
 *   DELETE  /api/registry/profile   (delete profile)
 */
import { define } from "../../../utils.ts";
import { loadSession } from "../../../lib/oauth.ts";
import {
  deleteProfileRecord,
  putProfileRecord,
  uploadBlob,
} from "../../../lib/pds.ts";
import {
  ATMOSPHERE_LINK_KINDS,
  type LinkEntry,
  type ProfileRecord,
  validateProfile,
} from "../../../lib/lexicons.ts";
import {
  deleteProfile,
  getProfileByDid,
  upsertProfile,
} from "../../../lib/registry.ts";
import { sanitizeSvgBytes } from "../../../lib/svg-sanitize.ts";

const ICON_MAX_BYTES = 200_000;

interface LinkPayload {
  kind?: string;
  url?: string;
  clientId?: string;
  label?: string;
}

interface ProfileFormPayload {
  name?: string;
  description?: string;
  /** Primary destination URL for the profile card. Required by the
   *  registry; the form enforces this, the API double-checks. */
  mainLink?: string;
  /** Required multi-select. The first entry is the primary category. */
  categories?: string[];
  subcategories?: string[];
  links?: LinkPayload[];
  /** Either keep an existing avatar (passed as the BlobRef) or upload new bytes */
  avatar?: {
    $type: "blob";
    ref: { $link: string };
    mimeType: string;
    size: number;
  } | null;
  avatarUpload?: { dataBase64: string; mimeType: string };
  /**
   * Developer-facing SVG icon. Same shape as `avatar`: pass the
   * existing BlobRef to keep, `null` to clear, or `iconUpload` to
   * replace.
   */
  icon?: {
    $type: "blob";
    ref: { $link: string };
    mimeType: string;
    size: number;
  } | null;
  iconUpload?: { dataBase64: string; mimeType: string };
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

/**
 * Coerce the form's `links` payload into the lexicon shape. We do
 * minimal cleanup here (trim + drop entries that don't carry the
 * fields they need); deeper validation happens in `validateProfile`.
 */
function normalizeLinksPayload(input: unknown): LinkEntry[] {
  if (!Array.isArray(input)) return [];
  const out: LinkEntry[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as LinkPayload;
    const kind = trimOrNull(e.kind);
    if (!kind) continue;

    const entry: LinkEntry = { kind };
    const url = trimOrNull(e.url);
    if (url) entry.url = url;
    const clientId = trimOrNull(e.clientId);
    if (clientId) entry.clientId = clientId;
    const label = trimOrNull(e.label);
    if (label) entry.label = label;

    // Skip entries that obviously can't render: non-atmosphere kinds
    // need a url; bsky needs a clientId. The lexicon validator below
    // will surface cleaner errors for malformed entries that slip
    // through, but dropping the no-op ones here keeps "Save" idempotent
    // when the form hasn't filled a row in yet.
    const isAtmosphere = (ATMOSPHERE_LINK_KINDS as readonly string[]).includes(
      kind,
    );
    if (!isAtmosphere && !entry.url) continue;
    if (kind === "bsky" && !entry.clientId) continue;

    out.push(entry);
  }
  return out;
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

    /**
     * Refuse to publish updates while the profile is taken down. The
     * upsert below would also preserve the takedown via the SQL CASE
     * branch, but that means the user would see a confusing "Saved!"
     * for a record we still won't serve. Surface a clear 403 instead.
     * The user can still DELETE the record from their PDS — that path
     * removes the row and clears the takedown along with it (so a
     * later republish would face the report queue afresh, which is
     * fine).
     */
    const existing = await getProfileByDid(user.did, { includeTakenDown: true })
      .catch(() => null);
    if (existing?.takedownStatus === "taken_down") {
      return new Response(
        "This profile has been taken down by an Atmosphere admin. " +
          "You can delete it from your PDS, but you can't update it.",
        { status: 403 },
      );
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

    /**
     * Developer-facing SVG icon. We sanitise the bytes before upload
     * (strips <script>, on*, foreignObject, javascript: hrefs) so the
     * blob persisted on the user's PDS is already clean — even if some
     * other consumer fetches it directly without our serve-time CSP.
     */
    let icon = body.icon ?? undefined;
    if (body.iconUpload?.dataBase64) {
      const mime = body.iconUpload.mimeType;
      if (mime !== "image/svg+xml") {
        return new Response("icon must be image/svg+xml", { status: 400 });
      }
      const raw = decodeBase64(body.iconUpload.dataBase64);
      if (raw.byteLength > ICON_MAX_BYTES) {
        return new Response(`icon exceeds ${ICON_MAX_BYTES} bytes`, {
          status: 400,
        });
      }
      let cleaned: Uint8Array;
      try {
        cleaned = sanitizeSvgBytes(raw);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        return new Response(`invalid svg: ${m}`, { status: 400 });
      }
      try {
        icon = await uploadBlob(
          user.did,
          session.pdsUrl,
          cleaned,
          "image/svg+xml",
        );
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        return new Response(`icon upload failed: ${m}`, { status: 502 });
      }
    }

    // Dedupe categories defensively. The lexicon validator below also
    // does this, but normalising here means we surface a clean 400 ("at
    // least one category") instead of a validator error string.
    const normalizedCategories = (() => {
      const raw = Array.isArray(body.categories)
        ? body.categories.filter((x): x is string => typeof x === "string")
        : [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const c of raw) {
        const t = c.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
      return out;
    })();

    const links = normalizeLinksPayload(body.links);

    /**
     * mainLink is required at the API layer too. The lexicon keeps it
     * optional for backward-compat reads of pre-mainLink records, but
     * any new write must carry one — that's how the listing card knows
     * where to send visitors.
     */
    const mainLink = trimOrNull(body.mainLink);
    if (!mainLink) {
      return new Response(
        "main link is required (the URL people land on when they tap your card)",
        { status: 400 },
      );
    }

    const draft: ProfileRecord = {
      name: trimOrNull(body.name) ?? "",
      description: trimOrNull(body.description) ?? "",
      mainLink,
      categories: normalizedCategories,
      subcategories: asArray(body.subcategories),
      links: links.length > 0 ? links : undefined,
      avatar: avatar ?? undefined,
      icon: icon ?? undefined,
      createdAt: new Date().toISOString(),
    };

    const validation = validateProfile(draft);
    if (!validation.ok || !validation.value) {
      return new Response(`invalid profile: ${validation.error}`, {
        status: 400,
      });
    }

    let result: Awaited<ReturnType<typeof putProfileRecord>>;
    try {
      result = await putProfileRecord(
        user.did,
        session.pdsUrl,
        validation.value,
      );
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return new Response(`putRecord failed: ${m}`, { status: 502 });
    }

    /**
     * Index inline so the new entry appears in /explore the moment the
     * user hits Publish, without depending on the Jetstream worker.
     * Both the PDS write and this index write are idempotent so retrying
     * a failed publish is always safe.
     */
    try {
      await upsertProfile({
        did: user.did,
        handle: user.handle,
        name: validation.value.name,
        description: validation.value.description,
        mainLink: validation.value.mainLink ?? null,
        categories: validation.value.categories,
        subcategories: validation.value.subcategories ?? [],
        links: validation.value.links ?? [],
        avatarCid: validation.value.avatar?.ref.$link ?? null,
        avatarMime: validation.value.avatar?.mimeType ?? null,
        iconCid: validation.value.icon?.ref.$link ?? null,
        iconMime: validation.value.icon?.mimeType ?? null,
        pdsUrl: session.pdsUrl,
        recordCid: result.cid,
        recordRev: result.commit?.rev ?? result.cid,
        createdAt: Date.parse(validation.value.createdAt) || Date.now(),
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error("[registry] inline index after putRecord failed:", err);
      return new Response(
        `Profile saved to your PDS, but indexing it for Explore failed: ${m}. ` +
          `Press Publish again to retry.`,
        { status: 502 },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        uri: result.uri,
        cid: result.cid,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  },

  async DELETE(ctx) {
    const user = ctx.state.user;
    if (!user) return new Response("not authenticated", { status: 401 });

    const session = await loadSession(user.did);
    if (!session) return new Response("OAuth session expired", { status: 401 });

    try {
      await deleteProfileRecord(user.did, session.pdsUrl);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return new Response(`deleteRecord failed: ${m}`, { status: 502 });
    }

    /** Mirror the delete in our local index so /explore stops listing it
     *  immediately. The Jetstream worker would eventually do this too,
     *  but we don't want to wait. */
    try {
      await deleteProfile(user.did);
    } catch (err) {
      console.error("[registry] inline delete-from-index failed:", err);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
