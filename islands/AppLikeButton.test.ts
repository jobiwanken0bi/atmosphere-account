import {
  appLikeCountLabel,
  appLikeEndpoint,
  appLikeReauthHref,
} from "./AppLikeButton.tsx";
import {
  favoriteRequestMethod,
  favoriteResumeIntent,
  favoriteResumeProofKey,
  favoriteResumeProofValue,
  favoriteResumeReturnPath,
  favoriteTargetLiked,
  isValidFavoriteResumeProof,
} from "../lib/favorite-resume.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("app like endpoint preserves identifiers as one path segment", () => {
  assertEquals(
    appLikeEndpoint("feed/reader"),
    "/api/apps/feed%2Freader/favorite",
  );
});

Deno.test("app like reauthorization returns to the current app", () => {
  assertEquals(
    appLikeReauthHref(
      "did:plc:alice",
      "/apps/grain?from=featured",
      "Grain",
    ),
    "/oauth/login?next=%2Fapps%2Fgrain%3Ffrom%3Dfeatured&action=favorite&name=Grain&capability=favorite&handle=did%3Aplc%3Aalice",
  );
});

Deno.test("app like count copy crosses the island boundary as strings", () => {
  const copy = {
    countOne: "{count} like",
    countMany: "{count} likes",
  };
  assertEquals(appLikeCountLabel(0, copy), "0 likes");
  assertEquals(appLikeCountLabel(1, copy), "1 like");
  assertEquals(appLikeCountLabel(2, copy), "2 likes");
});

Deno.test("favorite resume URLs preserve absolute save/remove intent", () => {
  assertEquals(
    favoriteResumeReturnPath("feed/reader", "save"),
    "/apps/feed%2Freader?favorite=save",
  );
  assertEquals(
    favoriteResumeReturnPath("feed/reader", "remove"),
    "/apps/feed%2Freader?favorite=remove",
  );
  assertEquals(favoriteResumeIntent("save"), "save");
  assertEquals(favoriteResumeIntent("remove"), "remove");
  assertEquals(favoriteResumeIntent("toggle"), null);
});

Deno.test("favorite resume mutations are absolute and idempotent", () => {
  assertEquals(favoriteRequestMethod(false, "save"), "POST");
  assertEquals(favoriteRequestMethod(true, "save"), null);
  assertEquals(favoriteTargetLiked(false, "save"), true);
  assertEquals(favoriteRequestMethod(true, "remove"), "DELETE");
  assertEquals(favoriteRequestMethod(false, "remove"), null);
  assertEquals(favoriteTargetLiked(true, "remove"), false);
  assertEquals(favoriteRequestMethod(false, "toggle"), "POST");
  assertEquals(favoriteRequestMethod(true, "toggle"), "DELETE");
});

Deno.test("favorite query markers require fresh same-tab account proof", () => {
  const now = 10_000;
  const anonymousChoice = favoriteResumeProofValue("save", null, now);
  assertEquals(
    isValidFavoriteResumeProof(anonymousChoice, "save", "did:plc:alice", now),
    true,
  );
  const alice = favoriteResumeProofValue("remove", "did:plc:alice", now);
  assertEquals(
    isValidFavoriteResumeProof(alice, "remove", "did:plc:alice", now),
    true,
  );
  assertEquals(
    isValidFavoriteResumeProof(alice, "remove", "did:plc:bob", now),
    false,
  );
  assertEquals(isValidFavoriteResumeProof(null, "save", null, now), false);
  assertEquals(
    isValidFavoriteResumeProof(
      favoriteResumeProofValue("save", null, now - 1_800_001),
      "save",
      "did:plc:alice",
      now,
    ),
    false,
  );
  assertEquals(
    favoriteResumeProofKey("feed/reader"),
    "atmosphere:favorite-resume:feed%2Freader",
  );
});
