import { runtimeReleaseFromEnvForTest } from "./release.ts";

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
  const release = runtimeReleaseFromEnvForTest(env({
    DENO_DEPLOYMENT_ID: "deno-deploy-123",
    ATMOSPHERE_RELEASE_SHA: "320d300bb7cf5c15f00000000000000000000000",
    ATMOSPHERE_RELEASE_BRANCH: "main",
  }));

  assertEquals(release.runtime, "deno-deploy");
  assertEquals(release.deploymentId, "deno-deploy-123");
  assertEquals(release.gitSha, "320d300bb7cf");
  assertEquals(release.gitBranch, "main");
});

Deno.test("runtimeRelease identifies Railway appview releases", () => {
  const release = runtimeReleaseFromEnvForTest(env({
    RAILWAY_PROJECT_ID: "project",
    RAILWAY_DEPLOYMENT_ID: "deployment",
    RAILWAY_SERVICE_NAME: "web",
    RAILWAY_GIT_COMMIT_SHA: "abcdef1234567890",
    RAILWAY_GIT_BRANCH: "main",
  }));

  assertEquals(release.runtime, "railway");
  assertEquals(release.deploymentId, "deployment");
  assertEquals(release.service, "web");
  assertEquals(release.gitSha, "abcdef123456");
  assertEquals(release.gitBranch, "main");
});

Deno.test("runtimeRelease prefers source-provider provenance over stale manual stamps", () => {
  const release = runtimeReleaseFromEnvForTest(env({
    RAILWAY_PROJECT_ID: "project",
    RAILWAY_GIT_COMMIT_SHA: "abcdef1234567890",
    RAILWAY_GIT_BRANCH: "main",
    ATMOSPHERE_RELEASE_SHA: "0000000000000000",
    ATMOSPHERE_RELEASE_BRANCH: "old-branch",
  }));

  assertEquals(release.gitSha, "abcdef123456");
  assertEquals(release.gitBranch, "main");
});

Deno.test("runtimeRelease falls back to local without hosted env", () => {
  const release = runtimeReleaseFromEnvForTest(env({}));

  assertEquals(release.runtime, "local");
  assertEquals(release.deploymentId, null);
  assertEquals(release.gitSha, null);
});
