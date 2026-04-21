/**
 * Typed query helpers around the registry tables. Used by Fresh routes
 * (read APIs and SSR pages) and the indexer worker (writes).
 */
import type { InValue } from "@libsql/client";
import { withDb } from "./db.ts";
import type { FeaturedBadge, LinkEntry } from "./lexicons.ts";

export interface ProfileRow {
  did: string;
  handle: string;
  name: string;
  description: string;
  /** All categories that apply (always non-empty). The first item is the
   *  primary category used for sort/grouping in lists. */
  categories: string[];
  subcategories: string[];
  /** Outbound links (atmosphere services, website, custom) in author-defined order. */
  links: LinkEntry[];
  avatarCid: string | null;
  avatarMime: string | null;
  /** Optional developer-facing SVG icon. Not rendered on public profile. */
  iconCid: string | null;
  iconMime: string | null;
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
  name: string;
  description: string;
  categories: string;
  subcategories: string;
  links: string | null;
  avatar_cid: string | null;
  avatar_mime: string | null;
  icon_cid: string | null;
  icon_mime: string | null;
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

function rowToProfile(r: RawProfileRow): ProfileRow {
  const out: ProfileRow = {
    did: r.did,
    handle: r.handle,
    name: r.name,
    description: r.description,
    categories: safeJsonArray(r.categories),
    subcategories: safeJsonArray(r.subcategories),
    links: safeJsonLinks(r.links),
    avatarCid: r.avatar_cid,
    avatarMime: r.avatar_mime,
    iconCid: r.icon_cid,
    iconMime: r.icon_mime,
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
  name: string;
  description: string;
  /** Required: 1-4 known category strings. The first is the primary. */
  categories: string[];
  subcategories: string[];
  links?: LinkEntry[] | null;
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
  if (cats.length === 0) {
    throw new Error("upsertProfile: categories[] is required and non-empty");
  }
  await withDb(async (c) => {
    await c.execute({
      sql: `
        INSERT INTO profile (
          did, handle, name, description, categories, subcategories, links,
          avatar_cid, avatar_mime, icon_cid, icon_mime, pds_url, record_cid,
          record_rev, created_at, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(did) DO UPDATE SET
          handle=excluded.handle,
          name=excluded.name,
          description=excluded.description,
          categories=excluded.categories,
          subcategories=excluded.subcategories,
          links=excluded.links,
          avatar_cid=excluded.avatar_cid,
          avatar_mime=excluded.avatar_mime,
          icon_cid=excluded.icon_cid,
          icon_mime=excluded.icon_mime,
          pds_url=excluded.pds_url,
          record_cid=excluded.record_cid,
          record_rev=excluded.record_rev,
          created_at=excluded.created_at,
          indexed_at=excluded.indexed_at
      `,
      args: [
        input.did,
        input.handle,
        input.name,
        input.description,
        JSON.stringify(cats),
        JSON.stringify(input.subcategories ?? []),
        JSON.stringify(input.links ?? []),
        input.avatarCid ?? null,
        input.avatarMime ?? null,
        input.iconCid ?? null,
        input.iconMime ?? null,
        input.pdsUrl,
        input.recordCid,
        input.recordRev,
        input.createdAt,
        now,
      ],
    });
  });
}

export async function deleteProfile(did: string): Promise<void> {
  await withDb(async (c) => {
    await c.execute({ sql: `DELETE FROM profile WHERE did = ?`, args: [did] });
  });
}

const SELECT_PROFILE = `
  SELECT p.*,
    f.badges AS featured_badges,
    f.position AS featured_position
  FROM profile p
  LEFT JOIN featured f ON f.did = p.did
`;

export async function getProfileByDid(did: string): Promise<ProfileRow | null> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `${SELECT_PROFILE} WHERE p.did = ? LIMIT 1`,
      args: [did],
    });
    if (r.rows.length === 0) return null;
    return rowToProfile(r.rows[0] as unknown as RawProfileRow);
  });
}

export async function getProfileByHandle(
  handle: string,
): Promise<ProfileRow | null> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `${SELECT_PROFILE} WHERE p.handle = ? LIMIT 1`,
      args: [handle],
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

  const where: string[] = [];
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

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

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

export async function listFeaturedProfiles(limit = 12): Promise<ProfileRow[]> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        ${SELECT_PROFILE}
        WHERE f.did IS NOT NULL
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
