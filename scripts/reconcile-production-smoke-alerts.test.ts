import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  formatProductionAlertMarker,
  parseProductionAlertMarker,
  parseProductionAlertTarget,
  productionAlertAction,
  type ProductionAlertTarget,
  productionAlertTargetMayAdvance,
} from "./reconcile-production-smoke-alerts.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const SHA_D = "d".repeat(40);
const DIGEST_A = `web-source-v1:sha256:${"1".repeat(64)}`;
const DIGEST_B = `web-source-v1:sha256:${"2".repeat(64)}`;

function target(
  sourceSha: string,
  ...allowedAppviewShas: string[]
): ProductionAlertTarget {
  return { sourceSha, artifactDigest: DIGEST_A, allowedAppviewShas };
}

const ORDER = new Map([
  [SHA_A, 1],
  [SHA_B, 2],
  [SHA_C, 3],
  [SHA_D, 4],
]);

function isAncestor(ancestor: string, descendant: string): boolean {
  const left = ORDER.get(ancestor);
  const right = ORDER.get(descendant);
  return left != null && right != null && left <= right;
}

Deno.test("production alert targets and markers are strict and machine-readable", () => {
  const value = target(SHA_C, SHA_B, SHA_C);
  const marker = formatProductionAlertMarker("readiness", value);
  assertMatch(
    marker,
    /^<!-- atmosphere-production-alert:\{"version":2,/,
  );
  assertEquals(
    parseProductionAlertMarker(`failure\n\n${marker}`, "readiness"),
    value,
  );
  assertEquals(
    parseProductionAlertMarker(marker, "full"),
    null,
  );
  assertEquals(
    parseProductionAlertTarget({
      sourceSha: SHA_C.slice(0, 12),
      artifactDigest: DIGEST_A,
      allowedAppviewShas: [SHA_B],
    }),
    null,
  );
  assertEquals(
    parseProductionAlertTarget({
      sourceSha: SHA_C,
      artifactDigest: DIGEST_A,
      allowedAppviewShas: [SHA_B, SHA_B],
    }),
    null,
  );
  assertEquals(
    parseProductionAlertTarget({
      sourceSha: SHA_C,
      artifactDigest: DIGEST_A,
      allowedAppviewShas: [SHA_A, SHA_B],
    }),
    null,
  );
  assertEquals(
    parseProductionAlertTarget({
      sourceSha: SHA_C,
      artifactDigest: "sha256:mutable-or-truncated",
      allowedAppviewShas: [SHA_B],
    }),
    null,
  );
  assertEquals(
    parseProductionAlertMarker(
      "<!-- atmosphere-production-alert:{bad json} -->",
      "readiness",
    ),
    null,
  );
});

Deno.test("production alert generations reject source and AppView regressions", async () => {
  const active = target(SHA_C, SHA_B, SHA_C);
  assertEquals(
    await productionAlertTargetMayAdvance(
      active,
      target(SHA_B, SHA_A, SHA_B),
      isAncestor,
    ),
    false,
  );
  assertEquals(
    await productionAlertTargetMayAdvance(
      active,
      target(SHA_D, SHA_A, SHA_B, SHA_C, SHA_D),
      isAncestor,
    ),
    false,
  );
  assertEquals(
    await productionAlertTargetMayAdvance(
      active,
      target(SHA_C, SHA_B, SHA_C),
      isAncestor,
    ),
    true,
  );
  assertEquals(
    await productionAlertTargetMayAdvance(
      active,
      target(SHA_D, SHA_C, SHA_D),
      isAncestor,
    ),
    true,
  );
});

Deno.test("production alert generations fail closed on a changed digest at the same web baseline", async () => {
  const active = target(SHA_C, SHA_B, SHA_C);
  assertEquals(
    await productionAlertTargetMayAdvance(
      active,
      {
        ...target(SHA_D, SHA_B, SHA_C, SHA_D),
        artifactDigest: DIGEST_B,
      },
      isAncestor,
    ),
    false,
  );
  assertEquals(
    await productionAlertTargetMayAdvance(
      active,
      {
        ...target(SHA_D, SHA_C, SHA_D),
        artifactDigest: DIGEST_B,
      },
      isAncestor,
    ),
    true,
  );
});

Deno.test("stale results cannot mutate, close, or reopen a newer alert generation", () => {
  for (const outcome of ["failure", "success"] as const) {
    for (const issueState of ["OPEN", "CLOSED"] as const) {
      assertEquals(
        productionAlertAction({
          outcome,
          issueState,
          hasScopedTarget: true,
          candidateMayAdvance: false,
        }),
        "ignore_stale",
      );
    }
  }
});

Deno.test("successful generations persist a closed high-water mark", () => {
  assertEquals(
    productionAlertAction({
      outcome: "success",
      issueState: null,
      hasScopedTarget: false,
      candidateMayAdvance: false,
    }),
    "seed_closed_success",
  );
  assertEquals(
    productionAlertAction({
      outcome: "success",
      issueState: "CLOSED",
      hasScopedTarget: true,
      candidateMayAdvance: true,
    }),
    "advance_closed_success",
  );
  assertEquals(
    productionAlertAction({
      outcome: "failure",
      issueState: "CLOSED",
      hasScopedTarget: true,
      candidateMayAdvance: false,
    }),
    "ignore_stale",
  );
});

Deno.test("current and newer results reconcile scoped alert state", () => {
  assertEquals(
    productionAlertAction({
      outcome: "failure",
      issueState: null,
      hasScopedTarget: false,
      candidateMayAdvance: false,
    }),
    "create_failure",
  );
  assertEquals(
    productionAlertAction({
      outcome: "failure",
      issueState: "CLOSED",
      hasScopedTarget: true,
      candidateMayAdvance: true,
    }),
    "reopen_failure",
  );
  assertEquals(
    productionAlertAction({
      outcome: "failure",
      issueState: "OPEN",
      hasScopedTarget: true,
      candidateMayAdvance: true,
    }),
    "update_failure",
  );
  assertEquals(
    productionAlertAction({
      outcome: "success",
      issueState: "OPEN",
      hasScopedTarget: true,
      candidateMayAdvance: true,
    }),
    "close_recovered",
  );
});

Deno.test("legacy unscoped alerts fail closed on success", () => {
  assertEquals(
    productionAlertAction({
      outcome: "success",
      issueState: "OPEN",
      hasScopedTarget: false,
      candidateMayAdvance: false,
    }),
    "ignore_unscoped_success",
  );
  assertEquals(
    productionAlertAction({
      outcome: "failure",
      issueState: "OPEN",
      hasScopedTarget: false,
      candidateMayAdvance: false,
    }),
    "update_failure",
  );
});

Deno.test("production workflow serializes only authoritative alert reconciliation", async () => {
  const workflow = await Deno.readTextFile(
    new URL("../.github/workflows/production-smoke.yml", import.meta.url),
  );
  assertEquals(workflow.includes("cancel-in-progress: true"), false);
  assertMatch(
    workflow,
    /alert:\n[\s\S]*?concurrency:\n\s+group: production-smoke-alert-reconciliation\n\s+queue: max\n\s+cancel-in-progress: false/,
  );
  assertMatch(
    workflow,
    /group: production-smoke-alert-reconciliation\n\s+queue: max\n\s+cancel-in-progress: false/,
  );
  assertMatch(
    workflow,
    /alert:\n[\s\S]*?permissions:\n\s+contents: read\n\s+issues: write/,
  );
  assertMatch(
    workflow,
    /alert:\n[\s\S]*?if: >-\n[\s\S]*?github\.event_name != 'workflow_dispatch'/,
  );
  assertMatch(
    workflow,
    /deno run --allow-env --allow-run=git,gh scripts\/reconcile-production-smoke-alerts\.ts/,
  );
  assertMatch(
    workflow,
    /github\.event\.workflow_run\.event == 'push'[\s\S]*?github\.event\.workflow_run\.head_repository\.full_name == github\.repository/,
  );
  assertMatch(
    workflow,
    /artifact_digest="\$\(deno task release:web-digest\)"/,
  );
  assertMatch(
    workflow,
    /if \[ -z "\$allowed_appview_shas" \]; then[\s\S]*?release:web-changed --/,
  );
  assertMatch(
    workflow,
    /SMOKE_EXPECT_ARTIFACT_DIGEST: \$\{\{ steps\.release_scope\.outputs\.artifact_digest \}\}/,
  );
  assertMatch(
    workflow,
    /SMOKE_EXPECT_ARTIFACT_DIGEST: \$\{\{ needs\.readiness\.outputs\.artifact_digest \}\}/,
  );
  assertMatch(workflow, /--source-sha="\$source_sha"/);
  assertMatch(workflow, /--artifact-digest="\$artifact_digest"/);
  assertEquals(workflow.includes("expected_shell_sha"), false);
  assertEquals(workflow.includes("expected_appview_sha"), false);
  assertEquals(workflow.includes("SMOKE_EXPECT_SHELL_SHA"), false);
  assertMatch(
    workflow,
    /ref: \$\{\{ github\.event_name == 'workflow_run' && github\.event\.workflow_run\.head_sha \|\| 'refs\/heads\/main' \}\}/,
  );
  assertMatch(
    workflow,
    /full:[\s\S]*?ref: \$\{\{ needs\.readiness\.outputs\.source_sha \}\}/,
  );
  assertMatch(
    workflow,
    /alert:[\s\S]*?ref: \$\{\{ needs\.readiness\.outputs\.source_sha \|\| github\.event\.workflow_run\.head_sha \|\| 'refs\/heads\/main' \}\}/,
  );
});

Deno.test("production alert state is isolated behind a bot-managed label", async () => {
  const source = await Deno.readTextFile(
    new URL("./reconcile-production-smoke-alerts.ts", import.meta.url),
  );
  assertMatch(source, /const MANAGED_LABEL = "automation:production-smoke"/);
  assertMatch(source, /"--label",\n\s+MANAGED_LABEL/);
  assertMatch(source, /"label",\n\s+"create",\n\s+MANAGED_LABEL/);
});
