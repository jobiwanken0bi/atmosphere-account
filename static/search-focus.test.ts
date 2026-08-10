import {
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("directory search focus follows the outer pill", async () => {
  const styles = await Deno.readTextFile(
    new URL("./styles.css", import.meta.url),
  );
  const outerFocusRule = styles.match(
    /\.explore-search-form:focus-within\s*\{([^}]+)\}/,
  )?.[1] ?? "";
  const inputFocusRule = styles.match(
    /\.explore-search-input:focus-visible\s*\{([^}]+)\}/,
  )?.[1] ?? "";

  assertStringIncludes(outerFocusRule, "outline: var(--focus-ring)");
  assertStringIncludes(
    outerFocusRule,
    "outline-offset: var(--focus-ring-offset)",
  );
  assertStringIncludes(inputFocusRule, "outline: none");
});
