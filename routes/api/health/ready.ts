import { define } from "../../../utils.ts";
import { appviewBaseUrl } from "../../../lib/appview-client.ts";
import { checkDbHealth } from "../../../lib/db.ts";
import { type RuntimeRelease, runtimeRelease } from "../../../lib/release.ts";
import {
  getWorkerLeaseStatus,
  type WorkerLeaseStatus,
} from "../../../lib/worker-lease.ts";
import {
  getPdsInventoryFreshness,
  type PdsInventoryFreshness,
} from "../../../lib/pds-inventory-health.ts";
import { readResponseTextWithLimit } from "../../../lib/security.ts";

const INDEXER_LEASE = "jetstream-indexer";
const READINESS_SUCCESS_CACHE_MS = 2_000;
const MAX_APPVIEW_READINESS_BYTES = 256 * 1024;

interface ReadinessResult {
  body: Record<string, unknown>;
  status: number;
}

interface DatabaseHealth {
  ok: boolean;
  [key: string]: unknown;
}

let cachedReadiness: {
  expiresAt: number;
  result: ReadinessResult;
} | null = null;

export const handler = define.handlers({
  async GET(): Promise<Response> {
    const now = Date.now();
    if (cachedReadiness && cachedReadiness.expiresAt > now) {
      return readinessJson(cachedReadiness.result, "hit");
    }

    try {
      const result = await computeReadiness();
      if (result.status >= 200 && result.status < 300) {
        cachedReadiness = {
          expiresAt: now + READINESS_SUCCESS_CACHE_MS,
          result,
        };
      }
      return readinessJson(result, "miss");
    } catch {
      return json(
        {
          ok: false,
          service: "atmosphere-account-web",
          release: runtimeRelease(),
          database: { ok: false },
          error: "readiness_check_failed",
          timestamp: new Date().toISOString(),
        },
        { status: 503 },
      );
    }
  },
});

async function computeReadiness(): Promise<ReadinessResult> {
  const appview = appviewBaseUrl();
  if (appview) return await appviewReadiness(appview);

  const [database, indexer, pdsInventory] = await Promise.all([
    checkDbHealth(),
    getWorkerLeaseStatus(INDEXER_LEASE).catch(() => null),
    getPdsInventoryFreshness().catch(() => null),
  ]);
  return localReadiness({ database, indexer, pdsInventory });
}

export function localReadinessForTest(input: {
  database: DatabaseHealth;
  indexer: WorkerLeaseStatus | null;
  pdsInventory: PdsInventoryFreshness | null;
  release?: RuntimeRelease;
}): ReadinessResult {
  return localReadiness(input);
}

function localReadiness(input: {
  database: DatabaseHealth;
  indexer: WorkerLeaseStatus | null;
  pdsInventory: PdsInventoryFreshness | null;
  release?: RuntimeRelease;
}): ReadinessResult {
  const databaseReady = input.database.ok === true;
  const indexerReady = input.indexer?.isFresh === true;
  const inventoryReady = input.pdsInventory?.present === true &&
    input.pdsInventory.fresh === true;
  // Railway uses this endpoint as the web deployment healthcheck. A stale
  // background feed must alert operators, but must not roll back a healthy web
  // repair deploy. The hourly production verifier enforces every freshness
  // signal below; HTTP readiness is the web/DB serving boundary.
  const ready = databaseReady;
  return {
    status: ready ? 200 : 503,
    body: {
      ok: ready,
      service: "atmosphere-account-web",
      release: input.release ?? runtimeRelease(),
      database: input.database,
      indexer: input.indexer
        ? {
          present: true,
          fresh: input.indexer.isFresh,
          heartbeatAt: new Date(input.indexer.heartbeatAt).toISOString(),
          expiresAt: new Date(input.indexer.expiresAt).toISOString(),
        }
        : { present: false, fresh: false },
      pdsInventory: input.pdsInventory ?? {
        present: false,
        fresh: false,
        error: "inventory_freshness_unavailable",
      },
      degraded: !ready || !indexerReady || !inventoryReady,
      timestamp: new Date().toISOString(),
    },
  };
}

export async function appviewReadinessForTest(
  appview: string,
  fetchImpl: typeof fetch,
): Promise<ReadinessResult> {
  return await appviewReadiness(appview, fetchImpl);
}

async function appviewReadiness(
  appview: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReadinessResult> {
  const url = new URL("/api/health/ready", appview);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username || url.password
  ) {
    throw new Error("invalid appview readiness URL");
  }
  const res = await fetchImpl(url, {
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  const contentType = res.headers.get("content-type");
  let rawBody: unknown = null;
  let validJsonObject = false;
  if (isJsonMediaType(contentType)) {
    const bounded = await readResponseTextWithLimit(
      res,
      MAX_APPVIEW_READINESS_BYTES,
    );
    if (bounded.ok) {
      try {
        rawBody = JSON.parse(bounded.text);
        validJsonObject = isRecord(rawBody);
      } catch {
        // Keep the fail-closed invalid response value.
      }
    }
  } else {
    await res.body?.cancel().catch(() => {});
  }
  const body = validJsonObject && isRecord(rawBody) ? rawBody : { ok: false };
  const appviewRelease = publicAppviewRelease(body.release);
  const database = publicDatabaseHealth(body.database);
  const indexer = publicIndexerHealth(body.indexer);
  const pdsInventory = publicPdsInventoryHealth(body.pdsInventory);
  const appviewOk = res.ok && body.ok === true && database?.ok === true;
  const dependenciesFresh = indexer?.present === true &&
    indexer.fresh === true && pdsInventory?.present === true &&
    pdsInventory.fresh === true;
  const publicBody = publicAppviewReadinessBody(body);
  // The public serving boundary follows the appview/DB. Preserve background
  // health as a fail-closed degraded signal for the production verifier.
  publicBody.ok = appviewOk;
  publicBody.degraded = !appviewOk || !dependenciesFresh ||
    body.degraded !== false;
  if (!validJsonObject) {
    publicBody.error = "invalid_appview_readiness_response";
  } else if (!appviewOk) {
    publicBody.error = "appview_readiness_failed";
  }
  return {
    status: appviewOk ? 200 : 503,
    body: {
      ...publicBody,
      service: "atmosphere-account-web-shell",
      release: runtimeRelease(),
      appview: {
        ok: appviewOk,
        url: appview,
        release: appviewRelease,
      },
      timestamp: new Date().toISOString(),
    },
  };
}

function publicAppviewReadinessBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ok: body.ok === true };
  const database = publicDatabaseHealth(body.database);
  if (database) result.database = database;
  const indexer = publicIndexerHealth(body.indexer);
  if (indexer) result.indexer = indexer;
  const pdsInventory = publicPdsInventoryHealth(body.pdsInventory);
  if (pdsInventory) result.pdsInventory = pdsInventory;
  if (typeof body.degraded === "boolean") result.degraded = body.degraded;
  return result;
}

function publicDatabaseHealth(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, unknown> = { ok: value.ok === true };
  const latencyMs = finiteNonNegativeNumber(value.latencyMs);
  if (latencyMs !== null) result.latencyMs = latencyMs;
  if (
    value.databaseKind === "file" || value.databaseKind === "remote" ||
    value.databaseKind === "neon" || value.databaseKind === "postgres"
  ) result.databaseKind = value.databaseKind;
  if (
    value.backend === "turso" || value.backend === "neon" ||
    value.backend === "postgres"
  ) result.backend = value.backend;
  return result;
}

function publicIndexerHealth(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, unknown> = {
    present: value.present === true,
    fresh: value.fresh === true,
  };
  const heartbeatAt = publicIsoTimestamp(value.heartbeatAt);
  if (heartbeatAt) result.heartbeatAt = heartbeatAt;
  const expiresAt = publicIsoTimestamp(value.expiresAt);
  if (expiresAt) result.expiresAt = expiresAt;
  return result;
}

function publicPdsInventoryHealth(
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, unknown> = {
    present: value.present === true,
    fresh: value.fresh === true,
  };
  if (value.error != null) {
    result.error = "inventory_freshness_unavailable";
  }
  for (const key of ["maxAgeMs", "ageMs", "pages", "instanceCount"] as const) {
    if (value[key] === null) {
      result[key] = null;
      continue;
    }
    const number = finiteNonNegativeNumber(value[key]);
    if (number !== null) result[key] = number;
  }
  const completedAt = publicIsoTimestamp(value.completedAt);
  result.completedAt = completedAt;
  const scanId = publicOpaqueIdentifier(value.scanId);
  result.scanId = scanId;

  if (isRecord(value.latestAttempt)) {
    const attempt = value.latestAttempt;
    const status = attempt.status === "running" ||
        attempt.status === "succeeded" || attempt.status === "failed"
      ? attempt.status
      : null;
    if (status) {
      result.latestAttempt = {
        status,
        complete: attempt.complete === true,
        startedAt: publicIsoTimestamp(attempt.startedAt),
        completedAt: publicIsoTimestamp(attempt.completedAt),
        error: status === "failed" ? "inventory_scan_failed" : null,
      };
    }
  } else if (value.latestAttempt === null) {
    result.latestAttempt = null;
  }
  return result;
}

function publicAppviewRelease(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const runtimes = new Set([
    "deno-deploy",
    "railway",
    "vercel",
    "fly",
    "local",
    "other",
  ]);
  if (typeof value.runtime !== "string" || !runtimes.has(value.runtime)) {
    return null;
  }
  return {
    runtime: value.runtime,
    deploymentId: publicOpaqueIdentifier(value.deploymentId),
    service: publicOpaqueIdentifier(value.service),
    gitSha: typeof value.gitSha === "string" &&
        /^[0-9a-f]{40}$/i.test(value.gitSha)
      ? value.gitSha.toLowerCase()
      : null,
    gitBranch: publicOpaqueIdentifier(value.gitBranch),
    artifactDigest: typeof value.artifactDigest === "string" &&
        /^web-source-v1:sha256:[0-9a-f]{64}$/.test(value.artifactDigest)
      ? value.artifactDigest
      : null,
  };
}

function finiteNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function publicIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function publicOpaqueIdentifier(value: unknown): string | null {
  if (
    typeof value !== "string" || value.length < 1 || value.length > 128 ||
    !/^[A-Za-z0-9._:/@-]+$/.test(value)
  ) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isJsonMediaType(value: string | null): boolean {
  const mediaType = (value ?? "").split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function readinessJson(
  result: ReadinessResult,
  cacheState: "hit" | "miss",
): Response {
  return json(result.body, {
    status: result.status,
    headers: { "x-atmosphere-readiness-cache": cacheState },
  });
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers ?? {}),
    },
  });
}
