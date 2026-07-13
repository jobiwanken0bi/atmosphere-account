import { appReviewApiUrl, reviewSortPageUrl } from "./AppReviewList.tsx";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("review sorting uses the JSON endpoint without navigating the page", () => {
  assertEquals(
    appReviewApiUrl("feed/reader", "highest"),
    "/api/apps/feed%2Freader/reviews?sort=highest",
  );
});

Deno.test("review sorting preserves unrelated page state in history", () => {
  assertEquals(
    reviewSortPageUrl(
      "https://atmosphereaccount.com/apps/grain?from=featured#reviews",
      "lowest",
    ),
    "/apps/grain?from=featured&reviews=lowest#reviews",
  );
  assertEquals(
    reviewSortPageUrl(
      "https://atmosphereaccount.com/apps/grain?from=featured&reviews=lowest#reviews",
      "newest",
    ),
    "/apps/grain?from=featured#reviews",
  );
});
