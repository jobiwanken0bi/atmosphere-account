import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  assertExpectedArtifactDigest,
  assertExpectedReleaseTopology,
  normalizeExpectedArtifactDigest,
} from "./artifact-digest-expectation.ts";

const DIGEST = `web-source-v1:sha256:${"ab".repeat(32)}`;

Deno.test("artifact digest expectations require the full canonical digest", () => {
  assertEquals(normalizeExpectedArtifactDigest(DIGEST, "digest"), DIGEST);
  assertEquals(
    normalizeExpectedArtifactDigest(` ${DIGEST} `, "digest"),
    DIGEST,
  );

  for (
    const invalid of [
      "",
      "ab".repeat(32),
      `web-source-v1:sha256:${"ab".repeat(31)}`,
      `web-source-v1:sha256:${"AB".repeat(32)}`,
      `web-source-v2:sha256:${"ab".repeat(32)}`,
    ]
  ) {
    assertThrows(
      () => normalizeExpectedArtifactDigest(invalid, "digest"),
      Error,
      "canonical web-source-v1",
    );
  }
});

Deno.test("artifact digest comparison uses every digest bit", () => {
  assertExpectedArtifactDigest(DIGEST, DIGEST, "release");
  assertThrows(
    () =>
      assertExpectedArtifactDigest(
        `web-source-v1:sha256:${"ab".repeat(31)}ac`,
        DIGEST,
        "release",
      ),
    Error,
    "artifactDigest expected",
  );
});

Deno.test("release topology requires Deno shell identity and Railway AppView", () => {
  const shell = { runtime: "deno-deploy", deploymentId: "deno-build" };
  const appview = { runtime: "railway", deploymentId: "railway-deploy" };
  assertExpectedReleaseTopology(shell, appview);
  assertThrows(
    () =>
      assertExpectedReleaseTopology(
        { ...shell, runtime: "railway" },
        appview,
      ),
    Error,
    "public shell runtime",
  );
  assertThrows(
    () =>
      assertExpectedReleaseTopology(
        { ...shell, deploymentId: null },
        appview,
      ),
    Error,
    "Deno build ID",
  );
  assertThrows(
    () =>
      assertExpectedReleaseTopology(shell, {
        ...appview,
        runtime: "deno-deploy",
      }),
    Error,
    "AppView runtime",
  );
});
