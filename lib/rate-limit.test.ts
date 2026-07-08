import { checkRateLimit, withRateLimit } from "./rate-limit.ts";

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
