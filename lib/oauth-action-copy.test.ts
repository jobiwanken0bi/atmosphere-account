import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { OAUTH_ACTIONS } from "./oauth-action.ts";
import {
  authActionCopy,
  oauthActionAllowsAccountCreation,
} from "./oauth-action-copy.ts";

Deno.test("every OAuth action has concise shared chooser copy", () => {
  for (const action of OAUTH_ACTIONS) {
    const copy = authActionCopy(action, "Example");
    assertEquals(copy.eyebrow.length > 0, true, action);
    assertEquals(copy.title.length > 0, true, action);
    assertEquals(copy.signInBody.length > 0, true, action);
    assertEquals(copy.upgradeBody("alice.example").length > 0, true, action);
    assertEquals(
      copy.signInBody.includes("repository"),
      action === "developer",
      action,
    );
    assertEquals(copy.signInBody.includes("AT Store"), false, action);
    assertEquals(copy.signInBody.includes("identity only"), false, action);
  }
});

Deno.test("ordinary actions name the task without permission jargon", () => {
  const review = authActionCopy("review", "Grain");
  assertEquals(review.title, "Login to write a review of Grain");
  assertEquals(
    review.signInBody,
    "Login to write a review of Grain",
  );
  assertEquals(
    authActionCopy("legacy_review", "Grain").signInBody,
    "Login to write a review of Grain",
  );

  const like = authActionCopy("favorite", "Grain");
  assertEquals(like.title, "Login to like Grain");
  assertEquals(like.signInBody, "Choose the account you want to use.");
  assertStringIncludes(like.upgradeBody("alice.example"), "like Grain");

  const report = authActionCopy("report_review", "Grain");
  assertEquals(report.title, "Login to report this review");
  assertStringIncludes(report.signInBody, "review of Grain");

  const relationship = authActionCopy(
    "relationship_confirm",
    "Grain and Example Host",
  );
  assertStringIncludes(relationship.title, "Grain and Example Host");
  assertStringIncludes(
    relationship.upgradeBody("alice.example"),
    "Grain and Example Host",
  );
});

Deno.test("app and host management state what access is approved", () => {
  assertStringIncludes(
    authActionCopy("app_updates", "Grain").signInBody,
    "publish, edit, and remove its What’s New posts",
  );
  assertStringIncludes(
    authActionCopy("app", "Grain").signInBody,
    "manage its app records and images",
  );
  assertStringIncludes(
    authActionCopy("host_manage", "Example Host").signInBody,
    "manage its public host profile and images",
  );
});

Deno.test("account creation policy explicitly covers every OAuth action", () => {
  const expected = {
    account: true,
    review: true,
    review_manage: false,
    legacy_review: true,
    legacy_review_manage: false,
    review_response: false,
    report_review: true,
    favorite: true,
    app: true,
    app_updates: false,
    host_claim: true,
    host_manage: false,
    host_transfer: true,
    app_host: false,
    developer: false,
    relationship_confirm: false,
    admin: false,
  } as const satisfies Record<typeof OAUTH_ACTIONS[number], boolean>;

  for (const action of OAUTH_ACTIONS) {
    assertEquals(
      oauthActionAllowsAccountCreation(action),
      expected[action],
      action,
    );
  }
});

Deno.test("host claim and transfer copy match their actual account choice", () => {
  const hostClaim = authActionCopy("host_claim", "Example Host");
  assertEquals(
    hostClaim.signInBody,
    "Choose the account that will claim and manage Example Host, including its public profile and images. Granting this access does not claim the host; ownership is verified separately after login.",
  );
  assertEquals(hostClaim.signInBody.includes("hosted there"), false);

  const transfer = authActionCopy("host_transfer", "Example Host");
  assertEquals(transfer.title, "Choose the new managing account");
  assertStringIncludes(transfer.signInBody, "current manager");
  assertStringIncludes(transfer.upgradeBody("alice.example"), "DNS");
});
