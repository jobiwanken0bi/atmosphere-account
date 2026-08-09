import { assertEquals } from "jsr:@std/assert@1";
import { atstoreReviewerDisplayName } from "./atstore-profile.ts";

Deno.test("ATStore reviewer profile uses Bluesky name with handle fallback", () => {
  assertEquals(
    atstoreReviewerDisplayName(
      "  Alice on Bluesky  ",
      "alice.example",
      "did:plc:alice",
    ),
    "Alice on Bluesky",
  );
  assertEquals(
    atstoreReviewerDisplayName(null, "alice.example", "did:plc:alice"),
    "alice.example",
  );
  assertEquals(
    atstoreReviewerDisplayName("", "", "did:plc:alice"),
    "did:plc:alice",
  );
});
