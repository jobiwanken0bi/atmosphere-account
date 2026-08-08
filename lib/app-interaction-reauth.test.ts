import {
  accountReviewDeleteResumeLocation,
  accountReviewDeleteReturnPath,
  appFavoriteReauthorizationUrl,
  appReviewReauthorizationUrl,
  reviewResponseReturnPath,
} from "./app-interaction-reauth.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function params(path: string): URLSearchParams {
  return new URL(path, "https://atmosphere.invalid").searchParams;
}

Deno.test("favorite reauthorization keeps the slug in next and uses the app name in copy", () => {
  const query = params(
    appFavoriteReauthorizationUrl("grain-reader", "Grain Reader", "save"),
  );
  assertEquals(query.get("next"), "/apps/grain-reader?favorite=save");
  assertEquals(query.get("name"), "Grain Reader");
  assertEquals(query.get("action"), "favorite");
});

Deno.test("review reauthorization keeps the slug in next and uses the app name in copy", () => {
  const query = params(
    appReviewReauthorizationUrl(
      "grain-reader",
      "Grain Reader",
      "review_manage",
    ),
  );
  assertEquals(query.get("next"), "/apps/grain-reader?review=compose");
  assertEquals(query.get("name"), "Grain Reader");
  assertEquals(query.get("action"), "review_manage");
});

Deno.test("account review deletion returns with a one-shot confirmation intent", () => {
  assertEquals(
    accountReviewDeleteReturnPath(42),
    "/account/reviews?delete_review=42",
  );
  const resumed = accountReviewDeleteResumeLocation(
    "https://atmosphere.invalid/account/reviews?delete_review=42#reviews",
    42,
  );
  assertEquals(resumed.shouldConfirm, true);
  assertEquals(resumed.cleanLocation, "/account/reviews#reviews");
  assertEquals(
    accountReviewDeleteResumeLocation(
      "/account/reviews?delete_review=42&delete_review=7",
      42,
    ).shouldConfirm,
    false,
  );
});

Deno.test("review-response authorization returns to the originating editor", () => {
  assertEquals(
    reviewResponseReturnPath(
      "/apps/grain?reviews=newest#reviews",
      42,
    ),
    "/apps/grain?reviews=newest&review_response=42#reviews",
  );
});
