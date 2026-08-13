import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  diffTreeArgsForCommit,
  fileMatchesRailwayWatchPattern,
  latestWebArtifactCommitFromHistory,
  webArtifactChanged,
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

Deno.test("production verification expects the latest web artifact", async () => {
  const workflow = await Deno.readTextFile(
    ".github/workflows/production-smoke.yml",
  );
  assertStringIncludes(
    workflow,
    'expected="$(deno task release:web-changed -- --sha="$SOURCE_RELEASE_SHA")"',
  );
  assertStringIncludes(workflow, "fetch-depth: 0");
  assertStringIncludes(
    workflow,
    "SMOKE_EXPECT_RELEASE_SHA: ${{ steps.release_scope.outputs.expected_release_sha }}",
  );
  assertStringIncludes(
    workflow,
    "SMOKE_EXPECT_RELEASE_SHA: ${{ needs.readiness.outputs.expected_release_sha }}",
  );
});
