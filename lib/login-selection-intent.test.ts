import {
  createDbLoginSelectionIntentStore,
  createLoginSelectionIntent,
  type LoginSelectionIntentRecord,
  type LoginSelectionIntentStore,
  readLoginSelectionIntent,
} from "./login-selection-intent.ts";
import type { DbClient } from "./db.ts";

const request = {
  clientId: "https://app.example/client.json",
  returnUri: "https://app.example/callback",
  state: "state-value",
  scope: "atproto",
};
const now = 1_800_000_000_000;

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

function memoryStore(): LoginSelectionIntentStore {
  const records = new Map<string, LoginSelectionIntentRecord>();
  return {
    save(record) {
      if (records.has(record.codeHash)) {
        throw new Error("duplicate primary key");
      }
      records.set(record.codeHash, structuredClone(record));
      return Promise.resolve();
    },
    consume(codeHash, at) {
      const record = records.get(codeHash);
      if (!record || record.expiresAt < at) return Promise.resolve(null);
      records.delete(codeHash);
      return Promise.resolve(structuredClone(record));
    },
  };
}

Deno.test("selection intent is short, opaque, and bound to the login request", async () => {
  const store = memoryStore();
  const code = await createLoginSelectionIntent(request, "did:plc:one", {
    now,
    store,
  });
  assertEquals(code.length, 24);
  assertEquals(code.includes("app.example"), false);
  assertEquals(
    await readLoginSelectionIntent(code, { now: now + 60_000, store }),
    { did: "did:plc:one", request },
  );
});

Deno.test("selection intent is one-time and rejects tampering and expiry", async () => {
  const store = memoryStore();
  const code = await createLoginSelectionIntent(request, "did:plc:one", {
    now,
    store,
  });
  const tampered = `${code.slice(0, -1)}${code.endsWith("a") ? "b" : "a"}`;
  assertEquals(
    await readLoginSelectionIntent(tampered, { now, store }),
    null,
  );
  assertEquals(
    await readLoginSelectionIntent(code, { now: now + 6 * 60_000, store }),
    null,
  );

  const fresh = await createLoginSelectionIntent(request, "did:plc:one", {
    now,
    store,
  });
  assertEquals(
    await readLoginSelectionIntent(fresh, { now, store }),
    { did: "did:plc:one", request },
  );
  assertEquals(await readLoginSelectionIntent(fresh, { now, store }), null);
});

Deno.test("database selection intent store consumes a code atomically", async () => {
  const rows = new Map<string, Record<string, unknown>>();
  const client: DbClient = {
    execute(query) {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : query.args ?? [];
      if (/INSERT INTO login_picker_intent/i.test(sql)) {
        const codeHash = String(args[0]);
        rows.set(codeHash, {
          code_hash: codeHash,
          did: args[1],
          client_id: args[2],
          return_uri: args[3],
          state: args[4],
          scope: args[5],
          created_at: args[6],
          expires_at: args[7],
          consumed_at: null,
        });
        return Promise.resolve({ rows: [], rowsAffected: 1 });
      }
      if (/SELECT code_hash, did, client_id/i.test(sql)) {
        const row = rows.get(String(args[0]));
        const available = row && row.consumed_at == null &&
          Number(row.expires_at) >= Number(args[1]);
        return Promise.resolve({
          rows: available ? [row] : [],
          rowsAffected: 0,
        });
      }
      if (/UPDATE login_picker_intent/i.test(sql)) {
        const row = rows.get(String(args[1]));
        if (
          !row || row.consumed_at != null ||
          Number(row.expires_at) < Number(args[2])
        ) return Promise.resolve({ rows: [], rowsAffected: 0 });
        row.consumed_at = args[0];
        return Promise.resolve({ rows: [], rowsAffected: 1 });
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const store = createDbLoginSelectionIntentStore(async (fn) =>
    await fn(client)
  );
  const code = await createLoginSelectionIntent(request, "did:plc:one", {
    now,
    store,
  });

  assertEquals(
    await readLoginSelectionIntent(code, { now, store }),
    { did: "did:plc:one", request },
  );
  assertEquals(await readLoginSelectionIntent(code, { now, store }), null);
});
