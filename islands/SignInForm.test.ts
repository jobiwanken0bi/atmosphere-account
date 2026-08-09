import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { CreateAccountHostOption } from "../lib/create-account-hosts.ts";
import SignInForm, { createAccountHostHref } from "./SignInForm.tsx";

const directHost: CreateAccountHostOption = {
  name: "Example Host",
  host: "host.example",
  href: "https://host.example/signup",
  description: "Example",
  location: null,
  avatarUrl: null,
  signupStatus: "open",
  oauthAccountCreation: true,
  statusLabel: "Direct",
  recommended: false,
  recommendationLabel: null,
};

Deno.test("direct account creation defaults to identity-only", () => {
  assertEquals(
    createAccountHostHref(directHost, "/account"),
    "/oauth/create?host=host.example&next=%2Faccount&capability=identity&action=account",
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

Deno.test("direct account creation rejects management-only actions", () => {
  assertThrows(
    () =>
      createAccountHostHref(
        directHost,
        "/hosts/example.com/manage",
        undefined,
        ["host", "media"],
        "host_manage",
      ),
    TypeError,
    'Account creation is not available for OAuth action "host_manage"',
  );
});

Deno.test("direct create mode is create-only and uses the requested account copy", () => {
  const html = renderToString(h(SignInForm, {
    mode: "create",
    rich: true,
    returnTo: "/apps/tangled?review=compose",
    action: "review",
    capabilities: ["review"],
    targetName: "Tangled",
    createAccountHosts: [directHost],
    createAccountHostsEndpoint: "/api/login/account-hosts",
  }));

  assertStringIncludes(html, "Your host is where your account lives");
  assertStringIncludes(html, 'href="/apps"');
  assertStringIncludes(html, "Your account is yours");
  assertStringIncludes(html, "<strong>you.com</strong>");
  assertStringIncludes(html, "Choose an account host");
  assertEquals(html.includes('action="/oauth/login"'), false);
  assertEquals(html.includes('role="tab"'), false);
  assertEquals(html.includes("Atmosphere never receives"), false);
  assertStringIncludes(html, "Open signup");
});

Deno.test("invite-required hosts are not described as direct signup", () => {
  const html = renderToString(h(SignInForm, {
    mode: "create",
    action: "account",
    capabilities: ["identity"],
    createAccountHosts: [{
      ...directHost,
      signupStatus: "invite_required",
      statusLabel: "Direct",
    }],
  }));
  assertStringIncludes(html, "Invite required");
  assertEquals(html.includes(">Direct<"), false);
});

Deno.test("sign-in mode links to one canonical contextual create page", () => {
  const html = renderToString(h(SignInForm, {
    returnTo: "/apps/tangled?review=compose",
    action: "review",
    capabilities: ["review"],
    targetName: "Tangled",
  }));
  const rawHref = html.match(
    /class="signin-create-account-link" href="([^"]+)"/,
  )?.[1]?.replaceAll("&amp;", "&");
  const url = new URL(rawHref ?? "", "https://atmosphereaccount.com");
  assertEquals(url.pathname, "/signin");
  assertEquals(url.searchParams.get("mode"), "create");
  assertEquals(url.searchParams.get("next"), "/apps/tangled?review=compose");
  assertEquals(url.searchParams.get("action"), "review");
  assertEquals(url.searchParams.getAll("capability"), ["review"]);
  assertStringIncludes(html, "Already use Bluesky?");
  assertStringIncludes(html, "Login with Atmosphere");
});

Deno.test("picker sign-in returns directly to the initiating login request", () => {
  const html = renderToString(h(SignInForm, {
    returnTo:
      "/login/select?client_id=https%3A%2F%2Fapp.example%2Fclient-metadata.json&return_uri=https%3A%2F%2Fapp.example%2Fcallback&state=state-1",
    action: "account",
    capabilities: ["identity"],
  }));
  assertStringIncludes(html, 'name="continuation" value="login_selection"');
});

Deno.test("management-only sign-in cannot offer account creation", () => {
  const html = renderToString(h(SignInForm, {
    returnTo: "/hosts/example.com/manage",
    action: "host_manage",
    capabilities: ["host", "media"],
  }));
  assertEquals(html.includes("Create an Atmosphere account"), false);
});

Deno.test("create mode exposes recoverable errors as alerts", () => {
  const html = renderToString(h(SignInForm, {
    mode: "create",
    action: "account",
    capabilities: ["identity"],
    createAccountError: "That host is unavailable.",
    createAccountHostsUnavailable: true,
    createAccountHostsEndpoint: "/api/login/account-hosts",
  }));
  assertStringIncludes(html, 'role="alert"');
  assertStringIncludes(html, "That host is unavailable.");
  assertStringIncludes(html, "host directory is temporarily unavailable");
  assertStringIncludes(html, "Try loading hosts again");
});

Deno.test("create mode remains inspectable but guards hosts when OAuth is unavailable", () => {
  const html = renderToString(h(SignInForm, {
    mode: "create",
    action: "account",
    capabilities: ["identity"],
    createAccountHosts: [directHost],
    createAccountStartUnavailable: true,
  }));
  assertStringIncludes(html, "Your host is where your account lives");
  assertStringIncludes(html, 'aria-disabled="true"');
  assertEquals(html.includes('href="/oauth/create'), false);
});

Deno.test("non-OAuth signup links are not decorated with Atmosphere permissions", () => {
  assertEquals(
    createAccountHostHref(
      { ...directHost, oauthAccountCreation: false },
      "/apps/create",
      "project",
      ["app", "media"],
    ),
    "https://host.example/signup",
  );
});
