import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AccountHost } from "../../lib/account-hosts.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { AppListing } from "../../lib/app-directory.ts";
import {
  AccountHostManagementCard,
  differentAppAccountHref,
  differentAppRememberedAccounts,
  ExistingAppRegistrationPage,
  isEditableRequestedApp,
} from "./manage.tsx";

function listing(overrides: Partial<AppListing> = {}): AppListing {
  return {
    id: "app-one",
    slug: "one",
    name: "One",
    productDid: "did:plc:owner",
    profileDid: "did:plc:owner",
    legacyProfileDid: null,
    atstoreListingUri: "at://did:plc:owner/fyi.atstore.listing.detail/app-one",
    ...overrides,
  } as AppListing;
}

Deno.test("explicit app edit targets require local ownership before authorization", () => {
  assertEquals(isEditableRequestedApp(listing(), "did:plc:owner"), true);
  assertEquals(isEditableRequestedApp(listing(), "did:plc:other"), false);
  assertEquals(
    isEditableRequestedApp(
      listing({
        atstoreListingUri:
          "at://did:plc:other/fyi.atstore.listing.detail/app-one",
      }),
      "did:plc:owner",
    ),
    false,
  );
  assertEquals(
    isEditableRequestedApp(
      listing({ atstoreListingUri: null }),
      "did:plc:owner",
    ),
    false,
  );
});

Deno.test("an existing app blocks same-account registration and offers account replacement", () => {
  const html = renderToString(
    h(ExistingAppRegistrationPage, {
      user: { did: "did:plc:owner", handle: "app.example" },
      account: {
        user: { did: "did:plc:owner", handle: "app.example" },
        accountType: "project",
        avatarUrl: null,
        publicProfileHandle: "one",
        accountHost: null,
        rememberedAccounts: [
          { did: "did:plc:owner", handle: "app.example" },
          { did: "did:plc:other", handle: "other.example" },
        ],
      },
      app: listing(),
      appAuthorized: true,
    }),
  );

  assertStringIncludes(html, "This account already has an app");
  assertStringIncludes(html, "Each app uses its own Atmosphere account");
  assertStringIncludes(html, "Manage your app");
  assertStringIncludes(html, "Use another account");
  assertStringIncludes(html, 'href="/apps/manage?app=app-one"');
  assertEquals(html.includes("Register another app"), false);
});

Deno.test("different-app chooser cannot offer or auto-select the current DID", () => {
  assertEquals(
    differentAppRememberedAccounts([
      { did: "did:plc:owner", handle: "app.example" },
      { did: "did:plc:other", handle: "other.example" },
      { did: "did:plc:owner", handle: "renamed.example" },
    ], "did:plc:owner"),
    [{ did: "did:plc:other", handle: "other.example" }],
  );

  const fallback = new URL(
    differentAppAccountHref(),
    "https://atmosphereaccount.com",
  );
  assertEquals(fallback.pathname, "/oauth/add-account");
  assertEquals(fallback.searchParams.get("next"), "/apps/manage?new=1");
  assertEquals(fallback.searchParams.get("intent"), "project");
  assertEquals(fallback.searchParams.get("action"), "app");
  assertEquals(fallback.searchParams.getAll("capability"), ["app"]);
  assertEquals(fallback.searchParams.has("handle"), false);
});

Deno.test("app management shows an existing connected account host", () => {
  const html = renderToString(
    h(AccountHostManagementCard, {
      accountHost: "sprk.so",
      initialPublished: true,
      managedAppListingId: "app-one",
    }),
  );

  assertStringIncludes(html, "sprk.so");
  assertStringIncludes(
    html,
    "This app is connected to the sprk.so account host.",
  );
  assertStringIncludes(html, "Manage connection");
  assertStringIncludes(html, 'href="/hosts/sprk.so"');
  assertEquals(html.includes("Add account hosting"), false);
});

Deno.test("app management recognizes a host listing owned by the same account", () => {
  const html = renderToString(
    h(AccountHostManagementCard, {
      accountHost: null,
      managedHosts: [{
        host: "pds.example.social",
        displayName: "Example PDS",
      } as AccountHost],
      initialPublished: true,
      managedAppListingId: "app-one",
    }),
  );

  assertStringIncludes(html, "<h2>Example PDS</h2>");
  assertStringIncludes(
    html,
    "This account also manages the pds.example.social account host listing.",
  );
  assertStringIncludes(html, "Manage account hosting");
  assertStringIncludes(
    html,
    'href="/hosts/pds.example.social/manage"',
  );
  assertStringIncludes(html, "Manage host listing");
  assertEquals(html.includes("Add account hosting"), false);
  assertEquals(html.includes("View apps and hosts"), false);
});

Deno.test("app management links to the renamed owner workspace", () => {
  const html = renderToString(
    h(AccountHostManagementCard, {
      accountHost: null,
      managedHosts: [],
      initialPublished: true,
      managedAppListingId: "app-one",
    }),
  );

  assertStringIncludes(html, 'href="/account/products"');
  assertStringIncludes(html, "Manage listings");
  assertEquals(html.includes("View apps and hosts"), false);
});
