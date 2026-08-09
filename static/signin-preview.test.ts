import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("sign-in preview exposes keyboard selection and associated errors", async () => {
  const source = await Deno.readTextFile(
    new URL("./signin-preview.js", import.meta.url),
  );
  assertStringIncludes(source, 'button.addEventListener("click"');
  assertStringIncludes(source, 'event.key === "ArrowDown"');
  assertStringIncludes(source, 'event.key === "Home"');
  assertStringIncludes(source, 'error.setAttribute("role", "alert")');
  assertStringIncludes(source, 'input.setAttribute("aria-errormessage"');
  assertStringIncludes(source, "throw new Error(errorLabel)");
  assertEquals(source.includes("body.error"), false);
  assertEquals(source.includes("String(err)"), false);
});

Deno.test("sign-in preview no longer implements incomplete ARIA tabs", async () => {
  const source = await Deno.readTextFile(
    new URL("./signin-preview.js", import.meta.url),
  );
  assertEquals(source.includes("data-signin-tab"), false);
  assertEquals(source.includes("data-signin-panel"), false);
  assertEquals(source.includes("setMode("), false);
});

Deno.test("sign-in preview uses native buttons instead of an incomplete combobox pattern", async () => {
  const source = await Deno.readTextFile(
    new URL("./signin-preview.js", import.meta.url),
  );
  assertEquals(source.includes('setAttribute("role", "listbox")'), false);
  assertEquals(source.includes('setAttribute("role", "option")'), false);
  assertEquals(source.includes('setAttribute("aria-expanded"'), false);
});
