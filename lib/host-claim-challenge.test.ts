import {
  consumeHostClaimChallenge,
  type HostClaimChallengeRecord,
  reserveHostClaimChallenge,
} from "./host-claim-challenge.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

const record: HostClaimChallengeRecord = {
  tokenHash: "dns-token-hash",
  host: "pds.example",
  claimantDid: "did:plc:operator",
  claimantHandle: "operator.example",
  methodFingerprint: "dns-v1:fingerprint",
  createdAt: 5_000,
  expiresAt: 10_000,
  consumedAt: null,
};

const limits = { since: 0, host: 5, claimant: 10, method: 5 };

Deno.test("database challenge reservations take the advisory lock before count and insert", async () => {
  const statements: string[] = [];
  const reserved = await reserveHostClaimChallenge(
    {
      execute(query) {
        const sql = typeof query === "string" ? query : query.sql;
        statements.push(sql);
        if (sql.includes("SUM(CASE WHEN host")) {
          return Promise.resolve({
            rows: [{ host_count: 4, claimant_count: 4, method_count: 4 }],
            rowsAffected: 0,
          });
        }
        return Promise.resolve({ rows: [], rowsAffected: 1 });
      },
    },
    record,
    limits,
    { postgresBackend: true },
  );
  assertEquals(reserved, true);
  assert(statements[0].includes("pg_advisory_xact_lock"));
  assert(statements[1].startsWith("DELETE FROM"));
  assert(statements[2].includes("SUM(CASE WHEN host"));
  assert(statements[3].includes("INSERT INTO account_host_claim_challenge"));
});

Deno.test("serialized concurrent reservations cannot overrun the host limit", async () => {
  const saved: HostClaimChallengeRecord[] = [];
  let queue = Promise.resolve();
  const reserveOne = (index: number) => {
    const run = queue.then(async () => {
      const candidate = { ...record, tokenHash: `token-${index}` };
      return await reserveHostClaimChallenge(
        {
          execute(query) {
            const sql = typeof query === "string" ? query : query.sql;
            if (sql.includes("SUM(CASE WHEN host")) {
              const count = saved.filter((item) => item.host === candidate.host)
                .length;
              return Promise.resolve({
                rows: [{
                  host_count: count,
                  claimant_count: count,
                  method_count: count,
                }],
                rowsAffected: 0,
              });
            }
            if (sql.includes("INSERT INTO account_host_claim_challenge")) {
              saved.push(candidate);
            }
            return Promise.resolve({ rows: [], rowsAffected: 1 });
          },
        },
        candidate,
        limits,
        { postgresBackend: true },
      );
    });
    queue = run.then(() => undefined);
    return run;
  };
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, index) => reserveOne(index)),
  );
  assertEquals(results.filter(Boolean).length, 5);
  assertEquals(saved.length, 5);
});

Deno.test("guarded consume binds token, host, DID, lifetime, and replay state", async () => {
  let updateArgs: unknown[] = [];
  assertEquals(
    await consumeHostClaimChallenge(
      {
        execute(query) {
          assert(typeof query !== "string");
          updateArgs = query.args ?? [];
          return Promise.resolve({ rows: [], rowsAffected: 1 });
        },
      },
      {
        tokenHash: record.tokenHash,
        host: record.host,
        claimantDid: record.claimantDid,
        consumedAt: 7_000,
      },
    ),
    { ok: true },
  );
  assertEquals(updateArgs, [
    7_000,
    record.tokenHash,
    record.host,
    record.claimantDid,
    7_000,
  ]);

  for (
    const [row, reason] of [
      [null, "invalid"],
      [{ ...dbRow(), claimant_did: "did:plc:other" }, "account_mismatch"],
      [{ ...dbRow(), consumed_at: 6_000 }, "already_used"],
      [{ ...dbRow(), expires_at: 6_999 }, "expired"],
    ] as const
  ) {
    let call = 0;
    const result = await consumeHostClaimChallenge(
      {
        execute() {
          call += 1;
          return call === 1
            ? Promise.resolve({ rows: [], rowsAffected: 0 })
            : Promise.resolve({ rows: row ? [row] : [], rowsAffected: 0 });
        },
      },
      {
        tokenHash: record.tokenHash,
        host: record.host,
        claimantDid: record.claimantDid,
        consumedAt: 7_000,
      },
    );
    assertEquals(result, { ok: false, reason });
    assertEquals(call, 2);
  }
});

function dbRow(): Record<string, unknown> {
  return {
    host: record.host,
    claimant_did: record.claimantDid,
    expires_at: record.expiresAt,
    consumed_at: null,
  };
}
