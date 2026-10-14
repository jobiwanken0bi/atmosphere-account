import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ACCOUNT_COUNT_REFRESH_MS,
  isAccountCountSnapshot,
} from "./atmosphere-account-count.ts";
import {
  createJazAccountCounter,
  JAZ_ACCOUNT_COUNT_URL,
} from "./jaz-account-count.ts";

const START = Date.parse("2026-10-14T22:00:00Z");

function source(count = 47_008_258, at = START) {
  return Response.json({
    total_users: count,
    updated_at: new Date(at).toISOString(),
  });
}

// Let an intentionally detached refresh finish its response/body microtasks.
function finishBackgroundRefresh() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

Deno.test("warm requests return immediately while a tracker refresh is hanging", async () => {
  let clock = START;
  let requests = 0;
  let resolveRefresh!: (response: Response) => void;
  const counter = createJazAccountCounter({
    now: () => clock,
    request: () => {
      requests++;
      return requests === 1
        ? Promise.resolve(source())
        : new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
    },
  });
  const initial = await counter();
  clock += ACCOUNT_COUNT_REFRESH_MS;
  for (let i = 0; i < 3; i++) {
    assertEquals(
      await Promise.race([counter(), Promise.resolve("pending")]),
      initial,
    );
  }
  assertEquals(requests, 2);
  resolveRefresh(source(47_008_300, clock));
  await finishBackgroundRefresh();
  assertEquals((await counter())?.count, 47_008_300);
});

Deno.test("cold page requests do not wait and the API can share their pending fetch", async () => {
  let requests = 0;
  let resolveInitial!: (response: Response) => void;
  const counter = createJazAccountCounter({
    now: () => START,
    request: () => {
      requests++;
      return new Promise<Response>((resolve) => {
        resolveInitial = resolve;
      });
    },
  });
  assertEquals(
    await Promise.race([
      counter({ waitForInitial: false }),
      Promise.resolve("pending"),
    ]),
    null,
  );
  const api = counter();
  assertEquals(requests, 1);
  resolveInitial(source());
  assertEquals((await api)?.count, 47_008_258);
});

Deno.test("failed tracker responses cancel their unread bodies", async () => {
  let cancelled = false;
  const counter = createJazAccountCounter({
    now: () => START,
    request: () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status: 503 },
        ),
      ),
  });
  assertEquals(await counter(), null);
  assertEquals(cancelled, true);
});

Deno.test("Jaz requests are coalesced and cached across visitors", async () => {
  let requests = 0;
  let clock = START;
  const counter = createJazAccountCounter({
    now: () => clock,
    request: (url, options) => {
      requests++;
      assertEquals(url, JAZ_ACCOUNT_COUNT_URL);
      assertEquals(options?.redirect, "error");
      return Promise.resolve(source());
    },
  });
  const [a, b] = await Promise.all([counter(), counter()]);
  assertEquals(a, b);
  assertEquals(a?.count, 47_008_258);
  assertEquals(requests, 1);
  clock += ACCOUNT_COUNT_REFRESH_MS - 1;
  await counter();
  assertEquals(requests, 1);
  clock++;
  await counter();
  assertEquals(requests, 2);
  await finishBackgroundRefresh();
});

Deno.test("Jaz outage retains the last verified count and throttles retries", async () => {
  let requests = 0;
  let clock = START;
  const counter = createJazAccountCounter({
    now: () => clock,
    request: () => {
      requests++;
      return Promise.resolve(
        requests === 1 ? source() : new Response(null, { status: 503 }),
      );
    },
  });
  const initial = await counter();
  clock += ACCOUNT_COUNT_REFRESH_MS;
  assertEquals(await counter(), initial);
  assertEquals(await counter(), initial);
  assertEquals(requests, 2);
  await finishBackgroundRefresh();
  clock += 8 * 24 * 60 * 60 * 1000;
  assertEquals(await counter(), null);
});

Deno.test("failed cold requests never invent a count and can recover", async () => {
  let clock = START;
  let requests = 0;
  const counter = createJazAccountCounter({
    now: () => clock,
    request: () => {
      requests++;
      return requests === 1
        ? Promise.reject(new Error("Offline"))
        : Promise.resolve(source());
    },
  });
  assertEquals(await counter(), null);
  assertEquals(await counter(), null);
  assertEquals(requests, 1);
  clock += ACCOUNT_COUNT_REFRESH_MS;
  assertEquals((await counter())?.count, 47_008_258);
});

Deno.test("malformed, stale and oversized Jaz data cannot replace a verified count", async () => {
  const invalid = [
    Response.json({
      total_users: "47000000",
      updated_at: new Date(START).toISOString(),
    }),
    source(-1),
    source(47_000_000.5),
    source(47_000_000, START - 2 * 24 * 60 * 60 * 1000),
    source(47_000_000, START + 5 * 60 * 1000),
    Response.json({ total_users: 47_000_000, updated_at: "invalid" }),
    new Response("not JSON"),
    new Response(" ".repeat(1_048_577)),
  ];
  for (const response of invalid) {
    let clock = START;
    let requests = 0;
    const counter = createJazAccountCounter({
      now: () => clock,
      request: () => Promise.resolve(++requests === 1 ? source() : response),
    });
    const initial = await counter();
    clock += ACCOUNT_COUNT_REFRESH_MS;
    assertEquals(await counter(), initial);
    await finishBackgroundRefresh();
  }
});

Deno.test("new snapshots can decrease the count but older snapshots cannot regress it", async () => {
  let clock = START;
  let requests = 0;
  const replies = [
    source(),
    source(47_008_000, START + 60_000),
    source(47_009_000, START),
  ];
  const counter = createJazAccountCounter({
    now: () => clock,
    request: () => Promise.resolve(replies[requests++]),
  });
  await counter();
  clock += ACCOUNT_COUNT_REFRESH_MS;
  await counter();
  await finishBackgroundRefresh();
  const next = await counter();
  assertEquals(next?.count, 47_008_000);
  clock += ACCOUNT_COUNT_REFRESH_MS;
  assertEquals(await counter(), next);
  await finishBackgroundRefresh();
  assertEquals(await counter(), next);
});

Deno.test("client snapshots reject invalid timestamps and expired saved values", () => {
  const value = {
    count: 47_008_258,
    updatedAt: new Date(START).toISOString(),
    checkedAt: new Date(START).toISOString(),
  };
  assertEquals(isAccountCountSnapshot(value, START), true);
  assertEquals(
    isAccountCountSnapshot(value, START + 8 * 24 * 60 * 60 * 1000),
    false,
  );
  assertEquals(
    isAccountCountSnapshot({ ...value, count: "47008258" }, START),
    false,
  );
  assertEquals(
    isAccountCountSnapshot({ ...value, updatedAt: "invalid" }, START),
    false,
  );
  assertEquals(isAccountCountSnapshot(null, START), false);
});

Deno.test("Jaz historical series fit within the bounded response", async () => {
  const counter = createJazAccountCounter({
    now: () => START,
    request: () =>
      Promise.resolve(Response.json({
        total_users: 47_008_258,
        updated_at: new Date(START).toISOString(),
        history: "x".repeat(250_000),
      })),
  });
  assertEquals((await counter())?.count, 47_008_258);
});

Deno.test("a timed-out source request does not prevent account creation", async () => {
  const counter = createJazAccountCounter({
    now: () => START,
    timeoutMs: 10,
    request: (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new Error("Timed out")), { once: true });
      }),
  });
  assertEquals(await counter(), null);
});
