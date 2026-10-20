import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { validateReadinessPayload } from "./smoke-readiness.ts";

const DIGEST = `web-source-v1:sha256:${"ab".repeat(32)}`;
const OTHER_DIGEST = `web-source-v1:sha256:${"cd".repeat(32)}`;
const APPVIEW_SHA = "b".repeat(40);
const OTHER_SHA = "c".repeat(40);

function payload(
  shellSha: string | null = null,
  appviewSha = APPVIEW_SHA,
  shellDigest = DIGEST,
  appviewDigest = shellDigest,
) {
  return {
    ok: true,
    degraded: false,
    database: { ok: true, latencyMs: 2, backend: "postgres" },
    indexer: { present: true, fresh: true },
    release: {
      runtime: "deno-deploy",
      deploymentId: "deno-build",
      gitSha: shellSha,
      artifactDigest: shellDigest,
    },
    appview: {
      ok: true,
      release: {
        runtime: "railway",
        gitSha: appviewSha,
        artifactDigest: appviewDigest,
      },
    },
    pdsInventory: {
      present: true,
      fresh: true,
      completedAt: "2026-08-12T00:00:00.000Z",
    },
  };
}

Deno.test("cheap readiness proves one exact artifact across Deno and Railway", () => {
  const result = validateReadinessPayload(
    payload(),
    DIGEST,
    APPVIEW_SHA,
  );
  assertEquals(result.shell.gitSha, null);
  assertEquals(result.shell.artifactDigest, DIGEST);
  assertEquals(result.appview.gitSha, APPVIEW_SHA);
  assertEquals(result.appview.artifactDigest, DIGEST);
});

Deno.test("readiness accepts only explicitly allowed full AppView Git SHAs", () => {
  const result = validateReadinessPayload(
    payload(),
    DIGEST,
    null,
    [OTHER_SHA, APPVIEW_SHA],
  );
  assertEquals(result.appview.gitSha, APPVIEW_SHA);

  assertThrows(
    () =>
      validateReadinessPayload(
        payload(null, "d".repeat(40)),
        DIGEST,
        null,
        [OTHER_SHA, APPVIEW_SHA],
      ),
    Error,
    "not an allowed release",
  );
});

Deno.test("readiness rejects ambiguous or absent AppView Git expectations", () => {
  assertThrows(
    () => validateReadinessPayload(payload(), DIGEST),
    Error,
    "expected or allowed AppView Git SHA is required",
  );
  assertThrows(
    () =>
      validateReadinessPayload(
        payload(),
        DIGEST,
        APPVIEW_SHA,
        [APPVIEW_SHA],
      ),
    Error,
    "mutually exclusive",
  );
});

Deno.test("cheap readiness rejects missing or mismatched artifact digests", () => {
  assertThrows(
    () =>
      validateReadinessPayload(
        payload(null, APPVIEW_SHA, DIGEST, OTHER_DIGEST),
        DIGEST,
        APPVIEW_SHA,
      ),
    Error,
    "artifactDigest expected",
  );

  const missing = payload();
  delete (missing.appview.release as { artifactDigest?: string })
    .artifactDigest;
  assertThrows(
    () => validateReadinessPayload(missing, DIGEST, APPVIEW_SHA),
    Error,
    "artifactDigest must be canonical and complete",
  );
  assertThrows(
    () => validateReadinessPayload(payload(), OTHER_DIGEST, APPVIEW_SHA),
    Error,
    "artifactDigest expected",
  );
});

Deno.test("cheap readiness rejects malformed or mismatched Railway Git provenance", () => {
  assertThrows(
    () =>
      validateReadinessPayload(
        payload(null, "abcdef123456"),
        DIGEST,
        APPVIEW_SHA,
      ),
    Error,
    "full Git SHA",
  );
  assertThrows(
    () => validateReadinessPayload(payload(), DIGEST, OTHER_SHA),
    Error,
    "expected appview",
  );
});

Deno.test("cheap readiness requires the intended Deno and Railway topology", () => {
  const swappedShell = payload();
  swappedShell.release.runtime = "railway";
  assertThrows(
    () => validateReadinessPayload(swappedShell, DIGEST, APPVIEW_SHA),
    Error,
    "public shell runtime",
  );

  const missingBuild = payload();
  delete (missingBuild.release as { deploymentId?: string }).deploymentId;
  assertThrows(
    () => validateReadinessPayload(missingBuild, DIGEST, APPVIEW_SHA),
    Error,
    "Deno build ID",
  );

  const wrongAppview = payload();
  wrongAppview.appview.release.runtime = "deno-deploy";
  assertThrows(
    () => validateReadinessPayload(wrongAppview, DIGEST, APPVIEW_SHA),
    Error,
    "AppView runtime",
  );
});

Deno.test("cheap readiness rejects stale inventory", () => {
  const stale = payload();
  stale.pdsInventory.fresh = false;
  assertThrows(
    () => validateReadinessPayload(stale, DIGEST, APPVIEW_SHA),
    Error,
    "must be present and fresh",
  );
});

Deno.test("cheap readiness rejects unhealthy DB or indexer lease", () => {
  const unhealthyDb = payload();
  unhealthyDb.database.ok = false;
  assertThrows(
    () => validateReadinessPayload(unhealthyDb, DIGEST, APPVIEW_SHA),
    Error,
    "database.ok must be true",
  );

  for (const key of ["present", "fresh"] as const) {
    const unhealthyIndexer = payload();
    unhealthyIndexer.indexer[key] = false;
    assertThrows(
      () => validateReadinessPayload(unhealthyIndexer, DIGEST, APPVIEW_SHA),
      Error,
      "indexer lease must be present and fresh",
    );
  }
});

Deno.test("cheap readiness rejects any reported degradation", () => {
  const degraded = payload();
  degraded.degraded = true;
  assertThrows(
    () => validateReadinessPayload(degraded, DIGEST, APPVIEW_SHA),
    Error,
    "readiness.degraded must be false",
  );
});

function directRailwayPayload() {
  const body = payload();
  body.release = {
    ...body.release,
    runtime: "railway",
    deploymentId: "railway-deploy",
    gitSha: APPVIEW_SHA,
  };
  const { appview: _appview, ...direct } = body;
  return direct;
}

Deno.test("direct Railway readiness verifies the same release and dependency freshness", () => {
  const body = directRailwayPayload();
  const result = validateReadinessPayload(
    body,
    DIGEST,
    APPVIEW_SHA,
    [],
    "railway",
  );
  assertEquals(result.shell, result.appview);
  assertEquals(result.appview.gitSha, APPVIEW_SHA);
  assertThrows(
    () => validateReadinessPayload(body, DIGEST, OTHER_SHA, [], "railway"),
    Error,
    "expected appview",
  );
  assertThrows(
    () =>
      validateReadinessPayload(body, OTHER_DIGEST, APPVIEW_SHA, [], "railway"),
    Error,
    "artifactDigest expected",
  );
  assertThrows(
    () =>
      validateReadinessPayload(payload(), DIGEST, APPVIEW_SHA, [], "railway"),
    Error,
    "local readiness",
  );
  assertThrows(
    () => validateReadinessPayload(body, DIGEST, APPVIEW_SHA),
    Error,
    "must be an object",
  );
  body.indexer.fresh = false;
  assertThrows(
    () => validateReadinessPayload(body, DIGEST, APPVIEW_SHA, [], "railway"),
    Error,
    "indexer lease must be present and fresh",
  );
  body.indexer.fresh = true;
  body.pdsInventory.fresh = false;
  assertThrows(
    () => validateReadinessPayload(body, DIGEST, APPVIEW_SHA, [], "railway"),
    Error,
    "PDS inventory must be present and fresh",
  );
});
