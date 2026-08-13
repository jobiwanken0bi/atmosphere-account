import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  fileMatchesRailwayWatchPattern,
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

Deno.test("production verification expects HEAD only for web artifacts", async () => {
  const workflow = await Deno.readTextFile(
    ".github/workflows/production-smoke.yml",
  );
  assertStringIncludes(
    workflow,
    'deno task release:web-changed -- --sha="$SOURCE_RELEASE_SHA"',
  );
  assertStringIncludes(
    workflow,
    "SMOKE_EXPECT_RELEASE_SHA: ${{ steps.release_scope.outputs.expected_release_sha }}",
  );
  assertStringIncludes(
    workflow,
    "SMOKE_EXPECT_RELEASE_SHA: ${{ needs.readiness.outputs.expected_release_sha }}",
  );
});
