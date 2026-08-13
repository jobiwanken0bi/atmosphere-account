import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  hostDirectoryCacheKey,
  hostDirectoryResponseForTest,
  hostDirectorySuccessHeadersForTest,
  validHostDirectorySearchForTest,
} from "./hosts.ts";
import { EdgeStaleCache } from "../../../lib/edge-cache.ts";
import {
  type AccountHostDirectoryResult,
  listSeededAccountHostFallback,
} from "../../../lib/account-hosts.ts";

function directoryResult(total = 1): AccountHostDirectoryResult {
  const host = listSeededAccountHostFallback()[0];
  if (!host) throw new Error("expected a seeded host fixture");
  return {
    hosts: [host],
    total,
    page: 1,
    pageSize: 24,
    sort: "accounts",
  };
}

Deno.test("successful public host directories allow bounded shared caching", () => {
  const cacheControl = hostDirectorySuccessHeadersForTest().get(
    "cache-control",
  );
  assertEquals(cacheControl?.includes("public"), true);
  assertEquals(cacheControl?.includes("s-maxage=30"), true);
  assertEquals(cacheControl?.includes("stale-while-revalidate=120"), true);
  assertEquals(cacheControl?.includes("no-store"), false);
});

Deno.test("host directory serves last good stale response when refresh fails", async () => {
  let now = 1_000;
  const cache = new EdgeStaleCache<AccountHostDirectoryResult>({
    freshMs: 100,
    staleMs: 1_000,
    now: () => now,
  });
  const input = { query: "" };

  const initial = await hostDirectoryResponseForTest(
    input,
    cache,
    () => Promise.resolve(directoryResult(7)),
  );
  assertEquals(initial.status, 200);

  now += 200;
  const stale = await hostDirectoryResponseForTest(
    input,
    cache,
    () => Promise.reject(new Error("database unavailable")),
  );
  assertEquals(stale.status, 200);
  const staleBody = await stale.json();
  assertEquals(staleBody.total, 7);
  assertEquals(staleBody.hosts.length, 1);
  assertEquals(stale.headers.get("cache-control")?.includes("public"), true);
});

Deno.test("cold host directory failures return non-cacheable 503", async () => {
  const cache = new EdgeStaleCache<AccountHostDirectoryResult>({
    freshMs: 100,
    staleMs: 1_000,
  });
  const response = await hostDirectoryResponseForTest(
    {},
    cache,
    () => Promise.reject(new Error("database unavailable")),
  );

  assertEquals(response.status, 503);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals((await response.json()).error, "host_directory_unavailable");
});

Deno.test("host directory cache key normalizes equivalent public filters", () => {
  assertEquals(
    hostDirectoryCacheKey({
      query: "  Bluesky  ",
      signupStatuses: ["open", "invite_required", "open"],
      page: 2,
      pageSize: 24,
      includeLinkedApps: true,
    }),
    hostDirectoryCacheKey({
      query: "bluesky",
      signupStatuses: ["invite_required", "open"],
      page: 2,
      pageSize: 24,
      includeLinkedApps: true,
    }),
  );
});

Deno.test("host directory rejects cache-fragmenting and oversized filters", () => {
  const repeated = new URLSearchParams();
  repeated.append("q", "one");
  repeated.append("q", "two");
  assertEquals(validHostDirectorySearchForTest(repeated), false);
  assertEquals(
    validHostDirectorySearchForTest(
      new URLSearchParams({ q: "x".repeat(129) }),
    ),
    false,
  );
  assertEquals(
    validHostDirectorySearchForTest(new URLSearchParams({ page: "Infinity" })),
    false,
  );
  assertEquals(
    validHostDirectorySearchForTest(
      new URLSearchParams({ q: "bluesky", page: "2", pageSize: "24" }),
    ),
    true,
  );
});

Deno.test("host directory cache key keeps result-changing filters separate", () => {
  const base = hostDirectoryCacheKey({
    query: "bluesky",
    page: 1,
    pageSize: 24,
  });
  const variants = [
    hostDirectoryCacheKey({ query: "other", page: 1, pageSize: 24 }),
    hostDirectoryCacheKey({ query: "bluesky", page: 2, pageSize: 24 }),
    hostDirectoryCacheKey({ query: "bluesky", page: 1, pageSize: 48 }),
    hostDirectoryCacheKey({
      query: "bluesky",
      page: 1,
      pageSize: 24,
      includeLinkedApps: true,
    }),
    hostDirectoryCacheKey({
      query: "bluesky",
      page: 1,
      pageSize: 24,
      trustedOnly: true,
    }),
  ];
  for (const variant of variants) assertNotEquals(variant, base);
});
