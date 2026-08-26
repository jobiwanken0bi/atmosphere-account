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
  assertStringIncludes(
    source,
    'form.querySelector(".signin-form-preview-wrap")',
  );
  assertStringIncludes(source, "previewWrap.append(preview)");
  assertEquals(source.includes("field.append(preview)"), false);
  assertStringIncludes(source, "if (!isPlainLinkActivation(event)) return");
  assertStringIncludes(source, "event.preventDefault()");
  assertStringIncludes(source, 'event.key === "Escape" && !preview.hidden');
  assertEquals(source.match(/event\.stopPropagation\(\)/g)?.length, 2);
  assertStringIncludes(
    source,
    "if (initialSavedAccount instanceof HTMLElement)",
  );
  assertStringIncludes(source, "initialSavedAccount.focus()");
  assertStringIncludes(
    source,
    'form.addEventListener("submit", (event) => {',
  );
  assertStringIncludes(
    source,
    'const target = new URL("/oauth/login", current.origin)',
  );
  assertStringIncludes(source, "target.searchParams.append(name, value)");
  assertStringIncludes(
    source,
    'target.origin !== current.origin || target.pathname !== "/oauth/login"',
  );
  assertStringIncludes(source, "globalThis.location.assign(destination)");
  assertStringIncludes(source, "renderAuthorizationLink(form, destination)");
  assertStringIncludes(source, 'fallback.target = "_top"');
  assertEquals(source.includes('renderFormError(form, "")'), false);
  assertEquals(source.includes('"x-atmosphere-login"'), false);
  assertEquals(source.includes("fetch(form.action"), false);
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
