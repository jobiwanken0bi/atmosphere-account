import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("app profile controls expose names, state, focus, and full NSIDs", async () => {
  const [source, styles] = await Promise.all([
    Deno.readTextFile(new URL("./CreateProfileForm.tsx", import.meta.url)),
    Deno.readTextFile(new URL("../static/styles.css", import.meta.url)),
  ]);

  for (
    const fragment of [
      "aria-pressed={subcategories.value.includes(s)}",
      "Show Bluesky on the public app profile",
      "Show ${svc.name} on the public app profile",
      "Custom link ${i + 1} label",
      "Custom link ${i + 1} URL",
    ]
  ) {
    assertStringIncludes(source, fragment);
  }
  for (
    const fragment of [
      ".profile-form-input:focus-visible {",
      ".atmosphere-row-toggle input:focus-visible + .atmosphere-toggle-track {",
      ".collection-role-toggle {",
      "width: 2.75rem;",
      ".collection-picker-identity code {",
      "overflow-wrap: anywhere;",
    ]
  ) {
    assertStringIncludes(styles, fragment);
  }
});
