import {
  appReviewApiUrl,
  reviewSortPageUrl,
  showAppReviewHeaderSummary,
} from "./AppReviewList.tsx";

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

Deno.test("an empty shared review list owns the single empty-state message", () => {
  assertEquals(showAppReviewHeaderSummary(0, null, true), false);
  assertEquals(showAppReviewHeaderSummary(3, 4.7, true), true);
  assertEquals(showAppReviewHeaderSummary(0, null, false), true);
});
