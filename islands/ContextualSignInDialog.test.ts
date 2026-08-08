import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contextualDialogTitle } from "./ContextualSignInDialog.tsx";

Deno.test("contextual account dialogs distinguish sign-in from scope upgrades", () => {
  assertEquals(contextualDialogTitle(false), "Sign in with Atmosphere account");
  assertEquals(contextualDialogTitle(true), "Additional permission required");
});
