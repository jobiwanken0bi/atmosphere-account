import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  diffTreeArgsForCommit,
  fileMatchesRailwayWatchPattern,
  firstParentHistoryArgs,
  latestWebArtifactCommitFromHistory,
  selectAllowedAppviewCommit,
  webArtifactChanged,
  webArtifactReleaseScopeFromHistory,
} from "./release-web-scope.ts";

Deno.test("web release scope follows Railway's exact rebuild patterns", () => {
  const patterns = [
    "/client.ts",
    "/components/**",
    "/lib/**",
    "/railway.web.json",
  ];
  assertEquals(fileMatchesRailwayWatchPattern("client.ts", patterns[0]), true);
  assertEquals(
    fileMatchesRailwayWatchPattern("components/Nav.tsx", patterns[1]),
    true,
  );
  assertEquals(fileMatchesRailwayWatchPattern("components", patterns[1]), true);
  assertEquals(
    fileMatchesRailwayWatchPattern("worker/indexer.ts", patterns[1]),
    false,
  );
  assertEquals(
    webArtifactChanged(["worker/indexer.ts"], patterns),
    false,
  );
  assertEquals(
    webArtifactChanged(["worker/indexer.ts", "lib/db.ts"], patterns),
    true,
  );
});

Deno.test("web artifact merge diffs compare against the first parent", () => {
  assertEquals(firstParentHistoryArgs("source-sha"), [
    "rev-list",
    "--first-parent",
    "source-sha",
  ]);
  assertEquals(diffTreeArgsForCommit("merge-sha"), [
    "diff-tree",
    "--root",
    "-m",
    "--first-parent",
    "--no-commit-id",
    "--name-only",
    "-r",
    "merge-sha",
  ]);
});

Deno.test("AppView release scope includes only web-equivalent first-parent descendants", () => {
  const patterns = ["/routes/**", "/lib/**"];
  const scope = webArtifactReleaseScopeFromHistory([
    { sha: "worker-c", files: ["worker/indexer.ts"] },
    { sha: "worker-b", files: ["scripts/index-relay-pds-inventory.ts"] },
    { sha: "web-a", files: ["routes/apps.tsx"] },
    { sha: "pre-window", files: ["worker/old.ts"] },
    { sha: "older-web", files: ["lib/db.ts"] },
  ], patterns);

  assertEquals(scope, {
    sourceSha: "worker-c",
    webArtifactSha: "web-a",
    allowedAppviewShas: ["web-a", "worker-b", "worker-c"],
  });
  if (!scope) throw new Error("expected a release scope");
  assertEquals(selectAllowedAppviewCommit(scope, "worker-b"), "worker-b");
  assertThrows(
    () => selectAllowedAppviewCommit(scope, "pre-window"),
    Error,
    "is not in the inclusive first-parent release window",
  );
  assertThrows(
    () => selectAllowedAppviewCommit(scope, "side-branch"),
    Error,
    "is not in the inclusive first-parent release window",
  );
});

Deno.test("a web-changing source commit permits only itself", () => {
  assertEquals(
    webArtifactReleaseScopeFromHistory([
      { sha: "web-source", files: ["routes/apps.tsx"] },
      { sha: "older-worker", files: ["worker/indexer.ts"] },
    ], ["/routes/**"]),
    {
      sourceSha: "web-source",
      webArtifactSha: "web-source",
      allowedAppviewShas: ["web-source"],
    },
  );
});

Deno.test("latest web artifact survives a later worker-only commit", () => {
  const patterns = ["/routes/**", "/lib/**"];
  assertEquals(
    latestWebArtifactCommitFromHistory([
      { sha: "worker-b", files: ["worker/indexer.ts"] },
      { sha: "web-a", files: ["routes/apps.tsx"] },
      { sha: "older-web", files: ["lib/db.ts"] },
    ], patterns),
    "web-a",
  );
});

Deno.test("production verification accepts only the AppView release window", async () => {
  const workflow = await Deno.readTextFile(
    ".github/workflows/production-smoke.yml",
  );
  assertStringIncludes(
    workflow,
    "--allowed-appview-shas",
  );
  assertStringIncludes(workflow, "fetch-depth: 0");
  assertStringIncludes(
    workflow,
    'artifact_digest="$(deno task release:web-digest)"',
  );
  assertStringIncludes(
    workflow,
    "SMOKE_ALLOWED_APPVIEW_SHAS: ${{ needs.readiness.outputs.allowed_appview_shas }}",
  );
  assertStringIncludes(
    workflow,
    "SMOKE_ALLOWED_APPVIEW_SHAS: ${{ steps.release_scope.outputs.allowed_appview_shas }}",
  );
  assertStringIncludes(
    workflow,
    "SMOKE_EXPECT_ARTIFACT_DIGEST: ${{ steps.release_scope.outputs.artifact_digest }}",
  );
  assertEquals(workflow.includes("EXPLICIT_APPVIEW_SHA"), false);
  assertEquals(workflow.includes("SMOKE_EXPECT_SHELL_SHA"), false);
});
