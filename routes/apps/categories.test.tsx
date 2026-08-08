import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import { AppCategoriesDirectory } from "./categories.tsx";

Deno.test("collection outages do not masquerade as zero-app collections", () => {
  const unavailable = renderToString(
    <AppCategoriesDirectory tags={[]} unavailable />,
  );

  assertStringIncludes(
    unavailable,
    "Collections aren’t available right now.",
  );
  assertEquals(unavailable.includes("0 apps"), false);
  assertEquals(unavailable.includes("app-category-grid"), false);
});

Deno.test("available collections render their real counts", () => {
  const available = renderToString(
    <AppCategoriesDirectory
      tags={[{ tag: "social", count: 4 }]}
      unavailable={false}
    />,
  );

  assertStringIncludes(available, "app-category-grid");
  assertStringIncludes(available, "Social");
  assertStringIncludes(available, "4 apps");
});
