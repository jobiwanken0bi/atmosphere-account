/**
 * Authenticated registry profile mutations. The session must hold a
 * valid OAuth session for the authoring DID; we then write the record(s)
 * directly to the user's PDS via DPoP-bound XRPC and mirror them into
 * the local index. The Jetstream-fed indexer picks up the same writes
 * shortly after for any other consumers of the registry.
 *
 *   PUT     /api/registry/profile   (create/update profile + license)
 *   DELETE  /api/registry/profile   (delete both records)
 *
 * Note: the request body carries an optional `license` sub-object which
 * is published as a sibling `com.atmosphereaccount.registry.license`
 * record. Splitting it out keeps the profile lexicon minimal — the form
 * still presents both as a single Save action for UX simplicity.
 */
import { define } from "../../../utils.ts";
import { loadSession } from "../../../lib/oauth.ts";
import {
  deleteProfileRecord,
  deleteRecord,
  putProfileRecord,
  putRecord,
  uploadBlob,
} from "../../../lib/pds.ts";
import {
  LICENSE_NSID,
  type LicenseRecord,
  type LinkEntry,
  type ProfileRecord,
  validateLicense,
  validateProfile,
} from "../../../lib/lexicons.ts";
import {
  deleteLicense,
  deleteProfile,
  upsertLicense,
  upsertProfile,
} from "../../../lib/registry.ts";

interface LicensePayload {
  type?: string;
  spdxId?: string;
  licenseUrl?: string;
  notes?: string;
}

interface LinkPayload {
  kind?: string;
  url?: string;
  label?: string;
}

interface ProfileFormPayload {
  name?: string;
  description?: string;
  /** Required multi-select. The first entry is the primary category. */
  categories?: string[];
  subcategories?: string[];
  links?: LinkPayload[];
  bskyClient?: string;
  /** Either keep an existing avatar (passed as the BlobRef) or upload new bytes */
  avatar?: {
    $type: "blob";
    ref: { $link: string };
    mimeType: string;
    size: number;
  } | null;
  avatarUpload?: { dataBase64: string; mimeType: string };
  /**
   * Optional license sub-record. `null` means "remove any existing license
   * record"; `undefined` means "leave it alone".
   */
  license?: LicensePayload | null;
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

function normalizeLinksPayload(input: unknown): LinkEntry[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: LinkEntry[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as LinkPayload;
    const kind = trimOrNull(e.kind);
    const url = trimOrNull(e.url);
    if (!kind || !url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const entry: LinkEntry = { kind, url };
    const label = trimOrNull(e.label);
    if (label) entry.label = label;
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

    const draft: ProfileRecord = {
      name: trimOrNull(body.name) ?? "",
      description: trimOrNull(body.description) ?? "",
      categories: normalizedCategories,
      subcategories: asArray(body.subcategories),
      links: links.length > 0 ? links : undefined,
      bskyClient: trimOrNull(body.bskyClient),
      avatar: avatar ?? undefined,
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
     * user hits Publish, without depending on the Jetstream worker. The
     * worker is still useful for picking up records authored outside
     * this app (e.g. by other tooling), but it isn't on the critical
     * path for the user-facing flow.
     *
     * Both the PDS write and this index write are idempotent (rkey is
     * fixed at "self"; the SQL is ON CONFLICT DO UPDATE), so retrying a
     * failed publish is always safe.
     */
    try {
      await upsertProfile({
        did: user.did,
        handle: user.handle,
        name: validation.value.name,
        description: validation.value.description,
        categories: validation.value.categories,
        subcategories: validation.value.subcategories ?? [],
        links: validation.value.links ?? [],
        bskyClient: validation.value.bskyClient ?? null,
        avatarCid: validation.value.avatar?.ref.$link ?? null,
        avatarMime: validation.value.avatar?.mimeType ?? null,
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

    /**
     * Optional license sub-record handling. The form sends:
     *   - `license: undefined`  → leave any existing record alone
     *   - `license: null`       → delete any existing record
     *   - `license: { ... }`    → upsert
     *
     * Failures here are treated as soft errors: the profile is already
     * saved, so we still return 200 but include a warning the form can
     * surface.
     */
    let licenseWarning: string | null = null;
    if (body.license === null) {
      try {
        await deleteRecord(user.did, session.pdsUrl, LICENSE_NSID, "self");
        await deleteLicense(user.did);
      } catch (err) {
        licenseWarning = err instanceof Error ? err.message : String(err);
        console.error("[registry] license delete failed:", err);
      }
    } else if (body.license && typeof body.license === "object") {
      const lp = body.license;
      const licenseDraft: LicenseRecord = {
        type: trimOrNull(lp.type) ?? "",
        spdxId: trimOrNull(lp.spdxId),
        licenseUrl: trimOrNull(lp.licenseUrl),
        notes: trimOrNull(lp.notes),
        createdAt: new Date().toISOString(),
      };
      const lv = validateLicense(licenseDraft);
      if (!lv.ok || !lv.value) {
        licenseWarning = `Profile saved, but license rejected: ${lv.error}`;
      } else {
        try {
          const lr = await putRecord(
            user.did,
            session.pdsUrl,
            LICENSE_NSID,
            "self",
            lv.value as unknown as Record<string, unknown>,
          );
          await upsertLicense({
            did: user.did,
            type: lv.value.type,
            spdxId: lv.value.spdxId ?? null,
            licenseUrl: lv.value.licenseUrl ?? null,
            notes: lv.value.notes ?? null,
            pdsUrl: session.pdsUrl,
            recordCid: lr.cid,
            recordRev: lr.commit?.rev ?? lr.cid,
            createdAt: Date.parse(lv.value.createdAt) || Date.now(),
          });
        } catch (err) {
          licenseWarning = err instanceof Error ? err.message : String(err);
          console.error("[registry] license upsert failed:", err);
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        uri: result.uri,
        cid: result.cid,
        licenseWarning,
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
    // Removing from Explore implies removing the paired license record
    // too — there's no orphaned-license UX, and the user can re-add
    // both by republishing.
    try {
      await deleteRecord(user.did, session.pdsUrl, LICENSE_NSID, "self");
    } catch (err) {
      console.warn("[registry] license deleteRecord (best effort) failed:", err);
    }

    /** Mirror the deletes in our local index so /explore stops listing it
     *  immediately. As above, the Jetstream worker would eventually do
     *  this too, but we don't want to wait. `deleteProfile` cascades to
     *  the license row. */
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
