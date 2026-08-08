import { assertEquals } from "jsr:@std/assert@1";
import {
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
    "unexpected app listing creation key",
  );
});
