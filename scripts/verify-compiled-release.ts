import { ARTIFACT_DIGEST_PATTERN } from "./artifact-digest-expectation.ts";
import { webSourceDigest } from "../lib/web-source-digest.ts";

interface CompiledReleasePayload {
  release?: {
    runtime?: unknown;
    deploymentId?: unknown;
    gitSha?: unknown;
    artifactDigest?: unknown;
  };
}

const VERIFY_BUILD_ID = "compiled-release-verification";

export function verifyCompiledReleasePayload(
  value: CompiledReleasePayload,
  expectedArtifactDigest: string,
): void {
  if (!ARTIFACT_DIGEST_PATTERN.test(expectedArtifactDigest)) {
    throw new Error("expected artifact digest must be canonical and complete");
  }
  const release = value.release;
  if (release?.runtime !== "deno-deploy") {
    throw new Error("compiled server did not identify the Deno Deploy runtime");
  }
  if (release.deploymentId !== VERIFY_BUILD_ID) {
    throw new Error(
      "compiled server did not prefer the immutable Deno build ID",
    );
  }
  if (release.gitSha !== null && release.gitSha !== undefined) {
    if (
      typeof release.gitSha !== "string" ||
      !/^[0-9a-f]{40}$/.test(release.gitSha)
    ) {
      throw new Error("compiled server reported an invalid Git SHA");
    }
  }
  if (release.artifactDigest !== expectedArtifactDigest) {
    throw new Error(
      `compiled server artifact digest expected ${expectedArtifactDigest}, got ${
        String(release.artifactDigest)
      }`,
    );
  }
}

async function main(): Promise<void> {
  const expectedArtifactDigest = await webSourceDigest();

  Deno.env.set("DENO_DEPLOYMENT_ID", "mutable-configuration-id");
  Deno.env.set("DENO_DEPLOY_BUILD_ID", VERIFY_BUILD_ID);
  Deno.env.set("ATMOSPHERE_RELEASE_ID", "mutable-release-id");
  Deno.env.set(
    "ATMOSPHERE_RELEASE_SHA",
    "0000000000000000000000000000000000000000",
  );

  const built = await import("../_fresh/server.js");
  const response = await built.default.fetch(
    new Request("https://atmosphereaccount.com/api/health"),
  );
  if (!response.ok) {
    throw new Error(`compiled health route returned HTTP ${response.status}`);
  }
  const body = await response.json() as CompiledReleasePayload;
  verifyCompiledReleasePayload(body, expectedArtifactDigest);
  console.log(
    `[verify-compiled-release] ok artifactDigest=${expectedArtifactDigest}`,
  );
}

if (import.meta.main) await main();
