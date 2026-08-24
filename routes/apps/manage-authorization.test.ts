import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { AccountHost } from "../../lib/account-hosts.ts";
import type { AppListing } from "../../lib/app-directory.ts";
import { AppHostingSummary, isEditableRequestedApp } from "./manage.tsx";

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

Deno.test("app management recognizes a host listing owned by the same account", () => {
  const html = renderToString(
    h(AppHostingSummary, {
      link: null,
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
  assertStringIncludes(html, 'href="/hosts/pds.example.social/manage"');
  assertStringIncludes(html, "Manage host listing");
  assertEquals(html.includes("Connect account host"), false);
  assertEquals(html.includes("View apps and hosts"), false);
});

Deno.test("app management links to the renamed listings workspace", () => {
  const html = renderToString(
    h(AppHostingSummary, {
      link: null,
      managedHosts: [],
      initialPublished: true,
      managedAppListingId: "app-one",
    }),
  );

  assertStringIncludes(html, 'href="/account/apps-hosts"');
  assertStringIncludes(html, "Manage listings");
});
