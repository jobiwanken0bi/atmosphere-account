import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authActionCopy, pickerClientIdFromNextForTest } from "./signin.tsx";

Deno.test("app authorization copy describes the complete records and images job", () => {
  const copy = authActionCopy("app", "Example App");
  assertStringIncludes(copy.signInBody, "app records and images");
  assertStringIncludes(copy.upgradeBody("alice.example"), "including images");
});

Deno.test("host claim copy separates repository permission from DNS ownership proof", () => {
  const copy = authActionCopy("host_claim", "Example Host");
  assertStringIncludes(copy.signInBody, "public profile and images");
  assertStringIncludes(copy.signInBody, "does not claim the host");
  assertStringIncludes(copy.signInBody, "DNS verification separately proves");
});

Deno.test("host transfer copy names the new manager and separate DNS proof", () => {
  const copy = authActionCopy("host_transfer", "Example Host");
  assertStringIncludes(copy.eyebrow, "new managing account");
  assertStringIncludes(copy.signInBody, "public profile and images");
  assertStringIncludes(copy.signInBody, "DNS verification separately proves");
});

Deno.test("personal account authorization remains identity-only in its copy", () => {
  const copy = authActionCopy("account", null);
  assertEquals(copy.eyebrow, "Atmosphere Account");
  assertStringIncludes(copy.signInBody, "Identity authentication");
  assertEquals(copy.signInBody.includes("images"), false);
});

Deno.test("developer authorization belongs to an existing app profile", () => {
  const copy = authActionCopy("developer", null);
  assertStringIncludes(copy.eyebrow, "app developer settings");
  assertStringIncludes(copy.signInBody, "account that represents the app");
  assertStringIncludes(copy.signInBody, "No repository access is required");
  assertEquals(
    copy.signInBody.includes("own this developer registration"),
    false,
  );
});

Deno.test("create-account continuation keeps picker app context", () => {
  assertEquals(
    pickerClientIdFromNextForTest(
      "/login/select?client_id=https%3A%2F%2Fapp.example%2Fclient.json&return_uri=https%3A%2F%2Fapp.example%2Fcallback&state=opaque",
    ),
    "https://app.example/client.json",
  );
  assertEquals(
    pickerClientIdFromNextForTest("/apps/tangled?review=compose"),
    null,
  );
  assertEquals(pickerClientIdFromNextForTest("https://evil.example"), null);
});
