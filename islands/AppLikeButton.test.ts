import {
  appLikeCountLabel,
  appLikeEndpoint,
  appLikeReauthHref,
} from "./AppLikeButton.tsx";
import {
  favoriteRequestMethod,
  favoriteResumeIntent,
  favoriteResumeReturnPath,
  favoriteTargetLiked,
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
    appLikeReauthHref("alice.example", "/apps/grain?from=featured"),
    "/oauth/login?next=%2Fapps%2Fgrain%3Ffrom%3Dfeatured&action=favorite&capability=favorite&handle=alice.example",
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

Deno.test("app like count stays plain text inside the like control", async () => {
  const css = await Deno.readTextFile(
    new URL("../static/styles.css", import.meta.url),
  );
  const countRule = css.match(/\.app-like-count\s*\{([^}]+)\}/)?.[1] ?? "";
  const darkCountRule = css.match(
    /\.dark-phase \.app-like-count\s*\{([^}]+)\}/,
  )?.[1] ?? "";

  for (const rule of [countRule, darkCountRule]) {
    assertEquals(/\bbackground(?:-color)?\s*:/.test(rule), false);
  }
  for (const property of ["border-radius", "min-width", "padding"]) {
    assertEquals(countRule.includes(`${property}:`), false);
  }
  assertEquals(countRule.includes("color:"), true);
  assertEquals(darkCountRule.includes("color:"), true);
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
