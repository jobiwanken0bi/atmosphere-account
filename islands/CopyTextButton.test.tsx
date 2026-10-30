import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import CopyTextButton from "./CopyTextButton.tsx";

Deno.test("copy controls stay hidden until their clipboard behavior hydrates", () => {
  const html = renderToString(
    h(CopyTextButton, { text: "example", label: "Copy value" }),
  );

  assertStringIncludes(html, "hidden");
  assertStringIncludes(html, "Copy value");
});
