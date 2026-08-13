interface ReleaseShape {
  runtime: string;
  gitSha: string;
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

function normalizeSha(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (!/^[0-9a-f]{7,40}$/.test(normalized)) {
    throw new Error("expected release SHA must be a 7-40 character git SHA");
  }
  return normalized.slice(0, 12);
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
  const gitSha = parsed.gitSha;
  if (typeof runtime !== "string" || !runtime) {
    throw new Error(`${label}.runtime must be present`);
  }
  if (typeof gitSha !== "string" || !/^[0-9a-f]{7,12}$/i.test(gitSha)) {
    throw new Error(`${label}.gitSha must be present and valid`);
  }
  return { runtime, gitSha: gitSha.toLowerCase() };
}

export function validateReadinessPayload(
  value: unknown,
  expectedSha: string | null,
): ReadinessSummary {
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
  if (shell.gitSha !== appview.gitSha) {
    throw new Error(
      `release mismatch: shell=${shell.gitSha} appview=${appview.gitSha}`,
    );
  }
  if (expectedSha && shell.gitSha !== expectedSha) {
    throw new Error(
      `release mismatch: expected=${expectedSha} deployed=${shell.gitSha}`,
    );
  }
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
      "Usage: deno task smoke:readiness [--site-origin=URL] [--expected-release-sha=SHA]",
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
  const expectedSha = normalizeSha(
    readFlag(args, "--expected-release-sha") ??
      Deno.env.get("SMOKE_EXPECT_RELEASE_SHA") ??
      null,
  );
  const url = new URL("/api/health/ready", origin);
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "atmosphere-readiness-smoke/1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const summary = validateReadinessPayload(await response.json(), expectedSha);
  console.log(JSON.stringify({
    event: "production_readiness_ok",
    shellSha: summary.shell.gitSha,
    appviewSha: summary.appview.gitSha,
    inventoryCompletedAt: summary.inventoryCompletedAt,
  }));
}

if (import.meta.main) await main();
