import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  armReviewResponseResume,
  clearReviewResponseDraft,
  confirmReviewResponseDelete,
  parseOwnedReviewResponseDraft,
  reviewResponseDraftKey,
  reviewResponseReauthorization,
  reviewResponseResumeProofKey,
} from "./ReviewResponseComposer.tsx";
import { reviewResponseResumeLocation } from "../lib/app-interaction-reauth.ts";
import { isValidOauthResumeProof } from "../lib/oauth-resume-proof.ts";

Deno.test("canceling developer response deletion stops before mutation", () => {
  const seen: string[] = [];
  assertEquals(
    confirmReviewResponseDelete(
      "Delete this developer response? This can’t be undone.",
      (message) => {
        seen.push(message);
        return false;
      },
    ),
    false,
  );
  assertEquals(seen, [
    "Delete this developer response? This can’t be undone.",
  ]);
});

Deno.test("review response recovery is contextual and DID-bound", () => {
  const authorization = reviewResponseReauthorization(
    401,
    { error: "not_authenticated" },
    "/apps/grain#reviews",
    42,
    "Grain",
  );
  assertEquals(authorization?.action, "review_response");
  assertEquals(authorization?.capabilities, ["identity"]);
  assertEquals(
    authorization?.returnTo,
    "/apps/grain?review_response=42#reviews",
  );
  assertEquals(
    reviewResponseReauthorization(
      500,
      { error: "database_unavailable" },
      "/apps/grain#reviews",
      42,
      "Grain",
    ),
    null,
  );
});

Deno.test("canceling response authorization clears only its account-bound draft", () => {
  const values = new Map<string, string>([
    [reviewResponseDraftKey(1, "did:plc:alice"), "one"],
    [reviewResponseResumeProofKey(1, "did:plc:alice"), "proof"],
    [reviewResponseDraftKey(2, "did:plc:alice"), "two"],
    [reviewResponseDraftKey(1, "did:plc:bob"), "bob"],
    ["atmosphere:review-response-draft:1", "legacy"],
    ["unrelated", "keep"],
  ]);
  clearReviewResponseDraft(1, "did:plc:alice", {
    removeItem(key) {
      values.delete(key);
    },
  });
  assertEquals([...values.entries()], [
    [reviewResponseDraftKey(2, "did:plc:alice"), "two"],
    [reviewResponseDraftKey(1, "did:plc:bob"), "bob"],
    ["unrelated", "keep"],
  ]);
});

Deno.test("review response drafts cannot cross accounts", () => {
  const value = JSON.stringify({
    ownerDid: "did:plc:alice",
    body: "Private owner response",
  });
  assertEquals(
    parseOwnedReviewResponseDraft(value, "did:plc:alice"),
    "Private owner response",
  );
  assertEquals(parseOwnedReviewResponseDraft(value, "did:plc:bob"), null);
  assertEquals(
    parseOwnedReviewResponseDraft("legacy plaintext", "did:plc:alice"),
    null,
  );
});

Deno.test("developer response resume is armed for one account and review", () => {
  const values = new Map<string, string>();
  const ownerDid = "did:plc:alice";
  const draftKey = reviewResponseDraftKey(42, ownerDid);
  const proofKey = reviewResponseResumeProofKey(42, ownerDid);
  assertEquals(
    armReviewResponseResume(proofKey, ownerDid, draftKey, {
      setItem(key, value) {
        values.set(key, value);
      },
    }),
    true,
  );
  const proof = values.get(proofKey) ?? null;
  assertEquals(isValidOauthResumeProof(proof, ownerDid, draftKey), true);
  assertEquals(
    isValidOauthResumeProof(
      proof,
      ownerDid,
      reviewResponseDraftKey(43, ownerDid),
    ),
    false,
  );
  assertEquals(
    isValidOauthResumeProof(proof, "did:plc:bob", draftKey),
    false,
  );
});

Deno.test("developer response return marker is exact and one-shot", () => {
  const valid = reviewResponseResumeLocation(
    "https://example.test/apps/grain?review_response=42#reviews",
    42,
  );
  assertEquals(valid, {
    hadMarker: true,
    shouldResume: true,
    cleanLocation: "/apps/grain#reviews",
  });

  const duplicated = reviewResponseResumeLocation(
    "https://example.test/apps/grain?review_response=42&review_response=42",
    42,
  );
  assertEquals(duplicated, {
    hadMarker: true,
    shouldResume: false,
    cleanLocation: "/apps/grain",
  });

  const unrelated = reviewResponseResumeLocation(
    "https://example.test/apps/grain?review_response=42#reviews",
    41,
  );
  assertEquals(unrelated, {
    hadMarker: false,
    shouldResume: false,
    cleanLocation: "/apps/grain?review_response=42#reviews",
  });
});
