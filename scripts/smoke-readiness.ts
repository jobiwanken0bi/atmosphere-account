import {
  ARTIFACT_DIGEST_PATTERN,
  assertExpectedArtifactDigest,
  assertExpectedReleaseTopology,
  normalizeExpectedArtifactDigest,
} from "./artifact-digest-expectation.ts";
import {
  assertAllowedReleaseSha,
  assertExclusiveReleaseExpectation,
  normalizeAllowedReleaseShas,
  normalizeExpectedReleaseSha,
} from "./release-sha-expectation.ts";

interface ReleaseShape {
  runtime: string;
  deploymentId: string | null;
  gitSha: string | null;
  artifactDigest: string;
}

export interface ReadinessSummary {
  shell: ReleaseShape;
  appview: ReleaseShape;
  inventoryCompletedAt: string;
}

const DEFAULT_SITE_ORIGIN = "https://atmosphereaccount.com";

function readFlag(args: string[], flag: string): string | null {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function release(value: unknown, label: string): ReleaseShape {
  const parsed = object(value, label);
  const runtime = parsed.runtime;
  const deploymentId = parsed.deploymentId;
  const gitSha = parsed.gitSha;
  const artifactDigest = parsed.artifactDigest;
  if (typeof runtime !== "string" || !runtime) {
    throw new Error(`${label}.runtime must be present`);
  }
  if (
    deploymentId !== null && deploymentId !== undefined &&
    (typeof deploymentId !== "string" || !deploymentId)
  ) {
    throw new Error(`${label}.deploymentId must be null or non-empty`);
  }
  if (
    gitSha !== null && gitSha !== undefined &&
    (typeof gitSha !== "string" || !/^[0-9a-f]{40}$/.test(gitSha))
  ) {
    throw new Error(`${label}.gitSha must be null or a full Git SHA`);
  }
  if (
    typeof artifactDigest !== "string" ||
    !ARTIFACT_DIGEST_PATTERN.test(artifactDigest)
  ) {
    throw new Error(`${label}.artifactDigest must be canonical and complete`);
  }
  return {
    runtime,
    deploymentId: deploymentId ?? null,
    gitSha: gitSha ?? null,
    artifactDigest,
  };
}

export function validateReadinessPayload(
  value: unknown,
  expectedArtifactDigest: string,
  expectedAppviewSha: string | null = null,
  allowedAppviewShas: readonly string[] = [],
): ReadinessSummary {
  const expectedDigest = normalizeExpectedArtifactDigest(
    expectedArtifactDigest,
    "expected artifact digest",
  );
  assertExclusiveReleaseExpectation(
    expectedAppviewSha,
    allowedAppviewShas,
    "expected AppView SHA",
    "allowed AppView SHAs",
  );
  if (expectedAppviewSha === null && allowedAppviewShas.length === 0) {
    throw new Error("an expected or allowed AppView Git SHA is required");
  }
  const body = object(value, "readiness");
  if (body.ok !== true) throw new Error("readiness.ok must be true");
  if (body.degraded !== false) {
    throw new Error("readiness.degraded must be false");
  }
  const database = object(body.database, "readiness.database");
  if (database.ok !== true) {
    throw new Error("readiness.database.ok must be true");
  }
  const indexer = object(body.indexer, "readiness.indexer");
  if (indexer.present !== true || indexer.fresh !== true) {
    throw new Error("indexer lease must be present and fresh");
  }
  const shell = release(body.release, "readiness.release");
  const appviewBody = object(body.appview, "readiness.appview");
  if (appviewBody.ok !== true) {
    throw new Error("readiness.appview.ok must be true");
  }
  const appview = release(appviewBody.release, "readiness.appview.release");
  assertExpectedReleaseTopology(shell, appview);
  assertExpectedArtifactDigest(
    shell.artifactDigest,
    expectedDigest,
    "readiness.release",
  );
  assertExpectedArtifactDigest(
    appview.artifactDigest,
    expectedDigest,
    "readiness.appview.release",
  );
  if (expectedAppviewSha && appview.gitSha !== expectedAppviewSha) {
    throw new Error(
      `release mismatch: expected appview=${expectedAppviewSha} deployed=${appview.gitSha}`,
    );
  }
  assertAllowedReleaseSha(
    appview.gitSha,
    allowedAppviewShas,
    "readiness.appview.release",
  );
  const inventory = object(body.pdsInventory, "readiness.pdsInventory");
  if (inventory.present !== true || inventory.fresh !== true) {
    throw new Error("PDS inventory must be present and fresh");
  }
  if (typeof inventory.completedAt !== "string" || !inventory.completedAt) {
    throw new Error("PDS inventory completion time must be present");
  }
  return {
    shell,
    appview,
    inventoryCompletedAt: inventory.completedAt,
  };
}

export async function main(): Promise<void> {
  const args = Deno.args.filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: deno task smoke:readiness [--site-origin=URL] --expected-artifact-digest=DIGEST [--expected-appview-sha=FULL_SHA | --allowed-appview-shas=FULL_SHA,...]",
    );
    return;
  }
  const origin = new URL(
    readFlag(args, "--site-origin") ??
      Deno.env.get("SMOKE_SITE_ORIGIN") ??
      DEFAULT_SITE_ORIGIN,
  );
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("site origin must not include a path, query, or hash");
  }
  const expectedArtifactDigest = normalizeExpectedArtifactDigest(
    readFlag(args, "--expected-artifact-digest") ??
      Deno.env.get("SMOKE_EXPECT_ARTIFACT_DIGEST") ??
      null,
    "--expected-artifact-digest",
  );
  const allowedAppviewShas = normalizeAllowedReleaseShas(
    readFlag(args, "--allowed-appview-shas") ??
      Deno.env.get("SMOKE_ALLOWED_APPVIEW_SHAS") ??
      null,
    "--allowed-appview-shas",
  );
  const explicitAppviewSha = normalizeExpectedReleaseSha(
    readFlag(args, "--expected-appview-sha") ??
      Deno.env.get("SMOKE_EXPECT_APPVIEW_SHA") ??
      null,
    "--expected-appview-sha",
  );
  assertExclusiveReleaseExpectation(
    explicitAppviewSha,
    allowedAppviewShas,
    "--expected-appview-sha",
    "--allowed-appview-shas",
  );
  if (explicitAppviewSha === null && allowedAppviewShas.length === 0) {
    throw new Error(
      "--expected-appview-sha or --allowed-appview-shas is required",
    );
  }
  const url = new URL("/api/health/ready", origin);
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "atmosphere-readiness-smoke/1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const summary = validateReadinessPayload(
    await response.json(),
    expectedArtifactDigest,
    explicitAppviewSha,
    allowedAppviewShas,
  );
  console.log(JSON.stringify({
    event: "production_readiness_ok",
    shellSha: summary.shell.gitSha,
    appviewSha: summary.appview.gitSha,
    artifactDigest: summary.shell.artifactDigest,
    inventoryCompletedAt: summary.inventoryCompletedAt,
  }));
}

if (import.meta.main) await main();
