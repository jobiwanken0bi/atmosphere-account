import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  OAUTH_CANCELLATION_PARAM,
  oauthAuthorizationExitHref,
  oauthCancellationLocation,
} from "./oauth-cancellation.ts";

Deno.test("authorization exit consumes favorite replay without losing context", () => {
  const exit = oauthAuthorizationExitHref(
    "/apps/grain?from=featured&favorite=save&review=compose&report=abc&delete_review=42#likes",
    "favorite",
  );
  const url = new URL(exit, "https://atmosphereaccount.com");
  assertEquals(url.pathname, "/apps/grain");
  assertEquals(url.searchParams.get("from"), "featured");
  assertEquals(url.searchParams.has("favorite"), false);
  assertEquals(url.searchParams.has("review"), false);
  assertEquals(url.searchParams.has("report"), false);
  assertEquals(url.searchParams.has("delete_review"), false);
  assertEquals(url.searchParams.getAll(OAUTH_CANCELLATION_PARAM), [
    "favorite",
    "review-draft",
  ]);
  assertEquals(url.hash, "#likes");

  const favoriteConsumed = oauthCancellationLocation(url.href, "favorite");
  assertEquals(favoriteConsumed.wasCancelled, true);
  assertEquals(
    new URL(favoriteConsumed.cleanLocation, url.origin).searchParams.getAll(
      OAUTH_CANCELLATION_PARAM,
    ),
    ["review-draft"],
  );
  assertEquals(
    oauthCancellationLocation(favoriteConsumed.cleanLocation, "review-draft"),
    {
      wasCancelled: true,
      cleanLocation: "/apps/grain?from=featured#likes",
    },
  );
});

Deno.test("authorization exit cancels app and host profile replay markers", () => {
  const exit = oauthAuthorizationExitHref(
    "/apps/manage?app=one&app-profile-resume=did%3Aplc%3Aalice&resume_host_profile=1#profile",
    "app",
  );
  const url = new URL(exit, "https://atmosphereaccount.com");
  assertEquals(url.searchParams.get("app"), "one");
  assertEquals(url.searchParams.has("app-profile-resume"), false);
  assertEquals(url.searchParams.has("resume_host_profile"), false);
  assertEquals(url.searchParams.getAll(OAUTH_CANCELLATION_PARAM), [
    "app-profile",
    "host-profile",
  ]);

  const appConsumed = oauthCancellationLocation(url.href, "app-profile");
  assertEquals(appConsumed.wasCancelled, true);
  assertEquals(
    new URL(appConsumed.cleanLocation, url.origin).searchParams.getAll(
      OAUTH_CANCELLATION_PARAM,
    ),
    ["host-profile"],
  );
});

Deno.test("authorization exit cancels both profile update replay markers", () => {
  const exit = oauthAuthorizationExitHref(
    "/apps/manage?project=did%3Aplc%3Aapp&profile-update-resume=did%3Aplc%3Aapp&profile-update-delete-resume=did%3Aplc%3Aapp#updates",
    "app",
  );
  const url = new URL(exit, "https://atmosphereaccount.com");
  assertEquals(url.searchParams.get("project"), "did:plc:app");
  assertEquals(url.searchParams.has("profile-update-resume"), false);
  assertEquals(url.searchParams.has("profile-update-delete-resume"), false);
  assertEquals(url.searchParams.getAll(OAUTH_CANCELLATION_PARAM), [
    "profile-update",
    "profile-update-delete",
  ]);

  const saveConsumed = oauthCancellationLocation(url.href, "profile-update");
  assertEquals(saveConsumed.wasCancelled, true);
  assertEquals(
    new URL(saveConsumed.cleanLocation, url.origin).searchParams.getAll(
      OAUTH_CANCELLATION_PARAM,
    ),
    ["profile-update-delete"],
  );
  assertEquals(
    oauthCancellationLocation(
      saveConsumed.cleanLocation,
      "profile-update-delete",
    ),
    {
      wasCancelled: true,
      cleanLocation: "/apps/manage?project=did%3Aplc%3Aapp#updates",
    },
  );
});

Deno.test("authorization exit cancels a pending review response", () => {
  const exit = oauthAuthorizationExitHref(
    "/apps/grain?review_response=42#reviews",
    "review_response",
  );
  assertEquals(
    exit,
    "/apps/grain?oauth_cancelled=review-response%3A42#reviews",
  );
  assertEquals(oauthCancellationLocation(exit, "review-response", "42"), {
    wasCancelled: true,
    cleanLocation: "/apps/grain#reviews",
  });
});

Deno.test("review cancellation markers are isolated by review id", () => {
  const exit = oauthAuthorizationExitHref(
    "/apps/grain?review_response=42&report=84#reviews",
    "review_response",
  );
  assertEquals(
    oauthCancellationLocation(exit, "review-response", "84").wasCancelled,
    false,
  );
  const response = oauthCancellationLocation(exit, "review-response", "42");
  assertEquals(response.wasCancelled, true);
  assertEquals(
    oauthCancellationLocation(response.cleanLocation, "report-draft", "84"),
    { wasCancelled: true, cleanLocation: "/apps/grain#reviews" },
  );
});

Deno.test("canceling viewer authorization cannot replay the preference", () => {
  const exit = oauthAuthorizationExitHref(
    "/account?tab=profile&resume_viewer=1",
    "account",
  );
  assertEquals(exit, "/account?tab=profile&oauth_cancelled=microblog-viewer");
  assertEquals(oauthCancellationLocation(exit, "microblog-viewer"), {
    wasCancelled: true,
    cleanLocation: "/account?tab=profile",
  });
});
