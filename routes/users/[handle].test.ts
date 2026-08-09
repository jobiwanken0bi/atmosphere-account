import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { legacyUserProfileRedirect } from "./[handle].tsx";

Deno.test("retired user profile links redirect to the Bluesky profile", () => {
  assertEquals(
    legacyUserProfileRedirect("Alice.Example"),
    "https://bsky.app/profile/alice.example",
  );
  assertEquals(
    legacyUserProfileRedirect("did%3Aplc%3Aalice"),
    "https://bsky.app/profile/did%3Aplc%3Aalice",
  );
});

Deno.test("retired user profile links reject invalid identifiers", () => {
  assertEquals(legacyUserProfileRedirect("not-a-handle"), null);
  assertEquals(legacyUserProfileRedirect("%E0%A4%A"), null);
  assertEquals(legacyUserProfileRedirect(undefined), null);
});
