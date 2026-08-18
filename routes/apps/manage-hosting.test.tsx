import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import type { AppListing } from "../../lib/app-directory.ts";
import type { DirectoryEntityAppLink } from "../../lib/directory-entity-links.ts";
import { AppHostingSummary, primaryAccountHostLink } from "./manage.tsx";
import { AppHostRelationshipsPage } from "./manage/host.tsx";

function listing(overrides: Partial<AppListing> = {}): AppListing {
  return {
    id: "app-one",
    slug: "one",
    name: "One",
    productDid: "did:plc:owner",
    profileDid: "did:plc:owner",
    legacyProfileDid: null,
    atstoreListingUri: "at://did:plc:owner/fyi.atstore.listing.detail/app-one",
    accountHost: null,
    ...overrides,
  } as AppListing;
}

function hostLink(
  overrides: Partial<DirectoryEntityAppLink> = {},
): DirectoryEntityAppLink {
  return {
    host: "pds.example",
    appListingId: "app-one",
    relationship: "same_product",
    status: "verified",
    source: "claimed",
    hostOwnerDid: "did:plc:host",
    appOwnerDid: "did:plc:owner",
    hostApprovedAt: 1,
    appApprovedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    appSlug: "one",
    appName: "One",
    hostDisplayName: "Example Host",
    ...overrides,
  };
}

Deno.test("app management shows the existing account host instead of another add action", () => {
  const link = hostLink();
  const html = renderToString(
    <AppHostingSummary
      link={link}
      initialPublished
      managedAppListingId="app-one"
    />,
  );

  assertStringIncludes(html, "Example Host");
  assertStringIncludes(html, "pds.example is the account host for this app.");
  assertStringIncludes(html, "Manage account hosting");
  assertEquals(html.includes("Connect account host"), false);
  assertEquals(html.includes("Add account hosting"), false);
});

Deno.test("app management offers one host connection only when none exists", () => {
  const html = renderToString(
    <AppHostingSummary
      link={null}
      initialPublished
      managedAppListingId="app-one"
    />,
  );

  assertStringIncludes(html, "Connect an account host");
  assertStringIncludes(html, "Connect account host");
  assertEquals(html.includes("Manage account hosting"), false);
});

Deno.test("verified hosting is preferred and host-only overrides are ignored", () => {
  const pending = hostLink({ host: "pending.example", status: "pending" });
  const hostOnly = hostLink({
    host: "override.example",
    relationship: "host_only",
  });
  const verified = hostLink({ host: "verified.example" });

  assertEquals(
    primaryAccountHostLink([pending, hostOnly, verified])?.host,
    "verified.example",
  );
  assertEquals(primaryAccountHostLink([hostOnly]), null);
});

Deno.test("hosting management returns to the exact ATStore app and hides add forms", () => {
  const app = listing();
  const html = renderToString(
    <AppHostRelationshipsPage
      app={app}
      apps={[app]}
      links={[hostLink()]}
      account={{
        user: { did: "did:plc:owner", handle: "owner.example" },
        hasManagedAppProfile: true,
        hasManagedHostProfiles: false,
        hasManagedProfiles: true,
        accountType: "project",
        avatarUrl: null,
        publicProfileHandle: "one",
        accountHost: null,
        rememberedAccounts: [],
      }}
      error={null}
      success={null}
    />,
  );

  assertStringIncludes(html, 'href="/apps/manage?app=app-one"');
  assertStringIncludes(html, "Example Host");
  assertEquals(html.includes("Connect account hosting"), false);
  assertEquals(html.includes("Find a detected PDS"), false);
});
