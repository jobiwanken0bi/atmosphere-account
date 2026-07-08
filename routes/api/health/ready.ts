import { define } from "../../../utils.ts";
import { appviewBaseUrl } from "../../../lib/appview-client.ts";
import { checkDbHealth } from "../../../lib/db.ts";
import { IS_DEV } from "../../../lib/env.ts";
import { runtimeRelease } from "../../../lib/release.ts";
import { getWorkerLeaseStatus } from "../../../lib/worker-lease.ts";

const INDEXER_LEASE = "jetstream-indexer";
const READINESS_SUCCESS_CACHE_MS = 2_000;

interface ReadinessResult {
  body: Record<string, unknown>;
  status: number;
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
    } catch (err) {
      return json(
        {
          ok: false,
          service: "atmosphere-account-web",
          release: runtimeRelease(),
          database: { ok: false },
          error: "readiness_check_failed",
          ...(IS_DEV && err instanceof Error ? { detail: err.message } : {}),
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

  const [database, indexer] = await Promise.all([
    checkDbHealth(),
    getWorkerLeaseStatus(INDEXER_LEASE).catch(() => null),
  ]);
  return {
    status: 200,
    body: {
      ok: true,
      service: "atmosphere-account-web",
      release: runtimeRelease(),
      database,
      indexer: indexer
        ? {
          present: true,
          fresh: indexer.isFresh,
          heartbeatAt: new Date(indexer.heartbeatAt).toISOString(),
          expiresAt: new Date(indexer.expiresAt).toISOString(),
        }
        : { present: false, fresh: false },
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
  const res = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  const body = await res.json().catch(() => ({
    ok: false,
    error: "invalid_appview_readiness_response",
  })) as Record<string, unknown>;
  const { release: appviewRelease, ...bodyWithoutRelease } = body;
  const appviewOk = res.ok && body.ok === true;
  return {
    status: appviewOk ? 200 : 503,
    body: {
      ...bodyWithoutRelease,
      service: "atmosphere-account-web-shell",
      release: runtimeRelease(),
      appview: {
        ok: appviewOk,
        url: appview,
        release: isRecord(appviewRelease) ? appviewRelease : null,
      },
      timestamp: new Date().toISOString(),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
