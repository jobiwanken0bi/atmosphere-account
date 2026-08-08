import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { CreateAccountHostOption } from "../lib/create-account-hosts.ts";
import SignInForm, {
  accountCreationFallbackHref,
  createAccountHostHref,
  signinModeFallbackHref,
} from "./SignInForm.tsx";

const directHost: CreateAccountHostOption = {
  name: "Example Host",
  host: "host.example",
  href: "https://host.example/signup",
  description: "Example",
  location: null,
  avatarUrl: null,
  signupStatus: "open",
  oauthAccountCreation: true,
  statusLabel: "Open signup",
  recommended: false,
  recommendationLabel: null,
};

const rememberedAccounts = [{
  did: "did:plc:alice",
  handle: "alice.example",
}];

Deno.test("rich sign-in form keeps the prompt concise", () => {
  const html = renderToString(h(SignInForm, { rich: true }));

  assertStringIncludes(html, "Enter your handle");
  assertStringIncludes(html, "Create account");
  assertEquals(html.includes("Connect your Atmosphere account"), false);
  assertEquals(html.includes("New to the Atmosphere"), false);
  assertEquals(html.includes("Sign in with your Atmosphere handle"), false);
  assertStringIncludes(
    html,
    'data-error-label="Couldn’t start sign-in. Check the handle and try again."',
  );
  assertEquals(
    html.includes(
      "Enter the handle you use with Bluesky, Blacksky, Tangled, or any other account host.",
    ),
    false,
  );
});

Deno.test("saved-account view does not repeat the page explanation", () => {
  const html = renderToString(h(SignInForm, {
    rich: true,
    rememberedAccounts: [{
      did: "did:plc:alice",
      handle: "alice.example",
    }],
  }));

  assertStringIncludes(html, "Choose an account");
  assertStringIncludes(html, "Use another account");
  assertStringIncludes(html, "Enter its Atmosphere handle");
  assertEquals(html.includes("Choose an account saved on this device"), false);
});

Deno.test("saved and manual account views have no-JS links", () => {
  const savedHtml = renderToString(h(SignInForm, {
    rich: true,
    returnTo: "/account",
    rememberedAccounts,
  }));
  assertStringIncludes(savedHtml, 'data-signin-show-manual="true"');
  assertStringIncludes(savedHtml, "choose=another");

  const manualHtml = renderToString(h(SignInForm, {
    rich: true,
    returnTo: "/account",
    rememberedAccounts,
    chooseAnotherAccount: true,
  }));
  assertStringIncludes(manualHtml, 'data-signin-show-saved="true"');
  assertStringIncludes(manualHtml, 'href="/signin?next=%2Faccount');
});

Deno.test("create-account mode opens the host chooser with plain-language copy", () => {
  const html = renderToString(h(SignInForm, {
    rich: true,
    initialMode: "create",
    createAccountHosts: [directHost],
  }));

  assertStringIncludes(html, 'data-initial-mode="create"');
  assertStringIncludes(html, "Choose an account host");
  assertStringIncludes(
    html,
    "Your host creates your account and keeps it online. You’ll return here when it’s ready.",
  );
  assertStringIncludes(
    html,
    "Only hosts that can create an account here are shown. Atmosphere never sees your password or invite code.",
  );
  assertStringIncludes(html, "Open signup");
  assertEquals(html.includes("direct OAuth"), false);
});

Deno.test("empty account-host chooser explains the unavailable state", () => {
  const html = renderToString(h(SignInForm, {
    rich: true,
    initialMode: "create",
    createAccountHosts: [],
  }));

  assertStringIncludes(html, 'placeholder="Search hosts…"');
  assertStringIncludes(html, "No account hosts are available right now.");
  assertEquals(html.includes("match those filters"), false);
});

Deno.test("account-creation fallback keeps action context and opens create mode", () => {
  assertEquals(
    accountCreationFallbackHref(
      "/signin?next=%2Fapps%2Fmanage%3Fnew%3D1&action=app&name=Example&capability=app",
    ),
    "/signin?next=%2Fapps%2Fmanage%3Fnew%3D1&action=app&name=Example&capability=app&mode=create",
  );
  assertEquals(
    accountCreationFallbackHref("https://evil.example/signin"),
    "/signin?mode=create",
  );
});

Deno.test("sign-in mode tabs remain usable without JavaScript", () => {
  assertEquals(
    signinModeFallbackHref({
      mode: "create",
      returnTo: "/apps/manage?new=1",
      intent: "project",
      action: "app",
      capabilities: ["app", "media"],
      targetName: "Example",
      initialHandle: "example.test",
    }),
    "/signin?next=%2Fapps%2Fmanage%3Fnew%3D1&intent=project&action=app&name=Example&capability=app&capability=media&handle=example.test&mode=create",
  );
  const html = renderToString(h(SignInForm, {
    rich: true,
    returnTo: "/account",
    action: "account",
  }));
  assertStringIncludes(html, 'data-signin-tab="signin"');
  assertStringIncludes(html, 'href="/signin?next=%2Faccount');
});

Deno.test("existing-account actions hide creation and use a neutral submit label", () => {
  const html = renderToString(h(SignInForm, {
    rich: true,
    allowAccountCreation: false,
    initialMode: "create",
    submitLabel: "Continue",
  }));

  assertEquals(html.includes("Create account"), false);
  assertEquals(html.includes("Choose an account host"), false);
  assertStringIncludes(html, ">Continue</button>");
  assertStringIncludes(html, 'data-initial-mode="signin"');
});

Deno.test("saved and manual account paths retain complete action context", () => {
  const html = renderToString(h(SignInForm, {
    returnTo: "/apps/example?review=compose#reviews",
    intent: "project",
    capabilities: ["app", "media"],
    action: "app",
    targetName: "Example App",
    initialHandle: "alice.example",
    rememberedAccounts: [{
      did: "did:plc:alice",
      handle: "alice.example",
    }],
  }));

  assertStringIncludes(
    html,
    'name="next" value="/apps/example?review=compose#reviews"',
  );
  assertStringIncludes(html, 'name="intent" value="project"');
  assertStringIncludes(html, 'name="action" value="app"');
  assertStringIncludes(html, 'name="name" value="Example App"');
  assertEquals((html.match(/name="capability" value="app"/g) ?? []).length, 2);
  assertEquals(
    (html.match(/name="capability" value="media"/g) ?? []).length,
    2,
  );
});

Deno.test("forced reauthorization sends remembered accounts through fresh OAuth", () => {
  const html = renderToString(h(SignInForm, {
    returnTo: "/hosts/pds.example/manage?resume_host_profile=1",
    capabilities: ["host", "media"],
    action: "host_manage",
    targetName: "Example PDS",
    rememberedAccounts: [{
      did: "did:plc:owner",
      handle: "owner.example",
    }],
    allowAccountCreation: false,
    forceReauthorization: true,
  }));

  assertEquals(html.includes('action="/oauth/switch"'), false);
  assertStringIncludes(html, 'action="/oauth/login"');
  assertStringIncludes(
    html,
    'type="hidden" name="handle" value="did:plc:owner"',
  );
  assertStringIncludes(
    html,
    'name="next" value="/hosts/pds.example/manage?resume_host_profile=1"',
  );
  assertStringIncludes(html, 'name="action" value="host_manage"');
  assertStringIncludes(html, 'name="name" value="Example PDS"');
  assertEquals(
    (html.match(/name="capability" value="host"/g) ?? []).length,
    2,
  );
  assertEquals(
    (html.match(/name="capability" value="media"/g) ?? []).length,
    2,
  );
});

Deno.test("DID-owned reauthorization stays on its current account", () => {
  const html = renderToString(h(SignInForm, {
    returnTo: "/account",
    capabilities: ["profile"],
    action: "profile",
    targetName: "Alice",
    initialHandle: "alice.example",
    initialDid: "did:plc:alice",
    rememberedAccounts: [{
      did: "did:plc:bob",
      handle: "bob.example",
    }],
    allowAccountCreation: false,
    forceReauthorization: true,
    lockInitialHandle: true,
  }));

  assertStringIncludes(html, 'value="alice.example"');
  assertStringIncludes(
    html,
    'type="hidden" name="handle" value="did:plc:alice"',
  );
  assertStringIncludes(html, "readonly");
  assertEquals(html.includes("bob.example"), false);
  assertEquals(html.includes("Use another account"), false);
  assertEquals(html.includes('data-signin-preview="true"'), false);
  assertEquals(html.includes("data-signin-preview-input"), false);
});

Deno.test("alternate-account chooser intent survives both account paths", () => {
  const html = renderToString(h(SignInForm, {
    returnTo: "/account",
    action: "account",
    capabilities: ["identity"],
    chooseAnotherAccount: true,
    rememberedAccounts: [{
      did: "did:plc:other",
      handle: "other.example",
    }],
  }));

  assertEquals(
    (html.match(/name="choose" value="another"/g) ?? []).length,
    2,
  );
});

Deno.test("login-picker manual sign-in is a one-click nonpersistent continuation", () => {
  const html = renderToString(h(SignInForm, {
    returnTo: "/login/select?client_id=example",
    continuation: "login_selection",
    rich: true,
  }));

  assertStringIncludes(
    html,
    'name="continuation" value="login_selection"',
  );
  assertStringIncludes(html, "continuation=login_selection");

  const savedHtml = renderToString(h(SignInForm, {
    returnTo:
      "/login/select?client_id=https%3A%2F%2Fapp.example&return_uri=https%3A%2F%2Fapp.example%2Fcallback&state=opaque",
    continuation: "login_selection",
    rememberedAccounts,
    rich: true,
  }));
  assertStringIncludes(savedHtml, 'action="/oauth/login"');
  assertEquals(savedHtml.includes('action="/oauth/switch"'), false);
  assertStringIncludes(
    savedHtml,
    'name="continuation" value="login_selection"',
  );
  assertStringIncludes(savedHtml, "continuation=login_selection");
});

Deno.test("multiple sign-in forms receive unique progressive listbox IDs", () => {
  const html = renderToString(
    h(
      "div",
      null,
      h(SignInForm, { rich: false }),
      h(SignInForm, { rich: false }),
    ),
  );
  const inputIds = [...html.matchAll(/\sid="(signin-handle-[^"]+)"/g)].map(
    (match) => match[1],
  );
  const previewIds = [
    ...html.matchAll(/data-signin-preview-id="([^"]+)"/g),
  ].map((match) => match[1]);

  assertEquals(inputIds.length, 2);
  assertEquals(new Set(inputIds).size, 2);
  assertEquals(previewIds.length, 2);
  assertEquals(new Set(previewIds).size, 2);
  assertEquals(html.includes('role="combobox"'), false);
  assertEquals(html.includes('aria-controls="'), false);
});

Deno.test("direct account creation defaults to identity-only", () => {
  assertEquals(
    createAccountHostHref(directHost, "/account"),
    "/oauth/create?host=host.example&next=%2Faccount&capability=identity",
  );
});

Deno.test("direct account creation preserves contextual capability upgrades", () => {
  assertEquals(
    createAccountHostHref(
      directHost,
      "/apps/create?new=1",
      "project",
      ["app", "media"],
      "app",
    ),
    "/oauth/create?host=host.example&next=%2Fapps%2Fcreate%3Fnew%3D1&intent=project&capability=app&capability=media&action=app",
  );
});

Deno.test("login-picker account creation stays nonpersistent", () => {
  assertEquals(
    createAccountHostHref(
      directHost,
      "/login/select?client_id=https%3A%2F%2Fapp.example&return_uri=https%3A%2F%2Fapp.example%2Fcallback&state=opaque",
      undefined,
      ["identity"],
      "account",
      undefined,
      "login_selection",
    ),
    "/oauth/create?host=host.example&next=%2Flogin%2Fselect%3Fclient_id%3Dhttps%253A%252F%252Fapp.example%26return_uri%3Dhttps%253A%252F%252Fapp.example%252Fcallback%26state%3Dopaque&capability=identity&action=account&continuation=login_selection",
  );
});

Deno.test("direct account creation rejects mismatched action capabilities", () => {
  assertThrows(
    () =>
      createAccountHostHref(
        directHost,
        "/apps/example",
        undefined,
        ["legacy_review"],
        "review",
      ),
    TypeError,
    'Invalid capability bundle for OAuth action "review"',
  );
});

Deno.test("non-OAuth signup links are not decorated with Atmosphere permissions", () => {
  assertEquals(
    createAccountHostHref(
      { ...directHost, oauthAccountCreation: false },
      "/apps/create",
      "project",
      ["app"],
    ),
    "https://host.example/signup",
  );
});
