import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { devPickerAccountForDid } from "./dev-picker-demo.ts";

Deno.test("dev picker accounts can be recognized by DID", () => {
  assertEquals(
    devPickerAccountForDid("did:plc:aalocalpicker")?.handle,
    "local-picker.test",
  );
  assertEquals(devPickerAccountForDid("did:plc:not-a-fixture"), null);
});
