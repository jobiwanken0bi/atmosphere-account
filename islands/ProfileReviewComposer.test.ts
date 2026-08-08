import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cancelReviewReauthorization,
  parseOwnedReviewDraft,
  reviewDraftKey,
  reviewMutationAuthorization,
  reviewMutationFailureMessage,
  shouldResumeReviewComposer,
} from "./ProfileReviewComposer.tsx";
import {
  createAppReviewRkey,
  isAppReviewRkey,
} from "../lib/app-review-write.ts";

Deno.test("review mutations never surface technical server details", () => {
  assertEquals(
    reviewMutationFailureMessage(
      "Couldn’t save the review. Please try again.",
      "invalid_record: repo write rejected by com.example.internal",
    ),
    "Couldn’t save the review. Please try again.",
  );
});

Deno.test("review drafts are account-bound", () => {
  assertEquals(
    reviewDraftKey("grain", "did:plc:alice"),
    "atmosphere:review-draft:did%3Aplc%3Aalice:grain",
  );
  const value = JSON.stringify({
    ownerDid: "did:plc:alice",
    rating: 4,
    body: "Alice's private draft",
  });
  assertEquals(parseOwnedReviewDraft(value, "did:plc:bob"), null);
  assertEquals(parseOwnedReviewDraft(value, "did:plc:alice"), {
    rating: 4,
    body: "Alice's private draft",
  });
  assertEquals(
    parseOwnedReviewDraft(
      JSON.stringify({ rating: 4, body: "legacy" }),
      "did:plc:alice",
    ),
    null,
  );
});

Deno.test("shared-app review drafts preserve their client TID across reauthorization", () => {
  const reviewRkey = createAppReviewRkey(1_800_000_000_000);
  const restored = parseOwnedReviewDraft(
    JSON.stringify({
      ownerDid: "did:plc:alice",
      rating: 4,
      body: "Still the same write attempt",
      reviewRkey,
    }),
    "did:plc:alice",
  );

  assertEquals(restored, {
    rating: 4,
    body: "Still the same write attempt",
    reviewRkey,
  });
  assertEquals(isAppReviewRkey(restored?.reviewRkey), true);
  assertEquals(
    parseOwnedReviewDraft(
      JSON.stringify({
        ownerDid: "did:plc:alice",
        rating: 4,
        body: "Bad key",
        reviewRkey: "listing-uuid",
      }),
      "did:plc:alice",
    ),
    null,
  );
});

Deno.test("closing inline review reauthorization clears its saved draft", () => {
  const removed: string[] = [];
  cancelReviewReauthorization("atmosphere:review-draft:grain", {
    removeItem(key) {
      removed.push(key);
    },
  });
  assertEquals(removed, ["atmosphere:review-draft:grain"]);
});

Deno.test("review drafts restore only on an explicit post-authorization return", () => {
  assertEquals(
    shouldResumeReviewComposer("/apps/grain?review=compose", true, false),
    true,
  );
  assertEquals(shouldResumeReviewComposer("/apps/grain", true, false), false);
  assertEquals(
    shouldResumeReviewComposer("/apps/grain?review=compose", false, false),
    false,
  );
  assertEquals(
    shouldResumeReviewComposer("/apps/grain?review=compose", true, true),
    false,
  );
});

Deno.test("existing-review session recovery requests manage access", () => {
  assertEquals(reviewMutationAuthorization("review", true), {
    action: "review_manage",
    capabilities: ["review_manage"],
  });
  assertEquals(reviewMutationAuthorization("legacy_review", true), {
    action: "legacy_review_manage",
    capabilities: ["legacy_review_manage"],
  });
  assertEquals(reviewMutationAuthorization("review", false), {
    action: "review",
    capabilities: ["review"],
  });
});
