/**
 * Typed query helpers around the registry tables. Used by Fresh routes
 * (read APIs and SSR pages) and the indexer worker (writes).
 */
import type { InValue } from "@libsql/client";
import { withDb } from "./db.ts";
import type { Category, FeaturedBadge } from "./lexicons.ts";

export interface ProfileRow {
  did: string;
  handle: string;
  name: string;
  description: string;
  category: Category | string;
  subcategories: string[];
  website: string | null;
  bskyClient: string | null;
  tags: string[];
  avatarCid: string | null;
  avatarMime: string | null;
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
  category: string;
  subcategories: string;
  website: string | null;
  bsky_client: string | null;
  tags: string;
  avatar_cid: string | null;
  avatar_mime: string | null;
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

function rowToProfile(r: RawProfileRow): ProfileRow {
  const out: ProfileRow = {
    did: r.did,
    handle: r.handle,
    name: r.name,
    description: r.description,
    category: r.category,
    subcategories: safeJsonArray(r.subcategories),
    website: r.website,
    bskyClient: r.bsky_client,
    tags: safeJsonArray(r.tags),
    avatarCid: r.avatar_cid,
    avatarMime: r.avatar_mime,
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
  category: string;
  subcategories: string[];
  website?: string | null;
  bskyClient?: string | null;
  tags: string[];
  avatarCid?: string | null;
  avatarMime?: string | null;
  pdsUrl: string;
  recordCid: string;
  recordRev: string;
  createdAt: number;
}

export async function upsertProfile(input: UpsertProfileInput): Promise<void> {
  const now = Date.now();
  await withDb(async (c) => {
    await c.execute({
      sql: `
        INSERT INTO profile (
          did, handle, name, description, category, subcategories,
          website, bsky_client, tags,
          avatar_cid, avatar_mime, pds_url, record_cid, record_rev,
          created_at, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(did) DO UPDATE SET
          handle=excluded.handle,
          name=excluded.name,
          description=excluded.description,
          category=excluded.category,
          subcategories=excluded.subcategories,
          website=excluded.website,
          bsky_client=excluded.bsky_client,
          tags=excluded.tags,
          avatar_cid=excluded.avatar_cid,
          avatar_mime=excluded.avatar_mime,
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
        input.category,
        JSON.stringify(input.subcategories ?? []),
        input.website ?? null,
        input.bskyClient ?? null,
        JSON.stringify(input.tags ?? []),
        input.avatarCid ?? null,
        input.avatarMime ?? null,
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
  SELECT p.*, f.badges AS featured_badges, f.position AS featured_position
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
    where.push(`p.category = ?`);
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
