import { assertEquals } from "jsr:@std/assert@1";
import { iconProxyCacheControl } from "./icon-proxy-cache.ts";

Deno.test("only currently authorized approved icons use shared caches", () => {
  assertEquals(
    iconProxyCacheControl("granted", "approved").startsWith("public,"),
    true,
  );
  for (
    const [access, status] of [
      ["denied", "approved"],
      ["requested", "approved"],
      ["granted", "pending"],
      ["granted", "denied"],
    ] as const
  ) {
    assertEquals(
      iconProxyCacheControl(access, status).startsWith("private,"),
      true,
    );
  }
});
