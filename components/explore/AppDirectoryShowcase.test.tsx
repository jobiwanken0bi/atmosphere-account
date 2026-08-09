import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { AppDirectoryAvailability } from "./AppDirectoryShowcase.tsx";

Deno.test("app directory explains when cards are unavailable", () => {
  const html = renderToString(h(AppDirectoryAvailability, {
    hasCards: false,
  }));

  assertStringIncludes(html, "Apps aren’t available right now.");
  assertStringIncludes(html, "Try again in a moment.");
});

Deno.test("app directory omits the unavailable state when cards exist", () => {
  const html = renderToString(h(AppDirectoryAvailability, {
    hasCards: true,
  }));

  assertEquals(html, "");
});
