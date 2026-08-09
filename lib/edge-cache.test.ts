import { EdgeStaleCache } from "./edge-cache.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("EdgeStaleCache returns fresh value without reloading", async () => {
  let now = 1_000;
  let loads = 0;
  const cache = new EdgeStaleCache<number>({
    freshMs: 100,
    staleMs: 1_000,
    now: () => now,
  });

  assertEquals(await cache.get("key", () => Promise.resolve(++loads)), 1);
  now += 50;
  assertEquals(await cache.get("key", () => Promise.resolve(++loads)), 1);
  assertEquals(loads, 1);
});

Deno.test("EdgeStaleCache serves stale value while refreshing", async () => {
  let now = 1_000;
  let loads = 0;
  const cache = new EdgeStaleCache<number>({
    freshMs: 100,
    staleMs: 1_000,
    now: () => now,
  });

  assertEquals(await cache.get("key", () => Promise.resolve(++loads)), 1);
  now += 200;
  assertEquals(await cache.get("key", () => Promise.resolve(++loads)), 1);
  await Promise.resolve();
  assertEquals(await cache.get("key", () => Promise.resolve(++loads)), 2);
  assertEquals(loads, 2);
});

Deno.test("EdgeStaleCache coalesces concurrent cold loads", async () => {
  let resolveLoad!: (value: number) => void;
  let loads = 0;
  const cache = new EdgeStaleCache<number>({
    freshMs: 100,
    staleMs: 1_000,
  });
  const load = () => {
    loads++;
    return new Promise<number>((resolve) => {
      resolveLoad = resolve;
    });
  };

  const first = cache.get("key", load);
  const second = cache.get("key", load);
  resolveLoad(7);

  assertEquals(await first, 7);
  assertEquals(await second, 7);
  assertEquals(loads, 1);
});

Deno.test("EdgeStaleCache keeps stale value when refresh fails", async () => {
  let now = 1_000;
  const cache = new EdgeStaleCache<number>({
    freshMs: 100,
    staleMs: 1_000,
    now: () => now,
  });

  assertEquals(await cache.get("key", () => Promise.resolve(1)), 1);
  now += 200;
  assertEquals(
    await cache.get("key", () => Promise.reject(new Error("refresh failed"))),
    1,
  );
});

Deno.test("EdgeStaleCache rejects failed loads beyond stale window and recovers", async () => {
  let now = 1_000;
  let loads = 0;
  const cache = new EdgeStaleCache<number>({
    freshMs: 100,
    staleMs: 1_000,
    now: () => now,
  });

  assertEquals(await cache.get("key", () => Promise.resolve(++loads)), 1);
  now += 1_001;

  let message = "";
  try {
    await cache.get("key", () => {
      loads++;
      return Promise.reject(new Error("refresh failed"));
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message, "refresh failed");
  assertEquals(loads, 2);

  assertEquals(await cache.get("key", () => Promise.resolve(++loads)), 3);
  assertEquals(loads, 3);
});

Deno.test("EdgeStaleCache evicts the least recently used bounded entry", async () => {
  let loads = 0;
  const cache = new EdgeStaleCache<number>({
    freshMs: 1_000,
    staleMs: 10_000,
    maxEntries: 2,
  });
  const load = () => Promise.resolve(++loads);

  assertEquals(await cache.get("a", load), 1);
  assertEquals(await cache.get("b", load), 2);
  assertEquals(await cache.get("a", load), 1);
  assertEquals(await cache.get("c", load), 3);
  assertEquals(await cache.get("b", load), 4);
});

Deno.test("an evicted failed load cannot delete a newer recovery load", async () => {
  let rejectOld!: (error: Error) => void;
  let resolveNew!: (value: number) => void;
  const cache = new EdgeStaleCache<number>({
    freshMs: 100,
    staleMs: 1_000,
    maxEntries: 1,
  });

  const old = cache.get("a", () =>
    new Promise<number>((_resolve, reject) => {
      rejectOld = reject;
    }));
  await Promise.resolve();
  assertEquals(await cache.get("b", () => Promise.resolve(2)), 2);
  const recovered = cache.get("a", () =>
    new Promise<number>((resolve) => {
      resolveNew = resolve;
    }));
  await Promise.resolve();

  rejectOld(new Error("old failure"));
  try {
    await old;
  } catch {
    // Expected: only the superseded request fails.
  }
  resolveNew(3);
  assertEquals(await recovered, 3);
  assertEquals(await cache.get("a", () => Promise.resolve(4)), 3);
});
