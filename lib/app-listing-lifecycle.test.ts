import { resolveAppListingWriteTarget } from "./app-listing-lifecycle.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("new app listings publish to ATStore", () => {
  assertEquals(
    resolveAppListingWriteTarget({
      hasLegacyProfile: false,
      categories: ["app"],
    }),
    "atstore_listing",
  );
});

Deno.test("ATStore-only app edits keep using ATStore", () => {
  assertEquals(
    resolveAppListingWriteTarget({
      hasLegacyProfile: false,
      hasAtstoreListing: true,
      categories: ["app", "tool"],
    }),
    "atstore_listing",
  );
});

Deno.test("legacy app with shared ATStore listing keeps using ATStore", () => {
  assertEquals(
    resolveAppListingWriteTarget({
      hasLegacyProfile: true,
      hasAtstoreListing: true,
      categories: ["app"],
    }),
    "atstore_listing",
  );
});

Deno.test("legacy Atmosphere listings keep using the compatibility profile path", () => {
  assertEquals(
    resolveAppListingWriteTarget({
      hasLegacyProfile: true,
      hasAtstoreListing: false,
      categories: ["app"],
    }),
    "legacy_profile",
  );
});

Deno.test("non-app project records keep using the legacy profile path", () => {
  assertEquals(
    resolveAppListingWriteTarget({
      hasLegacyProfile: false,
      categories: ["account-host"],
    }),
    "legacy_profile",
  );
});
