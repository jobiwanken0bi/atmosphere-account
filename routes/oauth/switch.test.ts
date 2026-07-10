import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSwitchReauthLocation } from "./switch.ts";

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
