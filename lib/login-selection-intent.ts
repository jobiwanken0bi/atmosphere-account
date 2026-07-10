import type { LoginRequest } from "./atmosphere-login.ts";
import type { DbClient } from "./db.ts";
import { randomB64u, sha256B64u } from "./jose.ts";

const INTENT_TTL_MS = 5 * 60_000;
const INTENT_CODE_BYTES = 18;
const INTENT_CODE_PATTERN = /^[A-Za-z0-9_-]{24}$/;

export interface LoginSelectionIntentRecord {
  codeHash: string;
  did: string;
  request: LoginRequest;
  createdAt: number;
  expiresAt: number;
}

export interface LoginSelectionIntentStore {
  save(record: LoginSelectionIntentRecord): Promise<void>;
  consume(
    codeHash: string,
    now: number,
  ): Promise<LoginSelectionIntentRecord | null>;
}

interface LoginSelectionIntentOptions {
  now?: number;
  store?: LoginSelectionIntentStore;
}

export async function createLoginSelectionIntent(
  request: LoginRequest,
  did: string,
  options: LoginSelectionIntentOptions = {},
): Promise<string> {
  if (!did.startsWith("did:") || !isCompleteRequest(request)) {
    throw new Error("invalid login selection intent");
  }
  const now = options.now ?? Date.now();
  const store = options.store ?? dbLoginSelectionIntentStore;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomB64u(INTENT_CODE_BYTES);
    const record: LoginSelectionIntentRecord = {
      codeHash: await sha256B64u(code),
      did,
      request,
      createdAt: now,
      expiresAt: now + INTENT_TTL_MS,
    };
    try {
      await store.save(record);
      return code;
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 2) throw error;
    }
  }
  throw new Error("could not create login selection intent");
}

export async function readLoginSelectionIntent(
  code: string,
  options: LoginSelectionIntentOptions = {},
): Promise<{ request: LoginRequest; did: string } | null> {
  if (!INTENT_CODE_PATTERN.test(code)) return null;
  const now = options.now ?? Date.now();
  const store = options.store ?? dbLoginSelectionIntentStore;
  const record = await store.consume(await sha256B64u(code), now);
  if (
    !record || record.expiresAt < now || !record.did.startsWith("did:") ||
    !isCompleteRequest(record.request)
  ) return null;
  return { did: record.did, request: record.request };
}

function isCompleteRequest(request: LoginRequest): boolean {
  return Boolean(
    request.clientId && request.returnUri && request.state &&
      (request.scope === null || typeof request.scope === "string"),
  );
}

function rowsAffected(result: { rowsAffected?: number | bigint }): number {
  return Number(result.rowsAffected ?? 0);
}

function rowToRecord(row: Record<string, unknown>): LoginSelectionIntentRecord {
  return {
    codeHash: String(row.code_hash ?? ""),
    did: String(row.did ?? ""),
    request: {
      clientId: String(row.client_id ?? ""),
      returnUri: String(row.return_uri ?? ""),
      state: String(row.state ?? ""),
      scope: row.scope == null ? null : String(row.scope),
    },
    createdAt: Number(row.created_at ?? 0),
    expiresAt: Number(row.expires_at ?? 0),
  };
}

export function createDbLoginSelectionIntentStore(
  run: <T>(fn: (client: DbClient) => Promise<T>) => Promise<T> = defaultWithDb,
): LoginSelectionIntentStore {
  return {
    async save(record) {
      await run(async (client) => {
        await client.execute({
          sql: `
            INSERT INTO login_picker_intent (
              code_hash, did, client_id, return_uri, state, scope,
              created_at, expires_at, consumed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
          `,
          args: [
            record.codeHash,
            record.did,
            record.request.clientId,
            record.request.returnUri,
            record.request.state,
            record.request.scope,
            record.createdAt,
            record.expiresAt,
          ],
        });
      });
    },
    async consume(codeHash, now) {
      return await run(async (client) => {
        const result = await client.execute({
          sql: `
            SELECT code_hash, did, client_id, return_uri, state, scope,
                   created_at, expires_at
            FROM login_picker_intent
            WHERE code_hash = ? AND consumed_at IS NULL AND expires_at >= ?
            LIMIT 1
          `,
          args: [codeHash, now],
        });
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) return null;
        const consumed = await client.execute({
          sql: `
            UPDATE login_picker_intent
            SET consumed_at = ?
            WHERE code_hash = ? AND consumed_at IS NULL AND expires_at >= ?
          `,
          args: [now, codeHash, now],
        });
        return rowsAffected(consumed) > 0 ? rowToRecord(row) : null;
      });
    },
  };
}

const dbLoginSelectionIntentStore = createDbLoginSelectionIntentStore();

async function defaultWithDb<T>(
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const { withDb } = await import("./db.ts");
  return await withDb(fn);
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|duplicate|primary key/i.test(message);
}
