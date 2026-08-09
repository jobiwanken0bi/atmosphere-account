import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appManagementHref } from "./app-management-navigation.ts";

Deno.test("ATStore app management targets the account's exact listing", () => {
  assertEquals(
    appManagementHref({
      id: "app id/with spaces",
      atstoreListingUri:
        "at://did:plc:owner/fyi.atstore.listing.detail/3mexample",
    }, "did:plc:owner"),
    "/apps/manage?app=app%20id%2Fwith%20spaces",
  );
});

Deno.test("legacy and foreign listings use DID-scoped management", () => {
  assertEquals(
    appManagementHref(
      { id: "legacy", atstoreListingUri: null },
      "did:plc:owner",
    ),
    "/apps/manage",
  );
  assertEquals(
    appManagementHref({
      id: "foreign",
      atstoreListingUri:
        "at://did:plc:other/fyi.atstore.listing.detail/3mexample",
    }, "did:plc:owner"),
    "/apps/manage",
  );
});
