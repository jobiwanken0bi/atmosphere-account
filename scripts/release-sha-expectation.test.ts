import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  assertAllowedReleaseSha,
  assertExclusiveReleaseExpectation,
  normalizeAllowedReleaseShas,
  normalizeExpectedReleaseSha,
} from "./release-sha-expectation.ts";

const FULL_SHA = "abcdef1234567890abcdef1234567890abcdef12";

Deno.test("release expectations accept only full Git SHAs", () => {
  assertEquals(
    normalizeExpectedReleaseSha(FULL_SHA.toUpperCase(), "sha"),
    FULL_SHA,
  );
  for (
    const invalid of [
      "abcdef1",
      "abcdef123456",
      "abcdef1234567",
      `${FULL_SHA}0`,
    ]
  ) {
    assertThrows(
      () => normalizeExpectedReleaseSha(invalid, "sha"),
      Error,
      "full 40-character",
    );
  }
});

Deno.test("allowed release expectations normalize and deduplicate", () => {
  assertEquals(
    normalizeAllowedReleaseShas(
      `${FULL_SHA.toUpperCase()},${FULL_SHA},0000000000000000000000000000000000000000`,
      "allowed",
    ),
    [FULL_SHA, "0000000000000000000000000000000000000000"],
  );
  assertThrows(
    () => normalizeAllowedReleaseShas(`${FULL_SHA},`, "allowed"),
    Error,
    "empty SHA",
  );
});

Deno.test("exact and allowed AppView expectations cannot be combined", () => {
  assertThrows(
    () =>
      assertExclusiveReleaseExpectation(
        FULL_SHA,
        [FULL_SHA],
        "exact",
        "allowed",
      ),
    Error,
    "mutually exclusive",
  );
});

Deno.test("allowed release expectations reject SHAs outside the set", () => {
  assertAllowedReleaseSha(
    FULL_SHA,
    [FULL_SHA, "0000000000000000000000000000000000000000"],
    "appview",
  );
  assertThrows(
    () =>
      assertAllowedReleaseSha(
        "1111111111111111111111111111111111111111",
        [FULL_SHA, "0000000000000000000000000000000000000000"],
        "appview",
      ),
    Error,
    "not an allowed release",
  );
});
