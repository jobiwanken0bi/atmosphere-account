import { assertEquals } from "jsr:@std/assert@1";
import {
  appProfileConflictResponseForTest,
  profileCollectionBoundsErrorForTest,
  profileCreateListingKeyErrorForTest,
} from "./profile.ts";

Deno.test("profile payloads bound collection cardinality independently of image bytes", () => {
  assertEquals(
    profileCollectionBoundsErrorForTest({
      categories: Array(129).fill("app"),
    }),
    "categories: too many items",
  );
  assertEquals(
    profileCollectionBoundsErrorForTest({
      screenshotUploads: Array(5).fill({
        dataBase64: "",
        mimeType: "image/png",
      }),
    }),
    "screenshotUploads: too many items",
  );
  assertEquals(
    profileCollectionBoundsErrorForTest({
      categories: ["app"],
      links: [],
      screenshotUploads: [],
    }),
    null,
  );
});

Deno.test("distinct app creation requires a stable retry key", () => {
  const tid = "3mzzzzzzzzzzz";
  assertEquals(profileCreateListingKeyErrorForTest(true, tid), null);
  assertEquals(
    profileCreateListingKeyErrorForTest(true, null),
    "invalid app listing creation key",
  );
  assertEquals(
    profileCreateListingKeyErrorForTest(true, "not-a-tid"),
    "invalid app listing creation key",
  );
  assertEquals(
    profileCreateListingKeyErrorForTest(false, tid),
    null,
  );
});

Deno.test("direct second-app API attempts receive a stable friendly conflict", async () => {
  const response = appProfileConflictResponseForTest({
    id: "reader",
    slug: "reader.example",
  });
  assertEquals(response.status, 409);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(await response.json(), {
    error: "app_profile_already_exists",
    detail:
      "This account already has an app profile. Manage that profile, or switch to the account for the other app.",
    existingApp: {
      id: "reader",
      publicPath: "/apps/reader.example",
    },
  });
});
