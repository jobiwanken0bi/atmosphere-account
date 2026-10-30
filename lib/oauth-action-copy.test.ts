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
    assertEquals(copy.signInBody.includes("repository"), false, action);
    assertEquals(copy.signInBody.includes("AT Store"), false, action);
    assertEquals(copy.signInBody.includes("identity only"), false, action);
  }
});

Deno.test("ordinary actions name the task without permission jargon", () => {
  const review = authActionCopy("review", "Grain");
  assertEquals(review.title, "Login with Atmosphere");
  assertEquals(
    review.signInBody,
    "Choose the account that will publish your review of Grain.",
  );

  const like = authActionCopy("favorite", "Grain");
  assertEquals(like.title, "Login with Atmosphere");
  assertEquals(
    like.signInBody,
    "Choose the account you want to use to like Grain.",
  );
  assertStringIncludes(like.upgradeBody("alice.example"), "like Grain");

  const report = authActionCopy("report_review", "Grain");
  assertEquals(report.title, "Login with Atmosphere");
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
    authActionCopy("app", "Grain").signInBody,
    "app profile, listing, and images",
  );
  assertStringIncludes(
    authActionCopy("host_manage", "Example Host").signInBody,
    "host profile and images",
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
    host_claim: false,
    host_transfer: false,
    host_manage: false,
    app_host: false,
    developer: true,
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

Deno.test("host claim copy matches its actual account choice", () => {
  const hostClaim = authActionCopy("host_claim", "Example Host");
  assertEquals(
    hostClaim.signInBody,
    "Choose the account that will claim and manage Example Host, including its public profile and images.",
  );
  assertEquals(hostClaim.signInBody.includes("hosted there"), false);
});

Deno.test("host transfer copy keeps the current manager in control", () => {
  const transfer = authActionCopy("host_transfer", "Example Host");
  assertEquals(transfer.eyebrow, "Change managing account");
  assertEquals(transfer.title, "Login with Atmosphere");
  assertEquals(
    transfer.signInBody,
    "Choose the new managing account for Example Host. The current manager stays in control until DNS verification succeeds.",
  );
  assertEquals(
    transfer.upgradeBody("alice.example"),
    "Continue as @alice.example and approve host-management access for Example Host. The current manager stays in control until DNS verification succeeds.",
  );
});
