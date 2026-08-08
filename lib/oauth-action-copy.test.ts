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
  assertEquals(review.title, "Sign in to review Grain");
  assertEquals(
    review.signInBody,
    "Choose the account that will publish your review.",
  );

  const like = authActionCopy("favorite", "Grain");
  assertEquals(like.title, "Sign in to like Grain");
  assertEquals(like.signInBody, "Choose the account you want to use.");
  assertStringIncludes(like.upgradeBody("alice.example"), "like Grain");

  const report = authActionCopy("report_review", "Grain");
  assertEquals(report.title, "Sign in to report this review");
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
    "publish and manage its app profile and listing",
  );
  assertStringIncludes(
    authActionCopy("host_manage", "Example Host").signInBody,
    "publish and manage its host profile",
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
    host_manage: false,
    app_host: false,
    profile: true,
    developer: true,
    passkey_manage: false,
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

Deno.test("host claim and passkey copy match their actual account choice", () => {
  const hostClaim = authActionCopy("host_claim", "Example Host");
  assertEquals(
    hostClaim.signInBody,
    "Choose the account that should manage this account host.",
  );
  assertEquals(hostClaim.signInBody.includes("hosted there"), false);

  const passkey = authActionCopy("passkey_manage", "alice.example");
  assertEquals(passkey.title, "Verify your account");
  assertStringIncludes(passkey.signInBody, "alice.example");
  assertStringIncludes(passkey.upgradeBody("alice.example"), "passkeys");
});
