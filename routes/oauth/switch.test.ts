import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSwitchReauthLocation, readSwitchInputForTest } from "./switch.ts";

Deno.test("saved-account switch fallback starts OAuth for the target handle", () => {
  assertEquals(
    buildSwitchReauthLocation("atmosphereaccount.com", "/account"),
    "/oauth/login?handle=atmosphereaccount.com&next=%2Faccount",
  );
  assertEquals(
    buildSwitchReauthLocation("sprk.so", null),
    "/oauth/login?handle=sprk.so",
  );
});

Deno.test("saved-account switch accepts a bodyless POST query handoff", async () => {
  const request = new Request(
    "https://atmosphereaccount.com/oauth/switch?did=did%3Aplc%3Atest&next=%2Faccount",
    { method: "POST" },
  );
  assertEquals(await readSwitchInputForTest(request), {
    did: "did:plc:test",
    next: "/account",
  });
});
