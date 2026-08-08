import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("sign-in enhancement keeps server errors out of the UI", async () => {
  const script = await Deno.readTextFile(
    new URL("./signin-preview.js", import.meta.url),
  );
  assertStringIncludes(
    script,
    "Couldn’t start sign-in. Check the handle and try again.",
  );
  assertEquals(script.includes("body.error"), false);
});

Deno.test("choosing a handle match moves focus out of the hidden listbox", async () => {
  const script = await Deno.readTextFile(
    new URL("./signin-preview.js", import.meta.url),
  );
  assertStringIncludes(
    script,
    'selectedBox?.querySelector(\n          ".signin-selected-clear",',
  );
  assertStringIncludes(script, "clearSelection.focus()");
  assertStringIncludes(script, "input.focus()");
});

Deno.test("combobox semantics are added only with the interactive list", async () => {
  const script = await Deno.readTextFile(
    new URL("./signin-preview.js", import.meta.url),
  );
  assertStringIncludes(script, 'input.setAttribute("role", "combobox")');
  assertStringIncludes(
    script,
    'input.setAttribute("aria-autocomplete", "list")',
  );
  assertStringIncludes(
    script,
    'input.setAttribute("aria-controls", previewId)',
  );
});

Deno.test("enhanced mode links switch in place", async () => {
  const script = await Deno.readTextFile(
    new URL("./signin-preview.js", import.meta.url),
  );
  assertStringIncludes(script, 'tab.addEventListener("click", (event) => {');
  assertStringIncludes(script, "event.preventDefault()");
  assertStringIncludes(script, "setPageCopy(mode)");
  assertStringIncludes(script, "`data-signin-copy-${mode}`");
});

Deno.test("sign-in validates server destinations before browser navigation", async () => {
  const script = await Deno.readTextFile(
    new URL("./signin-preview.js", import.meta.url),
  );
  assertStringIncludes(script, "safeNavigationDestination(body.redirectUrl)");
  assertStringIncludes(script, "globalThis.location.assign(destination)");
  assertStringIncludes(script, "target.username || target.password");
  assertStringIncludes(script, 'target.protocol === "https:"');
  for (const suffix of [".test", ".invalid", ".example", ".onion"]) {
    assertStringIncludes(script, `host.endsWith("${suffix}")`);
  }
});
