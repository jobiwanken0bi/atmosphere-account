/**
 * Authenticated app/profile mutations. The session must hold a valid
 * OAuth session for the authoring DID; new app listings publish to the
 * shared ATStore collection, while existing legacy listings keep writing
 * the Atmosphere profile record for compatibility. Both paths mirror into
 * the local index immediately, and the Jetstream-fed indexer picks up the
 * same write shortly after for any other consumers of the registry.
 *
 *   PUT     /api/registry/profile   (create/update profile)
 *   DELETE  /api/registry/profile   (delete profile)
 */
import { define } from "../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../lib/appview-client.ts";
import { getSessionForCapabilities } from "../../../lib/oauth.ts";
import { oauthReauthorizationUrl } from "../../../lib/oauth-action.ts";
import type { OAuthCapability } from "../../../lib/oauth-scopes.ts";
import {
  deleteProfileRecord,
  deleteRecord,
  getRecordPublic,
  putProfileRecord,
  uploadBlob,
} from "../../../lib/pds.ts";
import {
  type AccountIndicator,
  ATMOSPHERE_LINK_KINDS,
  type BlobRef,
  type LexiconInterop,
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
import {
  deleteAppRecord,
  upsertLegacyProfileAsApp,
} from "../../../lib/app-directory.ts";
import {
  atmosphereProfileAtUri,
  findExistingAtstoreListingForProfile,
  publishAtstoreListingFromProfileRecord,
} from "../../../lib/atstore-migration.ts";
import {
  ATSTORE_LISTING_NSID,
  COMMUNITY_APP_PROFILE_NSID,
} from "../../../lib/app-lexicons.ts";
import {
  communityAppProfileAtUri,
  findExistingCommunityAppProfile,
  publishCommunityAppProfileFromProfileRecord,
} from "../../../lib/community-app-profile.ts";
import { resolveAppListingWriteTarget } from "../../../lib/app-listing-lifecycle.ts";
import { appProfileWriteCapabilities } from "../../../lib/profile-write-capabilities.ts";
import { isJsonMediaType, isSafeRelativePath } from "../../../lib/security.ts";
import { isAtprotoTid } from "../../../lib/tid.ts";
import { enforceDurableRateLimit } from "../../../lib/rate-limit.ts";
import { matchesRasterImageSignature } from "../../../lib/raster-image-security.ts";

const OG_W = 1200;
const OG_H = 630;
const OG_JPEG_QUALITY = 85;
const PROFILE_JSON_MAX_BYTES = 36_000_000;

/** Resize `bytes` to a 1200×630 cover-crop JPEG for the og:image cache.
 *  Returns null if ImageScript fails (e.g. unsupported format), so the
 *  caller can proceed without crashing the whole profile save. */
async function generateOgJpeg(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { coverJpeg } = await import("../../../lib/image-processing.ts");
    return await coverJpeg(bytes, OG_W, OG_H, OG_JPEG_QUALITY);
  } catch (err) {
    console.warn("[profile] og-jpeg pre-generation failed:", err);
    return null;
  }
}

const ICON_MAX_BYTES = 200_000;
const AVATAR_MAX_BYTES = 1_000_000;
const BANNER_MAX_BYTES = 3_000_000;
const SCREENSHOT_MAX_BYTES = 5_000_000;
const SCREENSHOT_MAX_COUNT = 4;
const SCREENSHOT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const BANNER_MIME_TYPES = SCREENSHOT_MIME_TYPES;
const JSON_BODY_TOO_LARGE = Symbol("jsonBodyTooLarge");
const MAX_PROFILE_COLLECTION_INPUTS = 128;

async function tryPublishCommunityProfile(input: {
  did: string;
  handle: string;
  pdsUrl: string;
  record: ProfileRecord;
}): Promise<{ uri: string; cid: string } | null> {
  if (!input.record.categories?.includes("app")) return null;
  try {
    const existing = await findExistingCommunityAppProfile(
      input.did,
      input.pdsUrl,
    ).catch(() => null);
    return await publishCommunityAppProfileFromProfileRecord({
      ...input,
      existingRecord: existing,
    });
  } catch (err) {
    console.warn("[registry] community app profile publish skipped:", err);
    return null;
  }
}

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
  lexicons?: {
    produces?: string[];
    consumes?: string[];
  };
  accountIndicators?: Array<{
    collection?: string;
    rkey?: string;
  }>;
  /** Either keep an existing avatar (passed as the BlobRef) or upload new bytes */
  avatar?: {
    $type: "blob";
    ref: { $link: string };
    mimeType: string;
    size: number;
  } | null;
  avatarUpload?: { dataBase64: string; mimeType: string };
  /**
   * Project banner image. Same shape as `avatar`: pass the existing
   * BlobRef back to keep, `null` to clear, or `bannerUpload` to replace.
   * Rendered at the top of the project page and used as the OG/Twitter
   * card preview when the URL is shared. Recommended 1200x630.
   */
  banner?: {
    $type: "blob";
    ref: { $link: string };
    mimeType: string;
    size: number;
  } | null;
  bannerUpload?: { dataBase64: string; mimeType: string };
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
  /** Create a distinct ATStore listing instead of updating the first one. */
  createNewListing?: boolean;
  /** Client-stable TID used to make a distinct listing retry idempotent. */
  createListingRkey?: string;
  /** Existing ATStore record to update when this DID owns several apps. */
  atstoreListingUri?: string | null;
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

function asLongStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const value = raw.trim().slice(0, 256);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= 64) break;
  }
  return out;
}

function normalizeLexiconsPayload(input: ProfileFormPayload["lexicons"]): {
  lexicons?: LexiconInterop;
} {
  const produces = asLongStringArray(input?.produces);
  const consumes = asLongStringArray(input?.consumes);
  const lexicons: LexiconInterop = {};
  if (produces.length > 0) lexicons.produces = produces;
  if (consumes.length > 0) lexicons.consumes = consumes;
  return lexicons.produces || lexicons.consumes ? { lexicons } : {};
}

function normalizeAccountIndicatorsPayload(
  input: ProfileFormPayload["accountIndicators"],
): AccountIndicator[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: AccountIndicator[] = [];
  for (const raw of input) {
    const collection = trimOrNull(raw?.collection);
    if (!collection) continue;
    const rkey = trimOrNull(raw?.rkey);
    const key = `${collection}/${rkey ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      collection: collection.slice(0, 256),
      ...(rkey ? { rkey: rkey.slice(0, 256) } : {}),
    });
    if (out.length >= 64) break;
  }
  return out;
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

/** The profile endpoint has a deliberately large byte budget for image
 * uploads. Bound JSON collection cardinality separately so that budget cannot
 * be turned into million-item normalization loops. */
export function profileCollectionBoundsErrorForTest(
  body: ProfileFormPayload,
): string | null {
  const collections: Array<[string, unknown, number]> = [
    ["categories", body.categories, MAX_PROFILE_COLLECTION_INPUTS],
    ["subcategories", body.subcategories, MAX_PROFILE_COLLECTION_INPUTS],
    ["links", body.links, MAX_PROFILE_COLLECTION_INPUTS],
    [
      "lexicons.produces",
      body.lexicons?.produces,
      MAX_PROFILE_COLLECTION_INPUTS,
    ],
    [
      "lexicons.consumes",
      body.lexicons?.consumes,
      MAX_PROFILE_COLLECTION_INPUTS,
    ],
    [
      "accountIndicators",
      body.accountIndicators,
      MAX_PROFILE_COLLECTION_INPUTS,
    ],
    ["screenshots", body.screenshots, MAX_PROFILE_COLLECTION_INPUTS],
    ["screenshotUploads", body.screenshotUploads, SCREENSHOT_MAX_COUNT],
  ];
  for (const [field, value, limit] of collections) {
    if (Array.isArray(value) && value.length > limit) {
      return `${field}: too many items`;
    }
  }
  return null;
}

export function profileCreateListingKeyErrorForTest(
  createNewListing: unknown,
  createListingRkey: unknown,
): string | null {
  if (
    createNewListing != null && typeof createNewListing !== "boolean"
  ) return "invalid app listing creation request";
  if (
    createListingRkey != null && typeof createListingRkey !== "string"
  ) return "invalid app listing creation key";
  const rkey = typeof createListingRkey === "string"
    ? createListingRkey.trim()
    : "";
  if (createNewListing === true) {
    return rkey && isAtprotoTid(rkey)
      ? null
      : "invalid app listing creation key";
  }
  return rkey ? "unexpected app listing creation key" : null;
}

async function readJsonBodyLimited<T>(
  req: Request,
  maxBytes: number,
): Promise<T | null | typeof JSON_BODY_TOO_LARGE> {
  if (!isJsonMediaType(req.headers.get("content-type"))) return null;
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return JSON_BODY_TOO_LARGE;
  }
  if (!req.body) return null;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return JSON_BODY_TOO_LARGE;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

function normalizedBase64(b64: string, label: string): string {
  const normalized = b64.replace(/\s/g, "");
  if (
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error(`${label} must be valid base64`);
  }
  return normalized;
}

function estimateBase64DecodedBytes(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

function decodeBase64Limited(
  b64: string,
  maxBytes: number,
  label: string,
): Uint8Array {
  const normalized = normalizedBase64(b64, label);
  if (estimateBase64DecodedBytes(normalized) > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }

  let binary: string;
  try {
    binary = atob(normalized);
  } catch {
    throw new Error(`${label} must be valid base64`);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  if (out.byteLength > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
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
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewProxyError(err),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) return new Response("not authenticated", { status: 401 });
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "registry-profile-write",
      capacity: 12,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const body = await readJsonBodyLimited<ProfileFormPayload>(
      ctx.req,
      PROFILE_JSON_MAX_BYTES,
    );
    if (body === JSON_BODY_TOO_LARGE) {
      return new Response("request body too large", { status: 413 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return new Response("invalid JSON body", { status: 400 });
    }
    const collectionBoundsError = profileCollectionBoundsErrorForTest(body);
    if (collectionBoundsError) {
      return new Response(collectionBoundsError, { status: 400 });
    }

    if (
      body.atstoreListingUri != null &&
      typeof body.atstoreListingUri !== "string"
    ) {
      return new Response("invalid app listing target", { status: 400 });
    }
    const requestedAtstoreTarget = body.atstoreListingUri
      ? ownedAtstoreTarget(body.atstoreListingUri, user.did)
      : null;
    if (body.atstoreListingUri && !requestedAtstoreTarget) {
      return new Response("invalid app listing target", { status: 400 });
    }
    const creationKeyError = profileCreateListingKeyErrorForTest(
      body.createNewListing,
      body.createListingRkey,
    );
    if (creationKeyError) {
      return new Response(creationKeyError, { status: 400 });
    }
    const requestedCreateRkey = typeof body.createListingRkey === "string"
      ? body.createListingRkey.trim()
      : null;

    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    const targetedAtstoreWrite = !!requestedAtstoreTarget;
    if (
      accountType !== "project" && body.createNewListing !== true &&
      !targetedAtstoreWrite
    ) {
      return new Response("owned app listing required", { status: 403 });
    }

    const requiredCapabilities = appProfileWriteCapabilities(body);
    const session = await getSessionForCapabilities(
      user.did,
      requiredCapabilities,
    );
    if (!session) {
      return appReauthRequired({
        capabilities: requiredCapabilities,
        name: trimOrNull(body.name) ?? "your app",
        next: safeReauthNext(ctx.url),
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
    const existing = await getProfileByDid(user.did, {
      includeTakenDown: true,
      profileType: "project",
    }).catch(() => null);
    if (existing?.takedownStatus === "taken_down") {
      return new Response(
        "This app listing has been taken down by an Atmosphere admin. " +
          "You can delete it from your PDS, but you can't update it.",
        { status: 403 },
      );
    }

    let avatar = body.avatar ?? undefined;
    if (body.avatarUpload?.dataBase64) {
      if (!SCREENSHOT_MIME_TYPES.has(body.avatarUpload.mimeType)) {
        return new Response("avatar must be png, jpeg, or webp", {
          status: 400,
        });
      }
      let bytes: Uint8Array;
      try {
        bytes = decodeBase64Limited(
          body.avatarUpload.dataBase64,
          AVATAR_MAX_BYTES,
          "avatar",
        );
      } catch {
        return new Response("avatar data is invalid or too large", {
          status: 400,
        });
      }
      if (!matchesRasterImageSignature(bytes, body.avatarUpload.mimeType)) {
        return new Response(
          "avatar contents do not match the selected image type",
          { status: 400 },
        );
      }
      try {
        avatar = await uploadBlob(
          user.did,
          session.pdsUrl,
          bytes,
          body.avatarUpload.mimeType,
        );
      } catch (err) {
        console.warn("[registry] avatar blob upload failed:", err);
        return new Response("avatar upload failed", { status: 502 });
      }
    }

    /**
     * Banner upload mirrors the avatar contract — pass the existing
     * BlobRef back to keep it, `null` to clear, or `bannerUpload` to
     * replace. The PDS blob doubles as the OG/Twitter card image
     * referenced from the project page meta tags.
     */
    let banner = body.banner ?? undefined;
    let ogJpeg: Uint8Array | null = null;
    if (body.bannerUpload?.dataBase64) {
      if (!BANNER_MIME_TYPES.has(body.bannerUpload.mimeType)) {
        return new Response("banner must be png, jpeg, or webp", {
          status: 400,
        });
      }
      let bytes: Uint8Array;
      try {
        bytes = decodeBase64Limited(
          body.bannerUpload.dataBase64,
          BANNER_MAX_BYTES,
          "banner",
        );
      } catch {
        return new Response("banner data is invalid or too large", {
          status: 400,
        });
      }
      if (!matchesRasterImageSignature(bytes, body.bannerUpload.mimeType)) {
        return new Response(
          "banner contents do not match the selected image type",
          { status: 400 },
        );
      }
      try {
        banner = await uploadBlob(
          user.did,
          session.pdsUrl,
          bytes,
          body.bannerUpload.mimeType,
        );
      } catch (err) {
        console.warn("[registry] banner blob upload failed:", err);
        return new Response("banner upload failed", { status: 502 });
      }
      // Pre-generate the 1200×630 JPEG for the og:image cache. This runs
      // after the PDS upload succeeds so a resize failure never blocks saving.
      const rawOg = await generateOgJpeg(bytes);
      ogJpeg = rawOg ? rawOg.slice() : null;
    }

    /**
     * Developer-facing SVG icons (color + optional B/W companion).
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
            "This app listing hasn't been verified yet. SVG icon uploads unlock once an admin verifies the listing.",
        }),
        {
          status: 403,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }

    /**
     * Process one icon-variant upload. Centralised so the color and
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
      let raw: Uint8Array;
      try {
        raw = decodeBase64Limited(upload.dataBase64, ICON_MAX_BYTES, label);
      } catch {
        return new Response(`${label} data is invalid or too large`, {
          status: 400,
        });
      }
      let cleaned: Uint8Array;
      try {
        cleaned = sanitizeSvgBytes(raw);
      } catch {
        return new Response(`invalid svg (${label})`, { status: 400 });
      }
      try {
        return await uploadBlob(userDid, pdsUrl, cleaned, "image/svg+xml");
      } catch (err) {
        console.warn(`[registry] ${label} blob upload failed:`, err);
        return new Response(`${label} upload failed`, { status: 502 });
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
      if (
        !upload || typeof upload !== "object" ||
        typeof upload.dataBase64 !== "string" ||
        typeof upload.mimeType !== "string"
      ) {
        return new Response("invalid screenshot upload", { status: 400 });
      }
      if (!SCREENSHOT_MIME_TYPES.has(upload.mimeType)) {
        return new Response("screenshots must be png, jpeg, or webp", {
          status: 400,
        });
      }
      let bytes: Uint8Array;
      try {
        bytes = decodeBase64Limited(
          upload.dataBase64,
          SCREENSHOT_MAX_BYTES,
          "screenshot",
        );
      } catch {
        return new Response("screenshot data is invalid or too large", {
          status: 400,
        });
      }
      if (!matchesRasterImageSignature(bytes, upload.mimeType)) {
        return new Response(
          "screenshot contents do not match the selected image type",
          { status: 400 },
        );
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
        console.warn("[registry] screenshot blob upload failed:", err);
        return new Response("screenshot upload failed", { status: 502 });
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
    const { lexicons } = normalizeLexiconsPayload(body.lexicons);
    const accountIndicators = normalizeAccountIndicatorsPayload(
      body.accountIndicators,
    );

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
      lexicons,
      accountIndicators: accountIndicators.length > 0
        ? accountIndicators
        : undefined,
      avatar: avatar ?? undefined,
      banner: banner ?? undefined,
      icon: icon ?? undefined,
      iconBw: iconBw ?? undefined,
      screenshots: screenshots.length > 0 ? screenshots : undefined,
      createdAt: new Date().toISOString(),
    };

    const validation = validateProfile(draft);
    if (!validation.ok || !validation.value) {
      return new Response(`invalid app listing: ${validation.error}`, {
        status: 400,
      });
    }

    const targetedAtstore = requestedAtstoreTarget
      ? await getRecordPublic(
        session.pdsUrl,
        user.did,
        ATSTORE_LISTING_NSID,
        requestedAtstoreTarget.rkey,
      ).then((record) =>
        record
          ? {
            ...record,
            rkey: requestedAtstoreTarget.rkey,
          }
          : null
      ).catch(() => null)
      : null;
    if (requestedAtstoreTarget && !targetedAtstore) {
      return new Response("app listing target not found", { status: 404 });
    }
    const createRetryRecord = body.createNewListing === true &&
        requestedCreateRkey
      ? await getRecordPublic(
        session.pdsUrl,
        user.did,
        ATSTORE_LISTING_NSID,
        requestedCreateRkey,
      ).then((record) =>
        record
          ? {
            ...record,
            rkey: requestedCreateRkey,
          }
          : null
      ).catch(() => null)
      : null;
    const existingAtstore = body.createNewListing === true
      ? createRetryRecord
      : targetedAtstore ?? await findExistingAtstoreListingForProfile(
        user.did,
        session.pdsUrl,
      ).catch(() => null);
    const writeTarget = body.createNewListing === true
      ? "atstore_listing" as const
      : resolveAppListingWriteTarget({
        hasLegacyProfile: !!existing,
        hasAtstoreListing: !!existingAtstore,
        categories: validation.value.categories,
      });
    if (writeTarget === "atstore_listing") {
      try {
        const atstoreResult = await publishAtstoreListingFromProfileRecord({
          did: user.did,
          handle: user.handle,
          pdsUrl: session.pdsUrl,
          record: validation.value,
          existingRecord: existingAtstore,
          createDistinctListing: body.createNewListing === true,
          rkeyOverride: body.createNewListing === true
            ? requestedCreateRkey
            : null,
        });
        const communityResult = body.createNewListing === true
          ? null
          : await tryPublishCommunityProfile({
            did: user.did,
            handle: user.handle,
            pdsUrl: session.pdsUrl,
            record: validation.value,
          });
        return new Response(
          JSON.stringify({
            ok: true,
            uri: atstoreResult.uri,
            cid: atstoreResult.cid,
            atstoreListingUri: atstoreResult.uri,
            communityProfileUri: communityResult?.uri ?? null,
            slug: atstoreResult.slug,
            publicPath: atstoreResult.slug
              ? `/apps/${encodeURIComponent(atstoreResult.slug)}`
              : null,
            writeTarget,
            icon: null,
            iconBw: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      } catch (err) {
        if (err instanceof Error && err.message === "missing_icon") {
          return new Response(
            "ATStore app listings require an app icon/avatar",
            { status: 400 },
          );
        }
        console.warn("[registry] ATStore listing publish failed:", err);
        return new Response("ATStore listing publish failed", {
          status: 502,
        });
      }
    }

    let result: Awaited<ReturnType<typeof putProfileRecord>>;
    try {
      result = await putProfileRecord(
        user.did,
        session.pdsUrl,
        validation.value,
      );
    } catch (err) {
      console.warn("[registry] profile record publish failed:", err);
      return new Response("profile record publish failed", { status: 502 });
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
        lexicons: validation.value.lexicons ?? null,
        accountIndicators: validation.value.accountIndicators ?? [],
        screenshots: validation.value.screenshots ?? [],
        avatarCid: validation.value.avatar?.ref.$link ?? null,
        avatarMime: validation.value.avatar?.mimeType ?? null,
        bannerCid: validation.value.banner?.ref.$link ?? null,
        bannerMime: validation.value.banner?.mimeType ?? null,
        ogJpeg: ogJpeg ?? undefined,
        iconCid: validation.value.icon?.ref.$link ?? null,
        iconMime: validation.value.icon?.mimeType ?? null,
        iconBwCid: validation.value.iconBw?.ref.$link ?? null,
        iconBwMime: validation.value.iconBw?.mimeType ?? null,
        pdsUrl: session.pdsUrl,
        recordCid: result.cid,
        recordRev: result.commit?.rev ?? result.cid,
        createdAt: Date.parse(validation.value.createdAt) || Date.now(),
      });
      const latest = await getProfileByDid(user.did, {
        includeTakenDown: true,
      });
      if (latest?.categories.includes("app")) {
        await upsertLegacyProfileAsApp(latest);
      }
    } catch (err) {
      console.error("[registry] inline index after putRecord failed:", err);
      return new Response(
        "App listing saved to your account host, but the directory could not " +
          "confirm the update. " +
          `Press Publish again to retry.`,
        { status: 502 },
      );
    }

    const communityResult = await tryPublishCommunityProfile({
      did: user.did,
      handle: user.handle,
      pdsUrl: session.pdsUrl,
      record: validation.value,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        uri: result.uri,
        cid: result.cid,
        communityProfileUri: communityResult?.uri ?? null,
        publicPath: `/apps/${encodeURIComponent(user.handle)}`,
        writeTarget,
        icon: validation.value.icon ?? null,
        iconBw: validation.value.iconBw ?? null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  },

  async DELETE(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewProxyError(err),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) return new Response("not authenticated", { status: 401 });
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "registry-profile-delete",
      capacity: 12,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const requestedListings = ctx.url.searchParams.getAll("listing");
    if (requestedListings.length > 1) {
      return new Response("invalid app listing target", { status: 400 });
    }
    const requestedListing = requestedListings[0] ?? null;
    // Reject an explicit foreign or malformed repository target before asking
    // the account to grant app-writing access. The capability prompt must not
    // precede the ownership decision for a target named by the request.
    const requestedTarget = requestedListing
      ? ownedAtstoreTarget(requestedListing, user.did)
      : null;
    if (requestedListing && !requestedTarget) {
      return new Response("invalid app listing target", { status: 400 });
    }
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "project" && !requestedListing) {
      return new Response("owned app listing required", { status: 403 });
    }

    const requiredCapabilities = ["app"] as const;
    const session = await getSessionForCapabilities(
      user.did,
      requiredCapabilities,
    );
    if (!session) {
      return appReauthRequired({
        capabilities: requiredCapabilities,
        name: "your app",
        next: safeReauthNext(ctx.url),
      });
    }

    if (requestedTarget) {
      try {
        await deleteRecord(
          user.did,
          session.pdsUrl,
          ATSTORE_LISTING_NSID,
          requestedTarget.rkey,
        );
        await deleteAppRecord(requestedTarget.uri);
      } catch (err) {
        console.warn("[registry] ATStore listing delete failed:", err);
        return new Response("ATStore listing delete failed", {
          status: 502,
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    try {
      await deleteProfileRecord(user.did, session.pdsUrl);
    } catch (err) {
      console.warn("[registry] profile record delete failed:", err);
      return new Response("profile record delete failed", { status: 502 });
    }

    try {
      const existingAtstore = await findExistingAtstoreListingForProfile(
        user.did,
        session.pdsUrl,
      );
      if (existingAtstore?.rkey) {
        await deleteRecord(
          user.did,
          session.pdsUrl,
          ATSTORE_LISTING_NSID,
          existingAtstore.rkey,
        );
        await deleteAppRecord(existingAtstore.uri);
      }
    } catch (err) {
      console.warn("[registry] legacy ATStore listing delete failed:", err);
      return new Response("ATStore listing delete failed", {
        status: 502,
      });
    }

    try {
      await deleteRecord(
        user.did,
        session.pdsUrl,
        COMMUNITY_APP_PROFILE_NSID,
        "self",
      );
      await deleteAppRecord(communityAppProfileAtUri(user.did));
    } catch (err) {
      console.error("[registry] community app profile delete failed:", err);
      return new Response(
        "The app could not be fully removed from its account host. Try again.",
        { status: 502 },
      );
    }

    /** Mirror the delete in our local index so /explore stops listing it
     *  immediately. The Jetstream worker would eventually do this too,
     *  but we don't want to wait. */
    try {
      await deleteProfile(user.did);
      await deleteAppRecord(atmosphereProfileAtUri(user.did));
    } catch (err) {
      console.error("[registry] inline delete-from-index failed:", err);
      return new Response(
        "The app was removed from its account host, but the directory could not confirm the removal. Try again.",
        { status: 503 },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});

function ownedAtstoreTarget(
  value: string,
  did: string,
): { uri: string; rkey: string } | null {
  const prefix = `at://${did}/${ATSTORE_LISTING_NSID}/`;
  if (!value.startsWith(prefix)) return null;
  const rkey = value.slice(prefix.length);
  if (!rkey || rkey.includes("/") || rkey.length > 512) return null;
  return { uri: `${prefix}${rkey}`, rkey };
}

function appviewProxyError(err: unknown): Response {
  console.warn("[api/registry/profile] appview proxy failed:", err);
  return new Response(JSON.stringify({ error: "appview_unavailable" }), {
    status: 503,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function appReauthRequired(input: {
  capabilities: readonly OAuthCapability[];
  name: string;
  next?: string;
}): Response {
  return new Response(
    JSON.stringify({
      error: "reauth_required",
      reauthUrl: oauthReauthorizationUrl({
        next: input.next ?? "/apps/manage",
        action: "app",
        capabilities: input.capabilities,
        name: input.name,
      }),
    }),
    {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}

function safeReauthNext(url: URL): string | undefined {
  const next = url.searchParams.get("next");
  return next && isSafeRelativePath(next) ? next : undefined;
}
