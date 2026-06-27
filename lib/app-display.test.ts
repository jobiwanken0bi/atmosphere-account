import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AppListing } from "./app-directory.ts";
import { appDisplayTaxonomy, appPrimaryCollection } from "./app-display.ts";

Deno.test("appDisplayTaxonomy treats ATStore category slugs as collections first", () => {
  const app = {
    categorySlugs: ["apps/bluesky/client"],
    tags: ["client", "social", "web"],
  } as unknown as AppListing;

  assertEquals(appPrimaryCollection(app), "Client");
  assertEquals(appDisplayTaxonomy(app), {
    collections: ["Client"],
    tags: ["social", "web"],
  });
});

Deno.test("appDisplayTaxonomy skips top-level app ecosystem roots", () => {
  const app = {
    categorySlugs: ["apps/atstore"],
    tags: ["developer tool", "utility"],
  } as unknown as AppListing;

  assertEquals(appDisplayTaxonomy(app), {
    collections: ["Developer", "Utility"],
    tags: [],
  });
});

Deno.test("appDisplayTaxonomy falls back to tag-derived collections", () => {
  const app = {
    categorySlugs: [],
    tags: ["developer tools", "library", "developer tools"],
  } as unknown as AppListing;

  assertEquals(appDisplayTaxonomy(app), {
    collections: ["Developer"],
    tags: ["library"],
  });
});
