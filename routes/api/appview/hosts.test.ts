import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  hostDirectoryCacheKey,
  hostDirectorySuccessHeadersForTest,
  validHostDirectorySearchForTest,
} from "./hosts.ts";

Deno.test("successful public host directories allow bounded shared caching", () => {
  const cacheControl = hostDirectorySuccessHeadersForTest().get(
    "cache-control",
  );
  assertEquals(cacheControl?.includes("public"), true);
  assertEquals(cacheControl?.includes("s-maxage=30"), true);
  assertEquals(cacheControl?.includes("stale-while-revalidate=120"), true);
  assertEquals(cacheControl?.includes("no-store"), false);
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
