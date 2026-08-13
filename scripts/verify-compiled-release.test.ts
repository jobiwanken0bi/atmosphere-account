import { assertThrows } from "jsr:@std/assert@1";
import { verifyCompiledReleasePayload } from "./verify-compiled-release.ts";

const DIGEST = `web-source-v1:sha256:${"ab".repeat(32)}`;

Deno.test("compiled release verification requires the exact embedded artifact digest", () => {
  verifyCompiledReleasePayload({
    release: {
      runtime: "deno-deploy",
      deploymentId: "compiled-release-verification",
      gitSha: null,
      artifactDigest: DIGEST,
    },
  }, DIGEST);

  assertThrows(
    () =>
      verifyCompiledReleasePayload({
        release: {
          runtime: "deno-deploy",
          deploymentId: "compiled-release-verification",
          gitSha: null,
          artifactDigest: `web-source-v1:sha256:${"ab".repeat(31)}ac`,
        },
      }, DIGEST),
    Error,
    "compiled server artifact digest expected",
  );
});

Deno.test("compiled release verification permits only null or full optional Git provenance", () => {
  for (
    const gitSha of [
      null,
      "abcdef1234567890abcdef1234567890abcdef12",
    ]
  ) {
    verifyCompiledReleasePayload({
      release: {
        runtime: "deno-deploy",
        deploymentId: "compiled-release-verification",
        gitSha,
        artifactDigest: DIGEST,
      },
    }, DIGEST);
  }
  assertThrows(
    () =>
      verifyCompiledReleasePayload({
        release: {
          runtime: "deno-deploy",
          deploymentId: "compiled-release-verification",
          gitSha: "abcdef123456",
          artifactDigest: DIGEST,
        },
      }, DIGEST),
    Error,
    "invalid Git SHA",
  );
});

Deno.test("compiled release verification requires the native Deno build ID", () => {
  assertThrows(
    () =>
      verifyCompiledReleasePayload({
        release: {
          runtime: "deno-deploy",
          deploymentId: "mutable-release-id",
          gitSha: null,
          artifactDigest: DIGEST,
        },
      }, DIGEST),
    Error,
    "immutable Deno build ID",
  );
});
