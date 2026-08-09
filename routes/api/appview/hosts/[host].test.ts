import { assertEquals } from "jsr:@std/assert@1";
import { normalizePublicHostParamForTest } from "./[host].ts";

Deno.test("host detail accepts only bounded DNS host identifiers", () => {
  assertEquals(normalizePublicHostParamForTest("BSKY.NETWORK"), "bsky.network");
  assertEquals(normalizePublicHostParamForTest("bad%ZZhost"), null);
  assertEquals(normalizePublicHostParamForTest("localhost"), null);
  assertEquals(normalizePublicHostParamForTest("../../admin"), null);
  assertEquals(normalizePublicHostParamForTest("x".repeat(300) + ".com"), null);
});
