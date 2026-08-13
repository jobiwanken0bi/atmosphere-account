import { runtimeReleaseFromEnvForTest } from "./release.ts";

const ARTIFACT_DIGEST = `web-source-v1:sha256:${"a".repeat(64)}`;

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function env(
  values: Record<string, string>,
): (key: string) => string | undefined {
  return (key) => values[key];
}

Deno.test("runtimeRelease identifies Deno Deploy releases", () => {
  const release = runtimeReleaseFromEnvForTest(
    env({
      DENO_DEPLOYMENT_ID: "deno-deploy-123",
      DENO_DEPLOY_BUILD_ID: "deno-build-456",
      ATMOSPHERE_RELEASE_ID: "mutable-release-id",
    }),
    {
      gitSha: "320d300bb7cf5c15f00000000000000000000000",
      gitBranch: "main",
      artifactDigest: ARTIFACT_DIGEST,
    },
  );

  assertEquals(release.runtime, "deno-deploy");
  assertEquals(release.deploymentId, "deno-build-456");
  assertEquals(
    release.gitSha,
    "320d300bb7cf5c15f00000000000000000000000",
  );
  assertEquals(release.gitBranch, "main");
  assertEquals(release.artifactDigest, ARTIFACT_DIGEST);
});

Deno.test("runtimeRelease rejects mutable Deno stamps when artifact provenance is absent", () => {
  const release = runtimeReleaseFromEnvForTest(env({
    DENO_DEPLOYMENT_ID: "deno-deploy-123",
    DENO_GIT_COMMIT_SHA: "0000000000000000",
    DENO_GIT_BRANCH: "old-branch",
    ATMOSPHERE_RELEASE_SHA: "320d300bb7cf5c15f00000000000000000000000",
    ATMOSPHERE_RELEASE_BRANCH: "main",
  }));

  assertEquals(release.gitSha, null);
  assertEquals(release.gitBranch, null);
});

Deno.test("runtimeRelease identifies the immutable Deno artifact over a stale mutable stamp", () => {
  const release = runtimeReleaseFromEnvForTest(
    env({
      DENO_DEPLOYMENT_ID: "deno-deploy-new",
      ATMOSPHERE_RELEASE_SHA: "0000000000000000",
      ATMOSPHERE_RELEASE_BRANCH: "old-branch",
    }),
    {
      gitSha: "abcdef1234567890abcdef1234567890abcdef12",
      gitBranch: "main",
      artifactDigest: ARTIFACT_DIGEST,
    },
  );

  assertEquals(
    release.gitSha,
    "abcdef1234567890abcdef1234567890abcdef12",
  );
  assertEquals(release.gitBranch, "main");
});

Deno.test("runtimeRelease recognizes every supported Deno runtime marker", () => {
  const markers: Record<string, string>[] = [
    { DENO_DEPLOY: "1" },
    { DENO_DEPLOY: "true" },
    { DENO_DEPLOY_BUILD_ID: "deno-build" },
  ];
  for (const marker of markers) {
    const release = runtimeReleaseFromEnvForTest(env(marker), {
      gitSha: "abcdef1234567890abcdef1234567890abcdef12",
      gitBranch: null,
      artifactDigest: ARTIFACT_DIGEST,
    });
    assertEquals(release.runtime, "deno-deploy");
    assertEquals(
      release.gitSha,
      "abcdef1234567890abcdef1234567890abcdef12",
    );
  }
});

Deno.test("Railway keeps native revision provenance ahead of an embedded artifact", () => {
  const release = runtimeReleaseFromEnvForTest(
    env({
      RAILWAY_PROJECT_ID: "project",
      RAILWAY_GIT_COMMIT_SHA: "abcdef1234567890abcdef1234567890abcdef12",
      RAILWAY_GIT_BRANCH: "main",
    }),
    {
      gitSha: "0000000000000000",
      gitBranch: "embedded-branch",
      artifactDigest: ARTIFACT_DIGEST,
    },
  );

  assertEquals(
    release.gitSha,
    "abcdef1234567890abcdef1234567890abcdef12",
  );
  assertEquals(release.gitBranch, "main");
  assertEquals(release.artifactDigest, ARTIFACT_DIGEST);
});

Deno.test("runtimeRelease rejects malformed embedded artifact digests", () => {
  const release = runtimeReleaseFromEnvForTest(env({ DENO_DEPLOY: "1" }), {
    gitSha: null,
    gitBranch: null,
    artifactDigest: "sha256:not-authoritative",
  });
  assertEquals(release.artifactDigest, null);
});

Deno.test("runtimeRelease rejects non-canonical embedded artifact digests", () => {
  const release = runtimeReleaseFromEnvForTest(env({ DENO_DEPLOY: "1" }), {
    gitSha: null,
    gitBranch: null,
    artifactDigest: ARTIFACT_DIGEST.toUpperCase(),
  });
  assertEquals(release.artifactDigest, null);
});

Deno.test("runtimeRelease identifies Railway appview releases", () => {
  const release = runtimeReleaseFromEnvForTest(env({
    RAILWAY_PROJECT_ID: "project",
    RAILWAY_DEPLOYMENT_ID: "deployment",
    RAILWAY_SERVICE_NAME: "web",
    RAILWAY_GIT_COMMIT_SHA: "abcdef1234567890abcdef1234567890abcdef12",
    RAILWAY_GIT_BRANCH: "main",
  }));

  assertEquals(release.runtime, "railway");
  assertEquals(release.deploymentId, "deployment");
  assertEquals(release.service, "web");
  assertEquals(
    release.gitSha,
    "abcdef1234567890abcdef1234567890abcdef12",
  );
  assertEquals(release.gitBranch, "main");
});

Deno.test("runtimeRelease prefers source-provider provenance over stale manual stamps", () => {
  const release = runtimeReleaseFromEnvForTest(env({
    RAILWAY_PROJECT_ID: "project",
    RAILWAY_GIT_COMMIT_SHA: "abcdef1234567890abcdef1234567890abcdef12",
    RAILWAY_GIT_BRANCH: "main",
    ATMOSPHERE_RELEASE_SHA: "0000000000000000",
    ATMOSPHERE_RELEASE_BRANCH: "old-branch",
  }));

  assertEquals(
    release.gitSha,
    "abcdef1234567890abcdef1234567890abcdef12",
  );
  assertEquals(release.gitBranch, "main");
});

Deno.test("Railway fails closed without native Git provenance", () => {
  const release = runtimeReleaseFromEnvForTest(env({
    RAILWAY_PROJECT_ID: "project",
    GITHUB_SHA: "abcdef1234567890abcdef1234567890abcdef12",
    GITHUB_REF_NAME: "main",
    ATMOSPHERE_RELEASE_ID: "mutable-deployment",
    ATMOSPHERE_RELEASE_SHA: "abcdef1234567890abcdef1234567890abcdef12",
    ATMOSPHERE_RELEASE_BRANCH: "main",
  }));

  assertEquals(release.runtime, "railway");
  assertEquals(release.deploymentId, null);
  assertEquals(release.gitSha, null);
  assertEquals(release.gitBranch, null);
});

Deno.test("Railway rejects shortened or malformed native Git provenance", () => {
  for (const gitSha of ["abcdef123456", "not-a-commit"]) {
    const release = runtimeReleaseFromEnvForTest(env({
      RAILWAY_PROJECT_ID: "project",
      RAILWAY_GIT_COMMIT_SHA: gitSha,
    }));
    assertEquals(release.gitSha, null);
  }
});

Deno.test("runtimeRelease falls back to local without hosted env", () => {
  const release = runtimeReleaseFromEnvForTest(env({}));

  assertEquals(release.runtime, "local");
  assertEquals(release.deploymentId, null);
  assertEquals(release.gitSha, null);
});
