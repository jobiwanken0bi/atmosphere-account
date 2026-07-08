import type { DbClient } from "./db.ts";
import {
  checkDurableRateLimit,
  checkRateLimit,
  withRateLimit,
} from "./rate-limit.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

function request(ip: string): Request {
  return new Request("https://atmosphereaccount.com/api/test", {
    headers: { "x-forwarded-for": ip },
  });
}

function fakeRateLimitDb() {
  const rows = new Map<
    string,
    { count: number; resetAt: number; updatedAt: number }
  >();
  const client: DbClient = {
    async execute(query) {
      await Promise.resolve();
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : query.args ?? [];
      if (/SELECT count, reset_at\s+FROM rate_limit_bucket/i.test(sql)) {
        const key = String(args[0] ?? "");
        const row = rows.get(key);
        return {
          rows: row ? [{ count: row.count, reset_at: row.resetAt }] : [],
          rowsAffected: 0,
        };
      }
      if (/INSERT INTO rate_limit_bucket/i.test(sql)) {
        const key = String(args[0] ?? "");
        if (rows.has(key)) throw new Error("UNIQUE constraint failed");
        rows.set(key, {
          count: 1,
          resetAt: Number(args[1] ?? 0),
          updatedAt: Number(args[2] ?? 0),
        });
        return { rows: [], rowsAffected: 1 };
      }
      if (/SET count = 1/i.test(sql)) {
        const key = String(args[2] ?? "");
        const expectedResetAt = Number(args[3] ?? 0);
        const row = rows.get(key);
        if (!row || row.resetAt !== expectedResetAt) {
          return { rows: [], rowsAffected: 0 };
        }
        row.count = 1;
        row.resetAt = Number(args[0] ?? 0);
        row.updatedAt = Number(args[1] ?? 0);
        return { rows: [], rowsAffected: 1 };
      }
      if (/SET count = count \+ 1/i.test(sql)) {
        const key = String(args[1] ?? "");
        const expectedResetAt = Number(args[2] ?? 0);
        const expectedCount = Number(args[3] ?? 0);
        const row = rows.get(key);
        if (
          !row || row.resetAt !== expectedResetAt ||
          row.count !== expectedCount
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        row.count += 1;
        row.updatedAt = Number(args[0] ?? 0);
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const withDb = async <T>(fn: (c: DbClient) => Promise<T>): Promise<T> =>
    await fn(client);
  return { rows, withDb };
}

Deno.test("rate limits are scoped independently", () => {
  const ip = "203.0.113.10";
  const shared = {
    capacity: 2,
    refillMs: 60_000,
    now: 1_000,
  };

  assertEquals(
    checkRateLimit(request(ip), { ...shared, scope: "scope-a" }),
    { ok: true },
  );
  assertEquals(
    checkRateLimit(request(ip), { ...shared, scope: "scope-a" }),
    { ok: true },
  );
  assertEquals(
    checkRateLimit(request(ip), { ...shared, scope: "scope-a" }),
    { ok: false, retryAfter: 60 },
  );
  assertEquals(
    checkRateLimit(request(ip), { ...shared, scope: "scope-b" }),
    { ok: true },
  );
});

Deno.test("rate limit buckets refill over time", () => {
  const ip = "203.0.113.11";
  const scope = "refill-test";
  assertEquals(
    checkRateLimit(request(ip), {
      scope,
      capacity: 1,
      refillMs: 1_000,
      now: 2_000,
    }),
    { ok: true },
  );
  assertEquals(
    checkRateLimit(request(ip), {
      scope,
      capacity: 1,
      refillMs: 1_000,
      now: 2_500,
    }),
    { ok: false, retryAfter: 1 },
  );
  assertEquals(
    checkRateLimit(request(ip), {
      scope,
      capacity: 1,
      refillMs: 1_000,
      now: 3_000,
    }),
    { ok: true },
  );
});

Deno.test("rate limits ignore invalid numeric options", () => {
  assertEquals(
    checkRateLimit(request("203.0.113.13"), {
      scope: "invalid-options-test",
      capacity: Number.NaN,
      refillMs: Number.NaN,
      now: 5_000,
    }),
    { ok: true },
  );
});

Deno.test("withRateLimit returns retry-after on 429", async () => {
  const handler = withRateLimit(
    (_ctx: { req: Request }) => new Response("ok"),
    {
      scope: "wrapper-test",
      capacity: 1,
      refillMs: 2_000,
      now: 4_000,
    },
  );
  const ctx = { req: request("203.0.113.12") };

  assertEquals((await handler(ctx)).status, 200);
  const limited = await handler(ctx);
  assertEquals(limited.status, 429);
  assertEquals(limited.headers.get("retry-after"), "2");
});

Deno.test("durable rate limits share fixed-window buckets", async () => {
  const fake = fakeRateLimitDb();
  const opts = {
    scope: "durable-window-test",
    capacity: 2,
    refillMs: 60_000,
    keySecret: "test-secret",
    withDb: fake.withDb,
  };
  const req = request("203.0.113.20");

  assertEquals(
    await checkDurableRateLimit(req, { ...opts, now: 1_000 }),
    { ok: true },
  );
  assertEquals(
    await checkDurableRateLimit(req, { ...opts, now: 2_000 }),
    { ok: true },
  );
  assertEquals(
    await checkDurableRateLimit(req, { ...opts, now: 3_000 }),
    { ok: false, retryAfter: 58 },
  );
  assertEquals(
    await checkDurableRateLimit(req, { ...opts, now: 61_000 }),
    { ok: true },
  );
});

Deno.test("durable rate limit bucket keys do not store raw IP addresses", async () => {
  const fake = fakeRateLimitDb();
  await checkDurableRateLimit(request("203.0.113.21"), {
    scope: "privacy-key-test",
    capacity: 1,
    refillMs: 60_000,
    keySecret: "test-secret",
    withDb: fake.withDb,
    now: 1_000,
  });
  const key = [...fake.rows.keys()][0] ?? "";
  assertEquals(key.startsWith("privacy-key-test:"), true);
  assertEquals(key.includes("203.0.113.21"), false);
});

Deno.test("durable rate limits fall back to memory if DB is unavailable", async () => {
  const result = await checkDurableRateLimit(request("203.0.113.22"), {
    scope: "durable-fallback-test",
    capacity: 1,
    refillMs: 60_000,
    keySecret: "test-secret",
    withDb: () => Promise.reject(new Error("db unavailable")),
    now: 1_000,
  });
  assertEquals(result, { ok: true });
});
