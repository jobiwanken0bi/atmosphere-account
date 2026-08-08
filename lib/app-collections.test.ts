import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APP_COLLECTIONS,
  completeAppCollectionSummaries,
} from "./app-collections.ts";

Deno.test("the full collection directory keeps complete three-card rows", () => {
  const summaries = completeAppCollectionSummaries([
    { tag: "social", count: 4 },
    { tag: "developer tools", count: 2 },
    { tag: "unknown", count: 99 },
  ]);

  assertEquals(summaries.length, APP_COLLECTIONS.length);
  assertEquals(summaries.length % 3, 0);
  assertEquals(summaries.find((item) => item.tag === "social")?.count, 4);
  assertEquals(summaries.find((item) => item.tag === "developer")?.count, 2);
  assertEquals(summaries.find((item) => item.tag === "video")?.count, 0);
});
