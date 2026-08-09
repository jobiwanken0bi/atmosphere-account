import { assertEquals } from "jsr:@std/assert@1";
import { isPlainLinkActivation } from "./link-activation.ts";

Deno.test("plain and keyboard-style link clicks can open contextual UI", () => {
  assertEquals(
    isPlainLinkActivation({
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    }),
    true,
  );
});

Deno.test("modified link clicks retain native browser behavior", () => {
  for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
    const modifiers = {
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    };
    modifiers[key] = true;
    assertEquals(isPlainLinkActivation(modifiers), false, key);
  }
});
