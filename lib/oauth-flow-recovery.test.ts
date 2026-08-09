import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { oauthRecoveryModeForPrompt } from "./oauth.ts";

Deno.test("only denied account creation returns to create mode", () => {
  assertEquals(oauthRecoveryModeForPrompt("create"), "create");
  assertEquals(oauthRecoveryModeForPrompt("login"), undefined);
  assertEquals(oauthRecoveryModeForPrompt(undefined), undefined);
});
