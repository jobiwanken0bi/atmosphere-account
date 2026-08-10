import { assertEquals } from "jsr:@std/assert@1";
import { devPickerAccountForIdentifier } from "./dev-picker-demo.ts";
import { devPickerHostClaimGrantAllowedForTest } from "./dev-picker-oauth.ts";

Deno.test("dev picker identifiers accept the seeded handle and DID", () => {
  assertEquals(
    devPickerAccountForIdentifier("@LOCAL-PICKER.TEST")?.did,
    "did:plc:aalocalpicker",
  );
  assertEquals(
    devPickerAccountForIdentifier("did:plc:aalocalpicker")?.handle,
    "local-picker.test",
  );
  assertEquals(devPickerAccountForIdentifier("not-a-fixture.test"), null);
});

Deno.test("synthetic host authorization stays inside the explicit local lab", () => {
  const allowed = {
    isDev: true,
    enabled: "1",
    backend: "turso",
    databaseUrl: "file:./local.db",
    action: "host_claim" as const,
  };
  assertEquals(devPickerHostClaimGrantAllowedForTest(allowed), true);
  assertEquals(
    devPickerHostClaimGrantAllowedForTest({ ...allowed, isDev: false }),
    false,
  );
  assertEquals(
    devPickerHostClaimGrantAllowedForTest({ ...allowed, enabled: "0" }),
    false,
  );
  assertEquals(
    devPickerHostClaimGrantAllowedForTest({
      ...allowed,
      databaseUrl: "libsql://production.example",
    }),
    false,
  );
  assertEquals(
    devPickerHostClaimGrantAllowedForTest({
      ...allowed,
      action: "review",
    }),
    false,
  );
});
