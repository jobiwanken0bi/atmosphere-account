import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  userProfileResumeLocation,
  userProfileResumePath,
} from "./user-profile-resume.ts";

Deno.test("profile edit resume requires its account-bound return marker", () => {
  const path = userProfileResumePath("did:plc:alice");
  assertEquals(
    userProfileResumeLocation(path, "did:plc:alice"),
    { hadMarker: true, shouldResume: true, cleanLocation: "/account" },
  );
  assertEquals(
    userProfileResumeLocation(path, "did:plc:bob").shouldResume,
    false,
  );
  assertEquals(
    userProfileResumeLocation("/account", "did:plc:alice"),
    { hadMarker: false, shouldResume: false, cleanLocation: "/account" },
  );
});
