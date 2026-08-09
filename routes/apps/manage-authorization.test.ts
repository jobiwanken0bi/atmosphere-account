import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AppListing } from "../../lib/app-directory.ts";
import { isEditableRequestedApp } from "./manage.tsx";

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
