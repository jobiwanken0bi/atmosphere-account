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
  type BlobRef,
  type LinkEntry,
  type ProfileRecord,
  type ScreenshotEntry,
  validateProfile,
} from "../../../lib/lexicons.ts";
import {
  deleteProfile,
  getProfileByDid,
  upsertProfile,
} from "../../../lib/registry.ts";
import { sanitizeSvgBytes } from "../../../lib/svg-sanitize.ts";
import { getEffectiveAccountType } from "../../../lib/account-types.ts";

const ICON_MAX_BYTES = 200_000;
const SCREENSHOT_MAX_BYTES = 5_000_000;
const SCREENSHOT_MAX_COUNT = 4;
const SCREENSHOT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

interface LinkPayload {
  kind?: string;
  url?: string;
  clientId?: string;
  label?: string;
}

interface ProfileFormPayload {
  name?: string;
  description?: string;
  /** Optional Web destination. At least one of mainLink, iosLink, or
   *  androidLink is required for new writes. */
  mainLink?: string;
  /** Optional app store links rendered as iOS / Android buttons. */
  iosLink?: string;
  androidLink?: string;
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
  /**
   * Black-and-white companion icon. Same shape and contract as `icon`
   * — gated behind the same per-project verification, sanitised before
   * upload, and persisted via parallel `icon_bw_*` columns.
   */
  iconBw?: {
    $type: "blob";
    ref: { $link: string };
    mimeType: string;
    size: number;
  } | null;
  iconBwUpload?: { dataBase64: string; mimeType: string };
  /** Existing screenshots to keep plus new uploads to append. */
  screenshots?: ScreenshotEntry[];
  screenshotUploads?: { dataBase64: string; mimeType: string }[];
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

function isImageBlobRef(v: unknown): v is BlobRef {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  const ref = b.ref as Record<string, unknown> | undefined;
  return b.$type === "blob" &&
    !!ref &&
    typeof ref.$link === "string" &&
    typeof b.mimeType === "string" &&
    SCREENSHOT_MIME_TYPES.has(b.mimeType) &&
    typeof b.size === "number" &&
    b.size <= SCREENSHOT_MAX_BYTES;
}

export const handler = define.handlers({
  async PUT(ctx) {
    const user = ctx.state.user;
    if (!user) return new Response("not authenticated", { status: 401 });
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "project") {
      return new Response("project account required", { status: 403 });
    }

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
     * Developer-facing SVG icons (colour + optional B/W companion).
     * Two gates apply identically to both variants:
     *
     *   1. Per-project verification (`icon_access_status === 'granted'`).
     *      Uploads from unverified projects are refused outright. The
     *      form enforces this client-side too, but the API is the source
     *      of truth.
     *   2. Server-side sanitiser (strips <script>, on*, foreignObject,
     *      javascript: hrefs) before the bytes are persisted on the
     *      user's PDS — even verified projects are sanitised every time.
     *
     * "Keeping" an existing icon (passing the BlobRef back unchanged)
     * also requires verification — that handles the revoke→re-save case
     * where we want the icon to be dropped automatically.
     */
    const wantsIcon = !!(
      body.iconUpload?.dataBase64 ||
      body.icon ||
      body.iconBwUpload?.dataBase64 ||
      body.iconBw
    );
    if (wantsIcon && existing?.iconAccessStatus !== "granted") {
      return new Response(
        JSON.stringify({
          error: "icon_access_required",
          detail:
            "This project hasn't been verified yet. SVG icon uploads unlock once an admin verifies the project — request verification from your profile page.",
        }),
        {
          status: 403,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }

    /**
     * Process one icon-variant upload. Centralised so the colour and
     * B/W slots stay 1:1 — same MIME check, size cap, sanitiser, and
     * PDS upload path.
     *
     * `userDid` and `pdsUrl` are captured up front because TS doesn't
     * carry the `if (!user) ... if (!session)` narrowings into this
     * inner closure.
     */
    const userDid = user.did;
    const pdsUrl = session.pdsUrl;
    async function processIconVariant(
      label: "icon" | "iconBw",
      keepRef: BlobRef | null | undefined,
      upload: { dataBase64: string; mimeType: string } | undefined,
    ): Promise<BlobRef | undefined | Response> {
      if (!upload?.dataBase64) return keepRef ?? undefined;
      const mime = upload.mimeType;
      if (mime !== "image/svg+xml") {
        return new Response(`${label} must be image/svg+xml`, { status: 400 });
      }
      const raw = decodeBase64(upload.dataBase64);
      if (raw.byteLength > ICON_MAX_BYTES) {
        return new Response(`${label} exceeds ${ICON_MAX_BYTES} bytes`, {
          status: 400,
        });
      }
      let cleaned: Uint8Array;
      try {
        cleaned = sanitizeSvgBytes(raw);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        return new Response(`invalid svg (${label}): ${m}`, { status: 400 });
      }
      try {
        return await uploadBlob(userDid, pdsUrl, cleaned, "image/svg+xml");
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        return new Response(`${label} upload failed: ${m}`, { status: 502 });
      }
    }

    const iconResult = await processIconVariant(
      "icon",
      body.icon ?? undefined,
      body.iconUpload,
    );
    if (iconResult instanceof Response) return iconResult;
    const icon = iconResult;

    const iconBwResult = await processIconVariant(
      "iconBw",
      body.iconBw ?? undefined,
      body.iconBwUpload,
    );
    if (iconBwResult instanceof Response) return iconBwResult;
    const iconBw = iconBwResult;

    const screenshots: ScreenshotEntry[] = [];
    if (Array.isArray(body.screenshots)) {
      for (const entry of body.screenshots) {
        if (screenshots.length >= SCREENSHOT_MAX_COUNT) break;
        if (entry && isImageBlobRef(entry.image)) {
          screenshots.push({ image: entry.image });
        }
      }
    }
    const uploads = Array.isArray(body.screenshotUploads)
      ? body.screenshotUploads
      : [];
    if (screenshots.length + uploads.length > SCREENSHOT_MAX_COUNT) {
      return new Response(`screenshots: at most ${SCREENSHOT_MAX_COUNT}`, {
        status: 400,
      });
    }
    for (const upload of uploads) {
      if (!SCREENSHOT_MIME_TYPES.has(upload.mimeType)) {
        return new Response("screenshots must be png, jpeg, or webp", {
          status: 400,
        });
      }
      const bytes = decodeBase64(upload.dataBase64);
      if (bytes.byteLength > SCREENSHOT_MAX_BYTES) {
        return new Response("screenshot exceeds 5MB", { status: 400 });
      }
      try {
        const image = await uploadBlob(
          user.did,
          session.pdsUrl,
          bytes,
          upload.mimeType,
        );
        screenshots.push({ image });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        return new Response(`screenshot upload failed: ${m}`, { status: 502 });
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

    const mainLink = trimOrNull(body.mainLink);
    const iosLink = trimOrNull(body.iosLink);
    const androidLink = trimOrNull(body.androidLink);
    if (!mainLink && !iosLink && !androidLink) {
      return new Response(
        "at least one Web, iOS, or Android link is required",
        { status: 400 },
      );
    }

    const draft: ProfileRecord = {
      profileType: "project",
      name: trimOrNull(body.name) ?? "",
      description: trimOrNull(body.description) ?? "",
      mainLink,
      iosLink,
      androidLink,
      categories: normalizedCategories,
      subcategories: asArray(body.subcategories),
      links: links.length > 0 ? links : undefined,
      avatar: avatar ?? undefined,
      icon: icon ?? undefined,
      iconBw: iconBw ?? undefined,
      screenshots: screenshots.length > 0 ? screenshots : undefined,
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
        profileType: validation.value.profileType,
        name: validation.value.name,
        description: validation.value.description,
        mainLink: validation.value.mainLink ?? null,
        iosLink: validation.value.iosLink ?? null,
        androidLink: validation.value.androidLink ?? null,
        categories: validation.value.categories ?? [],
        subcategories: validation.value.subcategories ?? [],
        links: validation.value.links ?? [],
        screenshots: validation.value.screenshots ?? [],
        avatarCid: validation.value.avatar?.ref.$link ?? null,
        avatarMime: validation.value.avatar?.mimeType ?? null,
        iconCid: validation.value.icon?.ref.$link ?? null,
        iconMime: validation.value.icon?.mimeType ?? null,
        iconBwCid: validation.value.iconBw?.ref.$link ?? null,
        iconBwMime: validation.value.iconBw?.mimeType ?? null,
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
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "project") {
      return new Response("project account required", { status: 403 });
    }

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
