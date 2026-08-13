import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { validateReadinessPayload } from "./smoke-readiness.ts";

function payload(shellSha = "abcdef123456", appviewSha = shellSha) {
  return {
    ok: true,
    degraded: false,
    database: { ok: true, latencyMs: 2, backend: "postgres" },
    indexer: { present: true, fresh: true },
    release: { runtime: "deno-deploy", gitSha: shellSha },
    appview: {
      ok: true,
      release: { runtime: "railway", gitSha: appviewSha },
    },
    pdsInventory: {
      present: true,
      fresh: true,
      completedAt: "2026-08-12T00:00:00.000Z",
    },
  };
}

Deno.test("cheap readiness proves exact Deno and Railway SHA parity", () => {
  const result = validateReadinessPayload(payload(), "abcdef123456");
  assertEquals(result.shell.gitSha, "abcdef123456");
  assertEquals(result.appview.gitSha, "abcdef123456");
});

Deno.test("cheap readiness rejects missing or mismatched release metadata", () => {
  assertThrows(
    () =>
      validateReadinessPayload(payload("abcdef123456", "000000000000"), null),
    Error,
    "release mismatch",
  );
  const missing = payload();
  delete (missing.appview.release as { gitSha?: string }).gitSha;
  assertThrows(
    () => validateReadinessPayload(missing, null),
    Error,
    "gitSha must be present",
  );
  assertThrows(
    () => validateReadinessPayload(payload(), "000000000000"),
    Error,
    "expected=000000000000",
  );
});

Deno.test("cheap readiness rejects stale inventory", () => {
  const stale = payload();
  stale.pdsInventory.fresh = false;
  assertThrows(
    () => validateReadinessPayload(stale, null),
    Error,
    "must be present and fresh",
  );
});

Deno.test("cheap readiness rejects unhealthy DB or indexer lease", () => {
  const unhealthyDb = payload();
  unhealthyDb.database.ok = false;
  assertThrows(
    () => validateReadinessPayload(unhealthyDb, null),
    Error,
    "database.ok must be true",
  );

  for (const key of ["present", "fresh"] as const) {
    const unhealthyIndexer = payload();
    unhealthyIndexer.indexer[key] = false;
    assertThrows(
      () => validateReadinessPayload(unhealthyIndexer, null),
      Error,
      "indexer lease must be present and fresh",
    );
  }
});

Deno.test("cheap readiness rejects any reported degradation", () => {
  const degraded = payload();
  degraded.degraded = true;
  assertThrows(
    () => validateReadinessPayload(degraded, null),
    Error,
    "readiness.degraded must be false",
  );
});
