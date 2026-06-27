import { withDb } from "./db.ts";

export interface WorkerLeaseStatus {
  name: string;
  ownerId: string;
  expiresAt: number;
  heartbeatAt: number;
  isFresh: boolean;
}

function rowsAffected(result: { rowsAffected?: number | bigint }): number {
  return Number(result.rowsAffected ?? 0);
}

export async function tryAcquireWorkerLease(
  name: string,
  ownerId: string,
  ttlMs: number,
  now = Date.now(),
): Promise<boolean> {
  const expiresAt = now + ttlMs;
  return await withDb(async (c) => {
    try {
      await c.execute({
        sql: `
          INSERT INTO worker_lease (
            name, owner_id, expires_at, heartbeat_at, created_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
        args: [name, ownerId, expiresAt, now, now],
      });
      return true;
    } catch {
      // Existing lease: fall through to conditional takeover/renewal.
    }

    const result = await c.execute({
      sql: `
        UPDATE worker_lease
        SET
          owner_id = ?,
          expires_at = ?,
          heartbeat_at = ?,
          created_at = CASE
            WHEN owner_id = ? THEN created_at
            ELSE ?
          END
        WHERE name = ?
          AND (owner_id = ? OR expires_at <= ?)
      `,
      args: [ownerId, expiresAt, now, ownerId, now, name, ownerId, now],
    });
    return rowsAffected(result) > 0;
  });
}

export async function renewWorkerLease(
  name: string,
  ownerId: string,
  ttlMs: number,
  now = Date.now(),
): Promise<boolean> {
  const result = await withDb(async (c) =>
    await c.execute({
      sql: `
        UPDATE worker_lease
        SET expires_at = ?, heartbeat_at = ?
        WHERE name = ? AND owner_id = ? AND expires_at > ?
      `,
      args: [now + ttlMs, now, name, ownerId, now],
    })
  );
  return rowsAffected(result) > 0;
}

export async function releaseWorkerLease(
  name: string,
  ownerId: string,
): Promise<void> {
  await withDb(async (c) => {
    await c.execute({
      sql: `DELETE FROM worker_lease WHERE name = ? AND owner_id = ?`,
      args: [name, ownerId],
    });
  });
}

export async function getWorkerLeaseStatus(
  name: string,
  now = Date.now(),
): Promise<WorkerLeaseStatus | null> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT name, owner_id, expires_at, heartbeat_at
        FROM worker_lease
        WHERE name = ?
        LIMIT 1
      `,
      args: [name],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const expiresAt = Number(row.expires_at ?? 0);
    return {
      name: String(row.name),
      ownerId: String(row.owner_id),
      expiresAt,
      heartbeatAt: Number(row.heartbeat_at ?? 0),
      isFresh: expiresAt > now,
    };
  });
}
