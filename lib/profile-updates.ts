import { withDb } from "./db.ts";
import { UPDATE_NSID, type UpdateRecord } from "./lexicons.ts";

export const MAX_UPDATE_TITLE_LENGTH = 80;
export const MAX_UPDATE_BODY_LENGTH = 1000;
export const MAX_UPDATE_VERSION_LENGTH = 32;

export interface ProfileUpdateRow {
  uri: string;
  cid: string;
  rkey: string;
  projectDid: string;
  title: string;
  body: string;
  version: string | null;
  tangledCommitUrl: string | null;
  tangledRepoUrl: string | null;
  source: string;
  status: "visible" | "removed";
  createdAt: number;
  updatedAt: number;
  indexedAt: number;
}

interface RawProfileUpdateRow {
  uri: string;
  cid: string;
  rkey: string;
  project_did: string;
  title: string;
  body: string;
  version: string | null;
  tangled_commit_url: string | null;
  tangled_repo_url: string | null;
  source: string;
  status: string;
  created_at: number;
  updated_at: number;
  indexed_at: number;
}

function rowToUpdate(row: RawProfileUpdateRow): ProfileUpdateRow {
  return {
    uri: row.uri,
    cid: row.cid,
    rkey: row.rkey,
    projectDid: row.project_did,
    title: row.title,
    body: row.body,
    version: row.version,
    tangledCommitUrl: row.tangled_commit_url,
    tangledRepoUrl: row.tangled_repo_url,
    source: row.source || "manual",
    status: row.status === "removed" ? "removed" : "visible",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    indexedAt: Number(row.indexed_at),
  };
}

export function updateUriForRkey(projectDid: string, rkey: string): string {
  return `at://${projectDid}/${UPDATE_NSID}/${rkey}`;
}

export function createUpdateRkey(): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `update-${Date.now().toString(36)}-${rand}`;
}

export function updateRowToRecord(update: ProfileUpdateRow): UpdateRecord {
  return {
    title: update.title,
    body: update.body,
    version: update.version ?? undefined,
    tangledCommitUrl: update.tangledCommitUrl ?? undefined,
    tangledRepoUrl: update.tangledRepoUrl ?? undefined,
    source: update.source,
    createdAt: new Date(update.createdAt).toISOString(),
    updatedAt: new Date(update.updatedAt).toISOString(),
  };
}

export async function upsertProfileUpdate(input: {
  uri: string;
  cid: string;
  rkey: string;
  projectDid: string;
  title: string;
  body: string;
  version?: string | null;
  tangledCommitUrl?: string | null;
  tangledRepoUrl?: string | null;
  source?: string | null;
  createdAt: number;
  updatedAt: number;
}): Promise<ProfileUpdateRow> {
  return await withDb(async (c) => {
    const now = Date.now();
    await c.execute({
      sql: `
        INSERT INTO profile_update (
          uri, cid, rkey, project_did, title, body, version,
          tangled_commit_url, tangled_repo_url, source, status,
          created_at, updated_at, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?, ?)
        ON CONFLICT(uri) DO UPDATE SET
          cid = excluded.cid,
          rkey = excluded.rkey,
          project_did = excluded.project_did,
          title = excluded.title,
          body = excluded.body,
          version = excluded.version,
          tangled_commit_url = excluded.tangled_commit_url,
          tangled_repo_url = excluded.tangled_repo_url,
          source = excluded.source,
          status = 'visible',
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          indexed_at = excluded.indexed_at
      `,
      args: [
        input.uri,
        input.cid,
        input.rkey,
        input.projectDid,
        input.title,
        input.body,
        input.version ?? null,
        input.tangledCommitUrl ?? null,
        input.tangledRepoUrl ?? null,
        input.source ?? "manual",
        input.createdAt,
        input.updatedAt,
        now,
      ],
    });
    const update = await getProfileUpdateByRkey(input.projectDid, input.rkey, {
      includeRemoved: true,
    });
    if (!update) throw new Error("profile_update_write_failed");
    return update;
  });
}

export async function markProfileUpdateRemovedByRkey(
  projectDid: string,
  rkey: string,
): Promise<boolean> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        UPDATE profile_update SET
          status = 'removed',
          updated_at = ?,
          indexed_at = ?
        WHERE project_did = ? AND rkey = ? AND status != 'removed'
      `,
      args: [Date.now(), Date.now(), projectDid, rkey],
    });
    return Number(r.rowsAffected ?? 0) > 0;
  });
}

export async function getProfileUpdateByRkey(
  projectDid: string,
  rkey: string,
  opts: { includeRemoved?: boolean } = {},
): Promise<ProfileUpdateRow | null> {
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        SELECT *
        FROM profile_update
        WHERE project_did = ? AND rkey = ?
          ${opts.includeRemoved ? "" : "AND status = 'visible'"}
        LIMIT 1
      `,
      args: [projectDid, rkey],
    });
    const row = r.rows[0] as unknown as RawProfileUpdateRow | undefined;
    return row ? rowToUpdate(row) : null;
  });
}

export async function listProfileUpdates(
  projectDid: string,
  opts: { limit?: number; includeRemoved?: boolean } = {},
): Promise<ProfileUpdateRow[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 6, 25));
  return await withDb(async (c) => {
    const r = await c.execute({
      sql: `
        SELECT *
        FROM profile_update
        WHERE project_did = ?
          ${opts.includeRemoved ? "" : "AND status = 'visible'"}
        ORDER BY created_at DESC, indexed_at DESC
        LIMIT ?
      `,
      args: [projectDid, limit],
    });
    return r.rows.map((row) =>
      rowToUpdate(row as unknown as RawProfileUpdateRow)
    );
  });
}

export async function getLatestProfileUpdate(
  projectDid: string,
): Promise<ProfileUpdateRow | null> {
  const rows = await listProfileUpdates(projectDid, { limit: 1 });
  return rows[0] ?? null;
}
