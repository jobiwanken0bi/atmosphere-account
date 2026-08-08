import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("app account chooser shares action copy and restores focus after Back", async () => {
  const source = await Deno.readTextFile(
    new URL("./UpgradeToProjectModal.tsx", import.meta.url),
  );

  assertStringIncludes(source, 'authActionCopy("app", "your app")');
  assertStringIncludes(source, "chooseAccountButtonRef.current?.focus()");
  assertEquals(
    source.includes("Use a saved account or enter the app account’s handle."),
    false,
  );
});
