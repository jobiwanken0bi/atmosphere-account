import { assertEquals } from "jsr:@std/assert@1";
import {
  hostDetailResponseForTest,
  normalizePublicHostParamForTest,
} from "./[host].ts";
import { EdgeStaleCache } from "../../../../lib/edge-cache.ts";
import {
  listSeededAccountHostFallback,
} from "../../../../lib/account-hosts.ts";
import type { PublicHostDetail } from "../../../../lib/appview-client.ts";

Deno.test("host detail accepts only bounded DNS host identifiers", () => {
  assertEquals(normalizePublicHostParamForTest("BSKY.NETWORK"), "bsky.network");
  assertEquals(normalizePublicHostParamForTest("bad%ZZhost"), null);
  assertEquals(normalizePublicHostParamForTest("localhost"), null);
  assertEquals(normalizePublicHostParamForTest("../../admin"), null);
  assertEquals(normalizePublicHostParamForTest("x".repeat(300) + ".com"), null);
});

Deno.test("host detail serves last good stale response when refresh fails", async () => {
  let now = 1_000;
  const cache = new EdgeStaleCache<PublicHostDetail>({
    freshMs: 100,
    staleMs: 1_000,
    now: () => now,
  });
  const host = listSeededAccountHostFallback()[0];
  if (!host) throw new Error("expected a seeded host fixture");
  const good = { host, claim: null };

  const initial = await hostDetailResponseForTest(
    host.host,
    cache,
    () => Promise.resolve(good),
  );
  assertEquals(initial.status, 200);

  now += 200;
  const stale = await hostDetailResponseForTest(
    host.host,
    cache,
    () => Promise.reject(new Error("database unavailable")),
  );
  assertEquals(stale.status, 200);
  assertEquals((await stale.json()).host.host, host.host);
  assertEquals(stale.headers.get("cache-control")?.includes("public"), true);
});

Deno.test("cold host detail failures return non-cacheable 503", async () => {
  const cache = new EdgeStaleCache<PublicHostDetail>({
    freshMs: 100,
    staleMs: 1_000,
  });
  const response = await hostDetailResponseForTest(
    "example.com",
    cache,
    () => Promise.reject(new Error("database unavailable")),
  );

  assertEquals(response.status, 503);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals((await response.json()).error, "host_detail_unavailable");
});
