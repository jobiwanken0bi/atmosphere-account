import {
  APP_PROFILE_RESUME_PARAM,
  appProfilePendingKey,
  appProfileResumeLocation,
  appProfileResumeProofKey,
  appProfileResumeReturnTo,
  appProfileReturnToWithoutResume,
} from "./app-profile-resume.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("app profile resume return is explicit and preserves other query", () => {
  const did = "did:plc:alice";
  const returnTo = appProfileResumeReturnTo(
    "/apps/manage?app=one&new=1",
    did,
  );
  const url = new URL(returnTo, "https://example.test");
  assertEquals(url.pathname, "/apps/manage");
  assertEquals(url.searchParams.get("app"), "one");
  assertEquals(url.searchParams.get("new"), "1");
  assertEquals(url.searchParams.get(APP_PROFILE_RESUME_PARAM), did);
});

Deno.test("app profile pending key ignores the completed-return marker", () => {
  const did = "did:plc:alice";
  const base = "/apps/manage?app=one";
  const marked = appProfileResumeReturnTo(base, did);
  assertEquals(
    appProfilePendingKey(did, marked),
    appProfilePendingKey(did, base),
  );
  assertEquals(
    appProfileResumeProofKey(appProfilePendingKey(did, marked)),
    appProfileResumeProofKey(appProfilePendingKey(did, base)),
  );
});

Deno.test("app profile resume is consumed only by the originating DID", () => {
  const href = `https://example.test${
    appProfileResumeReturnTo("/apps/manage?app=one#form", "did:plc:alice")
  }`;
  const matching = appProfileResumeLocation(href, "did:plc:alice");
  assertEquals(matching.hadMarker, true);
  assertEquals(matching.shouldResume, true);
  assertEquals(matching.cleanLocation, "/apps/manage?app=one#form");

  const mismatched = appProfileResumeLocation(href, "did:plc:bob");
  assertEquals(mismatched.hadMarker, true);
  assertEquals(mismatched.shouldResume, false);
  assertEquals(mismatched.cleanLocation, "/apps/manage?app=one#form");
});

Deno.test("duplicate app profile return markers never authorize resume", () => {
  const href =
    "https://example.test/apps/manage?app-profile-resume=did%3Aplc%3Aalice&app-profile-resume=did%3Aplc%3Aalice&app=one";
  const resume = appProfileResumeLocation(href, "did:plc:alice");
  assertEquals(resume.hadMarker, true);
  assertEquals(resume.shouldResume, false);
  assertEquals(resume.cleanLocation, "/apps/manage?app=one");
});

Deno.test("app profile return helper rejects an external destination", () => {
  assertEquals(
    appProfileReturnToWithoutResume("https://evil.example/steal"),
    "/apps/manage",
  );
});
