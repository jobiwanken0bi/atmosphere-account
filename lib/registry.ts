/**
 * Typed query helpers around the registry tables. Used by Fresh routes
 * (read APIs and SSR pages) and the indexer worker (writes).
 */
import type { InValue } from "@libsql/client";
import { withDb } from "./db.ts";
import type {
  FeaturedBadge,
  LinkEntry,
  ProfileType,
  ScreenshotEntry,
} from "./lexicons.ts";

/**
 * Approval state of the developer-facing SVG icon.
 *
 *   - `pending`  — uploaded but not yet reviewed; not served publicly.
 *   - `approved` — visible via /api/registry/icon/:did + iconUrl.
 *   - `rejected` — admin rejected; reason kept in `iconRejectedReason`.
 *
 * `null` means the profile has no icon at all.
 */
export type IconStatus = "pending" | "approved" | "rejected";

/**
 * Per-project verification gate for SVG icon uploads. The icon section
 * in the profile form (and the PUT /api/registry/profile API) refuses
 * any icon write unless the project is `granted`.
 *
 *   - `null`        — never requested. Form shows "Request Verification".
 *   - `requested`   — user submitted a request with a contact email,
 *                     awaiting admin review. Form shows "Pending review".
 *   - `granted`     — admin approved; icon uploads accepted. Sanitiser
 *                     still runs server-side.
 *   - `denied`      — admin denied (or revoked previously-granted access).
 *                     Form shows the appeal email; only an admin can
 *                     re-open.
 */
export type IconAccessStatus = "requested" | "granted" | "denied";

/**
 * Moderation state for the *whole profile*. Distinct from icon status —
 * a takedown removes the profile from public reads (search, /explore,
 * /api/registry/*) regardless of icon state. The user's PDS record is
 * untouched; only this AppView refuses to serve it.
 *
 *   - `null`         — live and visible.
 *   - `taken_down`   — admin removed it; reason in `takedownReason`.
 */
export type TakedownStatus = "taken_down";

export interface ProfileRow {
  did: string;
  handle: string;
  profileType: ProfileType;
  name: string;
  description: string;
  /** Primary web destination rendered as the Web button. May be null
   *  for legacy records created before mainLink existed. */
  mainLink: string | null;
  /** Optional App Store URL rendered as the iOS button on the public profile. */
  iosLink: string | null;
  /** Optional Android app URL rendered as the Android button on the public profile. */
  androidLink: string | null;
  /** All categories that apply (always non-empty). The first item is the
   *  primary category used for sort/grouping in lists. */
  categories: string[];
  subcategories: string[];
  /** Outbound links (atmosphere services and custom links) in author-defined order. */
  links: LinkEntry[];
  screenshots: ScreenshotEntry[];
  avatarCid: string | null;
  avatarMime: string | null;
  /** Optional developer-facing SVG icon. Not rendered on public profile.
   *  Approval state lives in `iconStatus`. */
  iconCid: string | null;
  iconMime: string | null;
  iconStatus: IconStatus | null;
  iconReviewedBy: string | null;
  iconReviewedAt: number | null;
  iconRejectedReason: string | null;
  /** Per-project SVG-upload verification state. */
  iconAccessStatus: IconAccessStatus | null;
  /** Contact email captured at request time (admin-only sees this). */
  iconAccessEmail: string | null;
  iconAccessRequestedAt: number | null;
  iconAccessReviewedAt: number | null;
  iconAccessReviewedBy: string | null;
  /** Optional reason supplied by admin when denying access. */
  iconAccessDeniedReason: string | null;
  /** Profile-level takedown state. `null` means live. */
  takedownStatus: TakedownStatus | null;
  takedownReason: string | null;
  takedownBy: string | null;
  takedownAt: number | null;
  pdsUrl: string;
  recordCid: string;
  recordRev: string;
  createdAt: number;
  indexedAt: number;
  /** Populated when joined with the featured table. */
  featured?: {
    badges: FeaturedBadge[] | string[];
    position: number;
  };
}

interface RawProfileRow {
  did: string;
  handle: string;
  profile_type: string | null;
  name: string;
  description: string;
  main_link: string | null;
  ios_link: string | null;
  android_link: string | null;
  categories: string;
  subcategories: string;
  links: string | null;
  screenshots: string | null;
  avatar_cid: string | null;
  avatar_mime: string | null;
  icon_cid: string | null;
  icon_mime: string | null;
  icon_status: string | null;
  icon_reviewed_by: string | null;
  icon_reviewed_at: number | null;
  icon_rejected_reason: string | null;
  icon_access_status: string | null;
  icon_access_email: string | null;
  icon_access_requested_at: number | null;
  icon_access_reviewed_at: number | null;
  icon_access_reviewed_by: string | null;
  icon_access_denied_reason: string | null;
  takedown_status: string | null;
  takedown_reason: string | null;
  takedown_by: string | null;
  takedown_at: number | null;
  pds_url: string;
  record_cid: string;
  record_rev: string;
  created_at: number;
  indexed_at: number;
  featured_badges?: string | null;
  featured_position?: number | null;
}

function safeJsonArray(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function safeJsonLinks(text: string | null | undefined): LinkEntry[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .filter((x) => typeof x.kind === "string")
      .map((x) => {
        const e: LinkEntry = { kind: x.kind as string };
        if (typeof x.url === "string" && x.url) e.url = x.url;
        if (typeof x.clientId === "string" && x.clientId) {
          e.clientId = x.clientId;
        }
        if (typeof x.label === "string" && x.label) e.label = x.label;
        return e;
      });
  } catch {
    return [];
  }
}

function safeJsonScreenshots(
  text: string | null | undefined,
): ScreenshotEntry[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => x.image)
      .filter((image): image is ScreenshotEntry["image"] =>
        !!image && typeof image === "object" &&
        (image as Record<string, unknown>).$type === "blob" &&
        typeof ((image as Record<string, unknown>).ref as
            | Record<
              string,
              unknown
            >
            | undefined)?.$link === "string" &&
        typeof (image as Record<string, unknown>).mimeType === "string"
      )
      .map((image) => ({ image }));
  } catch {
    return [];
  }
}

function normalizeIconStatus(v: string | null): IconStatus | null {
  if (v === "pending" || v === "approved" || v === "rejected") return v;
  return null;
}

function normalizeIconAccessStatus(
  v: string | null,
): IconAccessStatus | null {
  if (v === "requested" || v === "granted" || v === "denied") return v;
  return null;
}

function normalizeTakedownStatus(v: string | null): TakedownStatus | null {
  return v === "taken_down" ? "taken_down" : null;
}

function normalizeProfileType(v: string | null): ProfileType {
  return v === "user" ? "user" : "project";
}

function rowToProfile(r: RawProfileRow): ProfileRow {
  const out: ProfileRow = {
    did: r.did,
    handle: r.handle,
    profileType: normalizeProfileType(r.profile_type),
    name: r.name,
    description: r.description,
    mainLink: r.main_link && r.main_link.length > 0 ? r.main_link : null,
    iosLink: r.ios_link && r.ios_link.length > 0 ? r.ios_link : null,
    androidLink: r.android_link && r.android_link.length > 0
      ? r.android_link
      : null,
    categories: safeJsonArray(r.categories),
    subcategories: safeJsonArray(r.subcategories),
    links: safeJsonLinks(r.links),
    screenshots: safeJsonScreenshots(r.screenshots),
    avatarCid: r.avatar_cid,
    avatarMime: r.avatar_mime,
    iconCid: r.icon_cid,
    iconMime: r.icon_mime,
    iconStatus: normalizeIconStatus(r.icon_status),
    iconReviewedBy: r.icon_reviewed_by,
    iconReviewedAt: r.icon_reviewed_at != null
      ? Number(r.icon_reviewed_at)
      : null,
    iconRejectedReason: r.icon_rejected_reason,
    iconAccessStatus: normalizeIconAccessStatus(r.icon_access_status),
    iconAccessEmail: r.icon_access_email,
    iconAccessRequestedAt: r.icon_access_requested_at != null
      ? Number(r.icon_access_requested_at)
      : null,
    iconAccessReviewedAt: r.icon_access_reviewed_at != null
      ? Number(r.icon_access_reviewed_at)
      : null,
    iconAccessReviewedBy: r.icon_access_reviewed_by,
    iconAccessDeniedReason: r.icon_access_denied_reason,
    takedownStatus: normalizeTakedownStatus(r.takedown_status),
    takedownReason: r.takedown_reason,
    takedownBy: r.takedown_by,
    takedownAt: r.takedown_at != null ? Number(r.takedown_at) : null,
    pdsUrl: r.pds_url,
    recordCid: r.record_cid,
    recordRev: r.record_rev,
    createdAt: Number(r.created_at),
    indexedAt: Number(r.indexed_at),
  };
  if (r.featured_badges != null || r.featured_position != null) {
    out.featured = {
      badges: safeJsonArray(r.featured_badges),
      position: Number(r.featured_position ?? 0),
    };
  }
  return out;
}

export interface UpsertProfileInput {
  did: string;
  handle: string;
  profileType?: ProfileType;
  name: string;
  description: string;
  /** Optional: nullable for legacy records that pre-date the field.
   *  Stored as the textual URL; the registry UI/API enforce required-ness
   *  + URL shape on writes. */
  mainLink?: string | null;
  iosLink?: string | null;
  androidLink?: string | null;
  /** Required for project profiles; empty for user profiles. */
  categories: string[];
  subcategories: string[];
  links?: LinkEntry[] | null;
  screenshots?: ScreenshotEntry[] | null;
  avatarCid?: string | null;
  avatarMime?: string | null;
  iconCid?: string | null;
  iconMime?: string | null;
  pdsUrl: string;
  recordCid: string;
  recordRev: string;
  createdAt: number;
}

export async function upsertProfile(input: UpsertProfileInput): Promise<void> {
  const now = Date.now();
  const profileType = input.profileType ?? "project";
  // Defensive dedupe + drop empties; the lexicon validator already does
  // this but the worker also calls upsertProfile from the Jetstream path,
  // and the registry invariant (categories non-empty) is worth enforcing
  // close to the SQL.
  const cats = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of input.categories) {
      if (typeof c === "string" && c && !seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  })();
  if (profileType === "project" && cats.length === 0) {
    throw new Error("upsertProfile: categories[] is required and non-empty");
  }
  /**
   * Initial icon_status for the INSERT branch only (i.e. brand-new
   * profile rows): always NULL because per-project verification can't
   * possibly have happened yet — the user has to publish the profile,
   * then request access. The ON CONFLICT branch below decides the
   * status by reading the existing row's icon_access_status.
   */
  const initialIconStatus: string | null = null;
  await withDb(async (c) => {
    await c.execute({
      sql: `
        INSERT INTO profile (
          did, handle, profile_type, name, description, main_link, ios_link, android_link,
          categories, subcategories, links, screenshots,
          avatar_cid, avatar_mime, icon_cid, icon_mime, icon_status,
          icon_reviewed_by, icon_reviewed_at, icon_rejected_reason,
          icon_access_status, icon_access_email, icon_access_requested_at,
          icon_access_reviewed_at, icon_access_reviewed_by,
          icon_access_denied_reason,
          takedown_status, takedown_reason, takedown_by, takedown_at,
          pds_url, record_cid, record_rev, created_at, indexed_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL,
          ?, ?, ?, ?, ?
        )
        ON CONFLICT(did) DO UPDATE SET
          handle=excluded.handle,
          profile_type=excluded.profile_type,
          name=excluded.name,
          description=excluded.description,
          main_link=excluded.main_link,
          ios_link=excluded.ios_link,
          android_link=excluded.android_link,
          categories=excluded.categories,
          subcategories=excluded.subcategories,
          links=excluded.links,
          screenshots=excluded.screenshots,
          avatar_cid=excluded.avatar_cid,
          avatar_mime=excluded.avatar_mime,
          icon_cid=excluded.icon_cid,
          icon_mime=excluded.icon_mime,
          /**
           * Per-project verification gate.
           *   - No icon → NULL (nothing to review).
           *   - Same icon as before → preserve existing status.
           *   - New icon AND project verified → auto-approve (the
           *     gate is at the project level, not per-icon).
           *   - New icon AND project NOT verified → 'pending'. The
           *     PUT API refuses unverified uploads server-side, so
           *     this branch only fires for firehose writes from a
           *     PDS path that bypasses our gate; serving still
           *     refuses to render it because access != 'granted'.
           */
          icon_status = CASE
            WHEN excluded.icon_cid IS NULL THEN NULL
            WHEN profile.icon_cid IS NOT NULL AND profile.icon_cid = excluded.icon_cid THEN profile.icon_status
            WHEN profile.icon_access_status = 'granted' THEN 'approved'
            ELSE 'pending'
          END,
          icon_reviewed_by = CASE
            WHEN excluded.icon_cid IS NULL THEN NULL
            WHEN profile.icon_cid IS NOT NULL AND profile.icon_cid = excluded.icon_cid THEN profile.icon_reviewed_by
            ELSE NULL
          END,
          icon_reviewed_at = CASE
            WHEN excluded.icon_cid IS NULL THEN NULL
            WHEN profile.icon_cid IS NOT NULL AND profile.icon_cid = excluded.icon_cid THEN profile.icon_reviewed_at
            ELSE NULL
          END,
          icon_rejected_reason = CASE
            WHEN excluded.icon_cid IS NULL THEN NULL
            WHEN profile.icon_cid IS NOT NULL AND profile.icon_cid = excluded.icon_cid THEN profile.icon_rejected_reason
            ELSE NULL
          END,
          /**
           * Per-project verification state is admin-managed and must
           * survive any firehose-driven re-upsert. Same shape as the
           * takedown columns: only mutated by the dedicated grant /
           * deny / request helpers.
           */
          icon_access_status = profile.icon_access_status,
          icon_access_email = profile.icon_access_email,
          icon_access_requested_at = profile.icon_access_requested_at,
          icon_access_reviewed_at = profile.icon_access_reviewed_at,
          icon_access_reviewed_by = profile.icon_access_reviewed_by,
          icon_access_denied_reason = profile.icon_access_denied_reason,
          /**
           * Takedown columns are admin-only state and must survive any
           * firehose-driven re-upsert. We never overwrite them from the
           * INSERT branch's NULLs — they're only ever cleared explicitly
           * by restoreProfile() (or by the user deleting their record,
           * which DELETEs the row entirely).
           */
          takedown_status = profile.takedown_status,
          takedown_reason = profile.takedown_reason,
          takedown_by = profile.takedown_by,
          takedown_at = profile.takedown_at,
          pds_url=excluded.pds_url,
          record_cid=excluded.record_cid,
          record_rev=excluded.record_rev,
          created_at=excluded.created_at,
          indexed_at=excluded.indexed_at
      `,
      args: [
        input.did,
        input.handle,
        profileType,
        input.name,
        input.description,
        input.mainLink ?? null,
        input.iosLink ?? null,
        input.androidLink ?? null,
        JSON.stringify(cats),
        JSON.stringify(input.subcategories ?? []),
        JSON.stringify(input.links ?? []),
        JSON.stringify(input.screenshots ?? []),
        input.avatarCid ?? null,
        input.avatarMime ?? null,
        input.iconCid ?? null,
        input.iconMime ?? null,
        initialIconStatus,
        input.pdsUrl,
        input.recordCid,
        input.recordRev,
        input.createdAt,
        now,
      ],
    });
  });
}

/* -------------------------------------------------------------------------- *
 * Icon-access verification (per-project)                                      *
 * -------------------------------------------------------------------------- */

export interface IconAccessRequestRow {
  did: string;
  handle: string;
  name: string;
  email: string;
  requestedAt: number;
}

export interface GrantedIconAccessRow {
  did: string;
  handle: string;
  name: string;
  email: string | null;
  reviewedAt: number;
  reviewedBy: string;
}

export interface IconAccessLookupRow {
  did: string;
  handle: string;
  name: string;
  status: string | null;
}

/**
 * Open a verification request for the SVG-icon upload feature. The
 * caller must already own a published profile (DID matches the row).
 *
 * Allowed transitions:
 *   - `null` or `denied` → `requested`
 *
 * Returns `false` if the row is currently `requested` or `granted` (no
 * change required) or the row doesn't exist.
 */
export async function requestIconAccess(
  did: string,
  email: string,
): Promise<boolean> {
  const cleanEmail = email.trim().slice(0, 320);
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        UPDATE profile SET
          icon_access_status = 'requested',
          icon_access_email = ?,
          icon_access_requested_at = ?,
          icon_access_reviewed_at = NULL,
          icon_access_reviewed_by = NULL,
          icon_access_denied_reason = NULL
        WHERE did = ?
          AND (icon_access_status IS NULL OR icon_access_status = 'denied')
      `,
      args: [cleanEmail, Date.now(), did],
    });
    return Number(r.rowsAffected ?? 0) > 0;
  });
}

/** Grant icon-upload access. Allowed from any state. */
export async function grantIconAccess(
  did: string,
  reviewer: string,
): Promise<boolean> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        UPDATE profile SET
          icon_access_status = 'granted',
          icon_access_reviewed_at = ?,
          icon_access_reviewed_by = ?,
          icon_access_denied_reason = NULL,
          /**
           * If an icon is already on file (uploaded back when the
           * project was previously granted, then revoked, then granted
           * again), promote it straight to approved so the developer
           * API picks up serving without a republish from the user.
           */
          icon_status = CASE
            WHEN icon_cid IS NOT NULL THEN 'approved'
            ELSE icon_status
          END
        WHERE did = ?
      `,
      args: [Date.now(), reviewer, did],
    });
    return Number(r.rowsAffected ?? 0) > 0;
  });
}

/**
 * Resolve an admin-entered verification target. Accepts a DID or handle
 * (with or without a leading @). Taken-down rows are intentionally excluded:
 * takedown should be resolved before public verification is granted.
 */
export async function findIconAccessTarget(
  identifier: string,
): Promise<IconAccessLookupRow | null> {
  const raw = identifier.trim().replace(/^@/, "");
  if (!raw) return null;
  const where = raw.startsWith("did:")
    ? "p.did = ?"
    : "LOWER(p.handle) = LOWER(?)";
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        SELECT did, handle, name, icon_access_status
        FROM profile p
        WHERE ${where}
          AND p.takedown_status IS NULL
          AND p.profile_type = 'project'
        LIMIT 1
      `,
      args: [raw],
    });
    if (r.rows.length === 0) return null;
    const row = r.rows[0] as unknown as {
      did: string;
      handle: string;
      name: string;
      icon_access_status: string | null;
    };
    return {
      did: row.did,
      handle: row.handle,
      name: row.name,
      status: row.icon_access_status,
    };
  });
}

/**
 * Deny icon-upload access. Used both for the initial denial and to
 * revoke a previously-granted access (the row stays in 'denied' until
 * an admin manually re-opens via grantIconAccess).
 */
export async function denyIconAccess(
  did: string,
  reviewer: string,
  reason?: string,
): Promise<void> {
  const cleanReason = reason ? reason.trim().slice(0, 500) : null;
  await withDb(async (c) => {
    await c.execute({
      sql: `
        UPDATE profile SET
          icon_access_status = 'denied',
          icon_access_reviewed_at = ?,
          icon_access_reviewed_by = ?,
          icon_access_denied_reason = ?,
          /**
           * Stop serving any existing icon the moment access is
           * denied/revoked. The blob stays on the user's PDS untouched
           * (we don't have authority to delete it), but our serve route
           * checks icon_status alongside the access gate so flipping
           * this is enough to take it offline immediately.
           */
          icon_status = CASE
            WHEN icon_cid IS NOT NULL THEN 'rejected'
            ELSE icon_status
          END
        WHERE did = ?
      `,
      args: [Date.now(), reviewer, cleanReason, did],
    });
  });
}

/** Pending verification requests, oldest first (FIFO review queue). */
export async function listPendingIconAccess(): Promise<IconAccessRequestRow[]> {
  return await withDb(async (c) => {
    const r = await c.execute(`
      SELECT did, handle, name, icon_access_email, icon_access_requested_at
      FROM profile
      WHERE icon_access_status = 'requested'
        AND profile_type = 'project'
      ORDER BY icon_access_requested_at ASC
    `);
    return r.rows.map((row) => {
      const x = row as unknown as {
        did: string;
        handle: string;
        name: string;
        icon_access_email: string | null;
        icon_access_requested_at: number | null;
      };
      return {
        did: x.did,
        handle: x.handle,
        name: x.name,
        email: x.icon_access_email ?? "",
        requestedAt: x.icon_access_requested_at != null
          ? Number(x.icon_access_requested_at)
          : 0,
      };
    });
  });
}

export async function countPendingIconAccess(): Promise<number> {
  return await withDb(async (c) => {
    const r = await c.execute(
      `SELECT COUNT(*) AS n FROM profile WHERE icon_access_status = 'requested' AND profile_type = 'project'`,
    );
    return Number((r.rows[0] as Record<string, unknown>).n ?? 0);
  });
}

/** Active profiles that are not verified and are not already in the request queue. */
export async function listUnverifiedIconAccess(): Promise<
  IconAccessLookupRow[]
> {
  return await withDb(async (c) => {
    const r = await c.execute(`
      SELECT did, handle, name, icon_access_status
      FROM profile
      WHERE takedown_status IS NULL
        AND profile_type = 'project'
        AND (icon_access_status IS NULL OR icon_access_status = 'denied')
      ORDER BY indexed_at DESC
    `);
    return r.rows.map((row) => {
      const x = row as unknown as {
        did: string;
        handle: string;
        name: string;
        icon_access_status: string | null;
      };
      return {
        did: x.did,
        handle: x.handle,
        name: x.name,
        status: x.icon_access_status,
      };
    });
  });
}

/** Currently-verified projects, most-recently-granted first. */
export async function listGrantedIconAccess(): Promise<GrantedIconAccessRow[]> {
  return await withDb(async (c) => {
    const r = await c.execute(`
      SELECT did, handle, name, icon_access_email,
             icon_access_reviewed_at, icon_access_reviewed_by
      FROM profile
      WHERE icon_access_status = 'granted'
        AND profile_type = 'project'
      ORDER BY icon_access_reviewed_at DESC
    `);
    return r.rows.map((row) => {
      const x = row as unknown as {
        did: string;
        handle: string;
        name: string;
        icon_access_email: string | null;
        icon_access_reviewed_at: number | null;
        icon_access_reviewed_by: string | null;
      };
      return {
        did: x.did,
        handle: x.handle,
        name: x.name,
        email: x.icon_access_email,
        reviewedAt: x.icon_access_reviewed_at != null
          ? Number(x.icon_access_reviewed_at)
          : 0,
        reviewedBy: x.icon_access_reviewed_by ?? "",
      };
    });
  });
}

export async function deleteProfile(did: string): Promise<void> {
  await withDb(async (c) => {
    await c.execute({ sql: `DELETE FROM profile WHERE did = ?`, args: [did] });
  });
}

/* -------------------------------------------------------------------------- *
 * Profile-level moderation (takedowns)                                        *
 * -------------------------------------------------------------------------- */

export interface TakenDownProfileRow {
  did: string;
  handle: string;
  name: string;
  takedownReason: string;
  takedownBy: string;
  takedownAt: number;
}

/**
 * Mark a profile as taken down. The row stays in the DB (so the
 * indexer can preserve the takedown across firehose updates), but
 * default-filtered read paths exclude it. Idempotent — re-applying
 * just refreshes the reason/by/at fields.
 */
export async function takedownProfile(
  did: string,
  reason: string,
  by: string,
): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql: `
        UPDATE profile SET
          takedown_status = 'taken_down',
          takedown_reason = ?,
          takedown_by = ?,
          takedown_at = ?
        WHERE did = ?
      `,
      args: [reason.slice(0, 500), by, Date.now(), did],
    });
  });
}

/** Reverse a takedown — clears all four columns. */
export async function restoreProfile(did: string): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql: `
        UPDATE profile SET
          takedown_status = NULL,
          takedown_reason = NULL,
          takedown_by = NULL,
          takedown_at = NULL
        WHERE did = ?
      `,
      args: [did],
    });
  });
}

export async function listTakenDownProfiles(): Promise<TakenDownProfileRow[]> {
  return await withDb(async (c) => {
    const r = await c.execute(`
      SELECT did, handle, name, takedown_reason, takedown_by, takedown_at
      FROM profile
      WHERE takedown_status = 'taken_down'
      ORDER BY takedown_at DESC
    `);
    return r.rows.map((row) => {
      const x = row as unknown as {
        did: string;
        handle: string;
        name: string;
        takedown_reason: string | null;
        takedown_by: string | null;
        takedown_at: number | null;
      };
      return {
        did: x.did,
        handle: x.handle,
        name: x.name,
        takedownReason: x.takedown_reason ?? "",
        takedownBy: x.takedown_by ?? "",
        takedownAt: x.takedown_at != null ? Number(x.takedown_at) : 0,
      };
    });
  });
}

export async function countTakenDownProfiles(): Promise<number> {
  return await withDb(async (c) => {
    const r = await c.execute(
      `SELECT COUNT(*) AS n FROM profile WHERE takedown_status = 'taken_down'`,
    );
    return Number((r.rows[0] as Record<string, unknown>).n ?? 0);
  });
}

const SELECT_PROFILE = `
  SELECT p.*,
    f.badges AS featured_badges,
    f.position AS featured_position
  FROM profile p
  LEFT JOIN featured f ON f.did = p.did
`;

/**
 * Public read paths default to hiding taken-down profiles. Pass
 * `includeTakenDown: true` from owner-aware UI (e.g. /explore/manage)
 * and admin tooling that needs to inspect or restore the row.
 */
export interface ProfileLookupOptions {
  includeTakenDown?: boolean;
  profileType?: ProfileType | "any";
}

export async function getProfileByDid(
  did: string,
  opts: ProfileLookupOptions = {},
): Promise<ProfileRow | null> {
  const type = opts.profileType ?? "project";
  const where = [
    "p.did = ?",
    ...(opts.includeTakenDown ? [] : ["p.takedown_status IS NULL"]),
    ...(type === "any" ? [] : ["p.profile_type = ?"]),
  ];
  const args: InValue[] = type === "any" ? [did] : [did, type];
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `${SELECT_PROFILE} WHERE ${where.join(" AND ")} LIMIT 1`,
      args,
    });
    if (r.rows.length === 0) return null;
    return rowToProfile(r.rows[0] as unknown as RawProfileRow);
  });
}

export async function getProfileByHandle(
  handle: string,
  opts: ProfileLookupOptions = {},
): Promise<ProfileRow | null> {
  const type = opts.profileType ?? "project";
  const where = [
    "p.handle = ?",
    ...(opts.includeTakenDown ? [] : ["p.takedown_status IS NULL"]),
    ...(type === "any" ? [] : ["p.profile_type = ?"]),
  ];
  const args: InValue[] = type === "any" ? [handle] : [handle, type];
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `${SELECT_PROFILE} WHERE ${where.join(" AND ")} LIMIT 1`,
      args,
    });
    if (r.rows.length === 0) return null;
    return rowToProfile(r.rows[0] as unknown as RawProfileRow);
  });
}

export interface SearchOptions {
  query?: string;
  category?: string;
  subcategory?: string;
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  profiles: ProfileRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function searchProfiles(
  opts: SearchOptions,
): Promise<SearchResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(48, Math.max(1, opts.pageSize ?? 24));
  const offset = (page - 1) * pageSize;

  /**
   * Default-exclude taken-down profiles. There is no opt-in path for
   * search because surfacing taken-down rows in /explore would defeat
   * the purpose of the takedown; admin tooling reads via
   * `listTakenDownProfiles` instead.
   */
  const where: string[] = [
    "p.takedown_status IS NULL",
    "p.profile_type = 'project'",
  ];
  const args: InValue[] = [];

  if (opts.query && opts.query.trim()) {
    const q = opts.query.trim().replace(/["']/g, "");
    where.push(
      `p.rowid IN (SELECT rowid FROM profile_fts WHERE profile_fts MATCH ?)`,
    );
    args.push(`${q}*`);
  }
  if (opts.category) {
    where.push(
      `EXISTS (SELECT 1 FROM json_each(p.categories) WHERE value = ?)`,
    );
    args.push(opts.category);
  }
  if (opts.subcategory) {
    where.push(
      `EXISTS (SELECT 1 FROM json_each(p.subcategories) WHERE value = ?)`,
    );
    args.push(opts.subcategory);
  }

  const whereClause = `WHERE ${where.join(" AND ")}`;

  return await withDb(async (c) => {
    const countRes = await c.execute({
      sql: `SELECT COUNT(*) AS n FROM profile p ${whereClause}`,
      args,
    });
    const total = Number((countRes.rows[0] as Record<string, unknown>).n ?? 0);

    const rowsRes = await c.execute({
      sql: `
        ${SELECT_PROFILE}
        ${whereClause}
        ORDER BY
          CASE WHEN f.did IS NOT NULL THEN 0 ELSE 1 END,
          COALESCE(f.position, 999999) ASC,
          p.indexed_at DESC
        LIMIT ? OFFSET ?
      `,
      args: [...args, pageSize, offset],
    });

    return {
      profiles: rowsRes.rows.map((r) =>
        rowToProfile(r as unknown as RawProfileRow)
      ),
      total,
      page,
      pageSize,
    };
  });
}

/**
 * Lightweight projection of every profile in the registry, used by
 * admin curation UIs (featured picker, etc.). Skips JSON fields that
 * the picker doesn't need so the payload stays small even with
 * hundreds of entries.
 */
export interface ProfilePickerRow {
  did: string;
  handle: string;
  name: string;
}

export async function listAllProfilesForPicker(): Promise<ProfilePickerRow[]> {
  return await withDb(async (c) => {
    const r = await c.execute(
      `SELECT did, handle, name FROM profile
       WHERE takedown_status IS NULL AND profile_type = 'project'
       ORDER BY handle ASC`,
    );
    return r.rows.map((row) => {
      const x = row as unknown as { did: string; handle: string; name: string };
      return { did: x.did, handle: x.handle, name: x.name };
    });
  });
}

export async function listFeaturedProfiles(limit = 12): Promise<ProfileRow[]> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        ${SELECT_PROFILE}
        WHERE f.did IS NOT NULL AND p.takedown_status IS NULL
          AND p.profile_type = 'project'
        ORDER BY COALESCE(f.position, 999999) ASC, p.indexed_at DESC
        LIMIT ?
      `,
      args: [limit],
    });
    return r.rows.map((row) => rowToProfile(row as unknown as RawProfileRow));
  });
}

export interface UpsertFeaturedInput {
  did: string;
  badges: string[];
  position: number;
}

export async function replaceFeatured(
  entries: UpsertFeaturedInput[],
): Promise<void> {
  const now = Date.now();
  await withDb(async (c) => {
    await c.execute(`DELETE FROM featured`);
    for (const e of entries) {
      await c.execute({
        sql:
          `INSERT INTO featured (did, badges, position, added_at) VALUES (?, ?, ?, ?)`,
        args: [e.did, JSON.stringify(e.badges ?? []), e.position, now],
      });
    }
  });
}

/* -------------------------------------------------------------------------- *
 * Jetstream cursor                                                            *
 * -------------------------------------------------------------------------- */

export async function getJetstreamCursor(): Promise<number | null> {
  return await withDb(async (c) => {
    const r = await c.execute(
      `SELECT cursor FROM jetstream_cursor WHERE id = 1`,
    );
    if (r.rows.length === 0) return null;
    return Number((r.rows[0] as Record<string, unknown>).cursor);
  });
}

export async function setJetstreamCursor(cursor: number): Promise<void> {
  const now = Date.now();
  await withDb(async (c) => {
    await c.execute({
      sql: `
        INSERT INTO jetstream_cursor (id, cursor, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor, updated_at=excluded.updated_at
      `,
      args: [cursor, now],
    });
  });
}
