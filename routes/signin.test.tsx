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
  contextualAuthorizationBackNavigation,
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
  assertEquals(
    readSignInAuthorizationRequest(
      new URL(
        "https://atmosphereaccount.com/signin?action=account&capability=identity&choose=another&entry=manual",
      ),
    ).manualAccountEntry,
    true,
  );
});

Deno.test("host authorization has a safe contextual backlink", () => {
  assertEquals(
    contextualAuthorizationBackNavigation(
      "/hosts/pds.example.com/claim?publish=1&from=detected",
      "host_claim",
    ),
    { href: "/hosts/pds.example.com", label: "Back to host" },
  );
  assertEquals(
    contextualAuthorizationBackNavigation(
      "/hosts/pds.example.com/claim?transfer_intent=opaque",
      "host_transfer",
    ),
    {
      href: "/hosts/pds.example.com/manage",
      label: "Back to host management",
    },
  );
  assertEquals(
    contextualAuthorizationBackNavigation(
      "/hosts/pds.example.com/claim?dns_token=public-token",
      "host_claim",
      true,
    ),
    {
      href: "/hosts/pds.example.com/claim?dns_token=public-token",
      label: "Back to claim",
    },
  );
  assertEquals(
    contextualAuthorizationBackNavigation(
      "https://evil.example/hosts/pds.example.com/claim",
      "host_claim",
    ),
    null,
  );
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
    displayName: "Example App",
    avatarUrl: "/api/registry/avatar/did%3Aplc%3Aapp",
    returnTo: "/apps/manage?new=1#profile",
    intent: "project",
    capabilities: ["app", "media"],
    action: "app",
    targetName: "Example App",
  }));

  assertStringIncludes(html, 'action="/oauth/login"');
  assertStringIncludes(html, 'method="GET" action="/oauth/login"');
  assertEquals(
    html.includes('method="POST" action="/oauth/login"'),
    false,
  );
  assertStringIncludes(html, 'action="/oauth/add-account"');
  assertStringIncludes(html, 'method="GET" action="/oauth/add-account"');
  assertEquals(
    html.includes('method="POST" action="/oauth/add-account"'),
    false,
  );
  assertStringIncludes(html, "Currently signed in");
  assertStringIncludes(html, "Example App");
  assertStringIncludes(html, "app.example");
  assertStringIncludes(
    html,
    'src="/api/registry/avatar/did%3Aplc%3Aapp',
  );
  assertStringIncludes(html, "Use another account");
  assertStringIncludes(html, "Choose a saved account or enter another handle");
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
    signedInAuthHeading(["app", "media"]),
    "Approve access to continue",
  );
});

Deno.test("media permission gets explicit image-upload context", () => {
  assertEquals(authMediaContext(["app"]), null);
  assertEquals(
    authMediaContext(["app", "media"]),
    "This includes image uploads for the app or host profile.",
  );
});

Deno.test("review and Like copy retain the requested target", () => {
  const review = authActionCopy("review", "Grain");
  assertEquals(review.title, "Login to write a review of Grain");
  assertEquals(review.signInBody, "Login to write a review of Grain");

  const reviewManage = authActionCopy("review_manage", "Grain");
  assertStringIncludes(reviewManage.signInBody, "review of Grain");

  const favorite = authActionCopy("favorite", "Grain");
  assertStringIncludes(favorite.title, "like Grain");
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
    "You canceled sign-in. Nothing changed.",
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
    "Sign-in could not be completed. Nothing changed. Try again.",
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
      hasManagedAppProfile: false,
      hasManagedHostProfiles: false,
      hasManagedProfiles: false,
      rememberedAccounts: [{
        did: "did:plc:alice",
        handle: "alice.example",
      }],
    },
    next: "/apps/manage?new=1",
    capabilities: ["app", "media"],
    action: "app",
    targetName: "your app",
    permissionState: null,
    mode: "create",
    choosingAnotherAccount: false,
    allowAccountCreation: true,
    createAccountHosts: [],
    createAccountHostsUnavailable: false,
    createAccountHostsEndpoint: "/api/login/account-hosts",
    createAccountError: null,
    oauthConfigured: true,
  }));

  assertStringIncludes(html, "Create an Atmosphere account");
  assertEquals(html.includes("One account, every app"), false);
  assertStringIncludes(html, 'data-initial-mode="create"');
  assertStringIncludes(html, 'data-signin-page-copy="true"');
  assertStringIncludes(html, "Choose an account host");
  assertEquals(html.includes("Currently signed in"), false);
  assertEquals(html.includes("Choose where your account will live"), false);
  assertEquals(html.includes("New account"), false);
});

Deno.test("another-account mode keeps the current session out of the chooser decision", () => {
  const html = renderToString(h(SignInPageContent, {
    account: {
      user: { did: "did:plc:alice", handle: "alice.example" },
      accountType: "user",
      avatarUrl: null,
      publicProfileHandle: null,
      accountHost: null,
      hasManagedAppProfile: false,
      hasManagedHostProfiles: false,
      hasManagedProfiles: false,
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
    mode: "signin",
    choosingAnotherAccount: true,
    allowAccountCreation: true,
    createAccountHosts: [],
    createAccountHostsUnavailable: false,
    createAccountHostsEndpoint: "/api/login/account-hosts",
    createAccountError: null,
    oauthConfigured: true,
  }));

  assertStringIncludes(html, "Enter your account handle");
  assertStringIncludes(html, "Not now");
  assertEquals(html.includes("Currently signed in"), false);
  assertStringIncludes(html, 'data-remembered-count="0"');
  assertEquals(count(html, 'name="choose" value="another"'), 1);
});

Deno.test("another-account mode lists only other saved accounts before manual entry", () => {
  const html = renderToString(h(SignInPageContent, {
    account: {
      user: { did: "did:plc:alice", handle: "alice.example" },
      accountType: "user",
      avatarUrl: null,
      publicProfileHandle: null,
      accountHost: null,
      hasManagedAppProfile: false,
      hasManagedHostProfiles: false,
      hasManagedProfiles: false,
      rememberedAccounts: [
        { did: "did:plc:alice", handle: "alice.example" },
        { did: "did:plc:bob", handle: "bob.example" },
      ],
    },
    next: "/hosts/pds.example.com/claim",
    capabilities: ["host", "media"],
    action: "host_claim",
    targetName: "Example Host",
    permissionState: "required",
    mode: "signin",
    choosingAnotherAccount: true,
    manualAccountEntry: false,
    allowAccountCreation: true,
    createAccountHosts: [],
    createAccountHostsUnavailable: false,
    createAccountHostsEndpoint: "/api/login/account-hosts",
    createAccountError: null,
    oauthConfigured: true,
  }));

  assertStringIncludes(html, 'data-initial-signin-view="saved"');
  assertStringIncludes(html, 'name="did" value="did:plc:bob"');
  assertEquals(html.includes('name="did" value="did:plc:alice"'), false);
  assertStringIncludes(html, "Choose another account");
  assertStringIncludes(html, "Use another account");
  assertStringIncludes(html, "entry=manual");
  assertStringIncludes(html, 'href="/hosts/pds.example.com/claim"');
  assertStringIncludes(html, "← Back to claim");
});

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
