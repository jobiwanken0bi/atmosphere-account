import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import ProfileReviewComposer, {
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

const reviewComposerProps = {
  targetId: "tangled",
  isOwner: false,
  loginHref: "/signin?action=review",
  returnTo: "/apps/tangled?review=compose",
  authCapabilities: ["review"] as const,
  authAction: "review" as const,
  authTargetName: "Tangled",
  ownReview: null,
  copy: {
    heading: "Write a review",
    modalBody: "Rate this app.",
    ownerNote: "You can’t review your own app.",
    ratingLabel: "Rating",
    bodyLabel: "Review",
    bodyPlaceholder: "What should people know?",
    charsRemainingSuffix: "characters remaining",
    submit: "Post review",
    update: "Update review",
    submitting: "Saving…",
    delete: "Delete review",
    cancel: "Cancel",
    saved: "Review saved.",
    deleted: "Review deleted.",
    error: "Couldn’t save the review.",
  },
};

Deno.test("signed-out and signed-in reviewers get the same write-review CTA", () => {
  const signedOut = renderToString(h(ProfileReviewComposer, {
    ...reviewComposerProps,
    signedIn: false,
  }));
  const signedIn = renderToString(h(ProfileReviewComposer, {
    ...reviewComposerProps,
    signedIn: true,
  }));

  assertStringIncludes(
    signedOut,
    '<a href="/signin?action=review"',
  );
  assertStringIncludes(
    signedIn,
    '<button type="button"',
  );
  for (const html of [signedOut, signedIn]) {
    assertStringIncludes(
      html,
      'class="explore-cta-primary profile-review-write-button"',
    );
    assertStringIncludes(html, 'class="profile-review-write-icon"');
    assertStringIncludes(html, "Write a review");
  }
  assertEquals(signedOut.includes("profile-review-action-hint"), false);
  assertEquals(signedOut.includes(">Login<"), false);
});

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
    capabilities: ["legacy_review"],
  });
  assertEquals(reviewMutationAuthorization("review", false), {
    action: "review",
    capabilities: ["review"],
  });
});
