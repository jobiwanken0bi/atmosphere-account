import {
  appLikeCountLabel,
  appLikeEndpoint,
  appLikeReauthHref,
} from "./AppLikeButton.tsx";

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
    appLikeReauthHref("alice.example", "/apps/grain?from=featured"),
    "/oauth/login?handle=alice.example&next=%2Fapps%2Fgrain%3Ffrom%3Dfeatured",
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
