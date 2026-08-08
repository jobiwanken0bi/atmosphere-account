import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { OAUTH_ACTIONS } from "../lib/oauth-action.ts";
import {
  authActionCopy,
  authMediaContext,
  AuthorizationExitLink,
  permissionStatusCopy,
  PermissionUpgradeForm,
  readSignInAuthorizationRequest,
  shouldUseExistingAccount,
  signedInAuthHeading,
  SignInPageContent,
} from "./signin.tsx";

Deno.test("sign-in authorization context rejects ambiguity and typos", () => {
  assertEquals(
    readSignInAuthorizationRequest(
      new URL(
        "https://atmosphereaccount.com/signin?next=%2Faccount&action=account&capability=identity",
      ),
    ).action,
    "account",
  );
  for (
    const query of [
      "action=account&action=admin&capability=identity",
      "action=typo&capability=identity",
      "permission=typo&action=account&capability=identity",
      "intent=typo&action=account&capability=identity",
      "next=https%3A%2F%2Fevil.example&action=account&capability=identity",
      "action=account&capability=",
    ]
  ) {
    assertThrows(() =>
      readSignInAuthorizationRequest(
        new URL(`https://atmosphereaccount.com/signin?${query}`),
      )
    );
  }

  const pickerPath =
    "%2Flogin%2Fselect%3Fclient_id%3Dhttps%253A%252F%252Fapp.example%26return_uri%3Dhttps%253A%252F%252Fapp.example%252Fcallback%26state%3Dopaque";
  assertEquals(
    readSignInAuthorizationRequest(
      new URL(
        `https://atmosphereaccount.com/signin?next=${pickerPath}&continuation=login_selection&action=account&capability=identity`,
      ),
    ).continuation,
    "login_selection",
  );
  assertThrows(() =>
    readSignInAuthorizationRequest(
      new URL(
        "https://atmosphereaccount.com/signin?next=%2Faccount&continuation=login_selection&action=account&capability=identity",
      ),
    )
  );
  assertThrows(() =>
    readSignInAuthorizationRequest(
      new URL(
        `https://atmosphereaccount.com/signin?next=${pickerPath}&action=account&capability=identity`,
      ),
    )
  );
});

Deno.test("create mode retains the page, action, and requested permissions", () => {
  const request = readSignInAuthorizationRequest(
    new URL(
      "https://atmosphereaccount.com/signin?next=%2Fapps%2Ftangled%3Ffrom%3Dfeatured%26review%3Dcompose%23reviews&action=review&name=Tangled&capability=review&mode=create",
    ),
  );

  assertEquals(request.requestedMode, "create");
  assertEquals(
    request.next,
    "/apps/tangled?from=featured&review=compose#reviews",
  );
  assertEquals(request.action, "review");
  assertEquals(request.targetName, "Tangled");
  assertEquals(request.capabilities, ["review"]);
});

Deno.test("authorization recovery states expose a safe exit", () => {
  for (
    const permissionState of [
      "denied",
      "partial",
      "concurrent",
      "required",
      "failed",
    ]
  ) {
    const html = renderToString(h(AuthorizationExitLink, {
      permissionState,
      returnTo: "/apps/grain?tab=details#review",
      action: "review",
    }));
    assertStringIncludes(
      html,
      'href="/apps/grain?tab=details#review"',
    );
    assertStringIncludes(html, ">Not now</a>");
  }

  const unsafe = renderToString(h(AuthorizationExitLink, {
    permissionState: "denied",
    returnTo: "https://evil.example/leave",
    action: "account",
  }));
  assertStringIncludes(unsafe, 'href="/account"');

  assertEquals(
    renderToString(h(AuthorizationExitLink, {
      permissionState: null,
      returnTo: "/account",
      action: "account",
    })),
    "",
  );
});

Deno.test("authorization exit does not reopen or replay the canceled action", () => {
  const html = renderToString(h(AuthorizationExitLink, {
    permissionState: "denied",
    returnTo:
      "/apps/grain?from=featured&favorite=save&review=compose&report=abc#likes",
    action: "favorite",
  }));
  assertEquals(html.includes("favorite=save"), false);
  assertEquals(html.includes("review=compose"), false);
  assertEquals(html.includes("report=abc"), false);
  assertStringIncludes(html, "from=featured");
  assertStringIncludes(html, "oauth_cancelled=favorite");
});

Deno.test("permission upgrade forms retain complete project context", () => {
  const html = renderToString(h(PermissionUpgradeForm, {
    user: { did: "did:plc:app", handle: "app.example" },
    returnTo: "/apps/manage?new=1#profile",
    intent: "project",
    capabilities: ["app", "media"],
    action: "app",
    targetName: "Example App",
  }));

  assertStringIncludes(html, 'action="/oauth/login"');
  assertStringIncludes(html, 'action="/oauth/add-account"');
  assertStringIncludes(
    html,
    'name="handle" value="did:plc:app"',
  );
  assertEquals(html.includes('name="handle" value="app.example"'), false);
  assertEquals(count(html, 'name="intent" value="project"'), 2);
  assertEquals(
    count(html, 'name="next" value="/apps/manage?new=1#profile"'),
    2,
  );
  assertEquals(count(html, 'name="action" value="app"'), 2);
  assertEquals(count(html, 'name="name" value="Example App"'), 2);
  assertEquals(count(html, 'name="capability" value="app"'), 2);
  assertEquals(count(html, 'name="capability" value="media"'), 2);
  assertStringIncludes(html, "Approve and continue");
});

Deno.test("signed-in picker recovery keeps the nonpersistent continuation", () => {
  const html = renderToString(h(PermissionUpgradeForm, {
    user: { did: "did:plc:alice", handle: "alice.example" },
    returnTo:
      "/login/select?client_id=https%3A%2F%2Fapp.example&return_uri=https%3A%2F%2Fapp.example%2Fcallback&state=opaque",
    capabilities: ["identity"],
    action: "account",
    targetName: null,
    continuation: "login_selection",
  }));
  assertEquals(
    count(html, 'name="continuation" value="login_selection"'),
    2,
  );
});

Deno.test("identity-only confirmation does not claim to add permission", () => {
  const html = renderToString(h(PermissionUpgradeForm, {
    user: { did: "did:plc:admin", handle: "admin.example" },
    returnTo: "/admin/reviews",
    capabilities: ["identity"],
    action: "admin",
    targetName: null,
  }));

  assertStringIncludes(html, "Confirm and continue");
  assertEquals(html.includes("Approve and continue"), false);
  assertEquals(
    signedInAuthHeading(["identity"]),
    "Confirm your account",
  );
  assertEquals(
    signedInAuthHeading(["profile", "media"]),
    "Approve access to continue",
  );
});

Deno.test("media permission gets explicit image-upload context", () => {
  assertEquals(authMediaContext(["app"]), null);
  assertEquals(
    authMediaContext(["app", "media"]),
    "This also allows the new image you selected to be uploaded.",
  );
});

Deno.test("review and Like copy retain the requested target", () => {
  const review = authActionCopy("review", "Grain");
  assertEquals(review.title, "Login with Atmosphere");
  assertStringIncludes(review.signInBody, "review of Grain");

  const reviewManage = authActionCopy("review_manage", "Grain");
  assertStringIncludes(reviewManage.signInBody, "review of Grain");

  const favorite = authActionCopy("favorite", "Grain");
  assertEquals(favorite.title, "Login with Atmosphere");
  assertStringIncludes(favorite.signInBody, "like Grain");
  assertStringIncludes(favorite.upgradeBody("alice.example"), "like Grain");
  assertEquals(favorite.signInBody.includes("save"), false);
  assertEquals(favorite.signInBody.includes("favorite"), false);
  assertEquals(favorite.signInBody.includes("record"), false);
});

Deno.test("every OAuth action has fallback-page copy", () => {
  for (const action of OAUTH_ACTIONS) {
    const copy = authActionCopy(action, "Example");
    assertEquals(copy.eyebrow.length > 0, true, action);
    assertEquals(copy.signInBody.length > 0, true, action);
    assertEquals(copy.upgradeBody("alice.example").length > 0, true, action);
  }

  assertStringIncludes(
    authActionCopy("relationship_confirm", "Example and pds.example")
      .signInBody,
    "app or account host",
  );
  assertStringIncludes(
    authActionCopy("admin", null).signInBody,
    "authorized account",
  );
});

Deno.test("authorization recovery messages are brief and non-technical", () => {
  assertEquals(
    permissionStatusCopy("denied"),
    "You canceled Login with Atmosphere. Nothing changed.",
  );
  assertEquals(
    permissionStatusCopy("partial"),
    "Your account host did not approve everything needed. Try again or choose another account.",
  );
  assertEquals(
    permissionStatusCopy("concurrent"),
    "Your account changed while this was open. Continue once more to finish safely.",
  );
  assertEquals(
    permissionStatusCopy("failed"),
    "Login with Atmosphere could not be completed. Nothing changed. Try again.",
  );
  assertEquals(permissionStatusCopy("required"), null);
});

Deno.test("create mode does not reuse or auto-continue the signed-in account", () => {
  assertEquals(shouldUseExistingAccount("signin"), true);
  assertEquals(shouldUseExistingAccount("create"), false);
  assertEquals(shouldUseExistingAccount("signin", true), false);

  const html = renderToString(h(SignInPageContent, {
    account: {
      user: { did: "did:plc:alice", handle: "alice.example" },
      accountType: "user",
      avatarUrl: null,
      publicProfileHandle: null,
      accountHost: null,
      rememberedAccounts: [{
        did: "did:plc:alice",
        handle: "alice.example",
      }],
    },
    next: "/apps/manage?new=1",
    capabilities: ["app"],
    action: "app",
    targetName: "your app",
    permissionState: null,
    initialMode: "create",
    choosingAnotherAccount: false,
    allowAccountCreation: true,
    createAccountHosts: [],
    oauthConfigured: true,
  }));

  assertStringIncludes(html, "Create an Atmosphere account");
  assertEquals(html.includes("New account"), false);
  assertEquals(html.includes("Choose where your account will live."), false);
  assertStringIncludes(
    html,
    "<h2>Your host is where your account lives.</h2>",
  );
  assertStringIncludes(
    html,
    "Create an account with a host and you’ll return here when it’s ready.",
  );
  assertStringIncludes(html, 'class="signin-create-intro-card"');
  assertStringIncludes(html, 'class="signin-create-intro-icon"');
  assertStringIncludes(html, '<a href="/apps">app</a> in the Atmosphere');
  assertStringIncludes(
    html,
    "<h2>Your account is yours.</h2><p>You can move it to another host later, and if you own a domain, you can use it as your handle - for example,",
  );
  assertStringIncludes(html, "<strong>you.com</strong>");
  assertEquals(html.includes("Already use Bluesky?"), false);
  assertStringIncludes(html, 'data-signin-mode-content="create"');
  assertStringIncludes(html, 'data-initial-mode="create"');
  assertStringIncludes(html, 'data-signin-page-copy="true"');
  assertStringIncludes(
    html,
    'data-signin-copy-create="Create an Atmosphere account"',
  );
  assertStringIncludes(
    html,
    'data-signin-copy-signin="Choose your app’s account"',
  );
  assertStringIncludes(html, "Choose an account host");
  assertEquals(html.includes('role="tablist"'), false);
  assertEquals(html.includes('data-signin-tab="signin"'), false);
  assertEquals(
    /<section data-signin-panel="signin"[^>]*\shidden>/.test(html),
    true,
  );
  assertEquals(html.includes("Currently signed in"), false);
});

Deno.test("another-account mode keeps the current session out of the chooser decision", () => {
  const html = renderToString(h(SignInPageContent, {
    account: {
      user: { did: "did:plc:alice", handle: "alice.example" },
      accountType: "user",
      avatarUrl: null,
      publicProfileHandle: null,
      accountHost: null,
      rememberedAccounts: [{
        did: "did:plc:alice",
        handle: "alice.example",
      }],
    },
    next: "/account",
    capabilities: ["identity"],
    action: "account",
    targetName: null,
    permissionState: "required",
    initialMode: "signin",
    choosingAnotherAccount: true,
    allowAccountCreation: true,
    createAccountHosts: [],
    oauthConfigured: true,
  }));

  assertStringIncludes(html, "Choose another account");
  assertStringIncludes(html, "Not now");
  assertEquals(html.includes("Currently signed in"), false);
  assertEquals(count(html, 'name="choose" value="another"'), 2);
});

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
