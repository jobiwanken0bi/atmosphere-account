import { define } from "../../../utils.ts";
import { appviewBaseUrl } from "../../../lib/appview-client.ts";
import { checkDbHealth } from "../../../lib/db.ts";
import { IS_DEV } from "../../../lib/env.ts";
import { getWorkerLeaseStatus } from "../../../lib/worker-lease.ts";

const INDEXER_LEASE = "jetstream-indexer";

export const handler = define.handlers({
  async GET(): Promise<Response> {
    try {
      const appview = appviewBaseUrl();
      if (appview) {
        return await appviewReadiness(appview);
      }
      const [database, indexer] = await Promise.all([
        checkDbHealth(),
        getWorkerLeaseStatus(INDEXER_LEASE).catch(() => null),
      ]);
      return json({
        ok: true,
        service: "atmosphere-account-web",
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
      });
    } catch (err) {
      return json(
        {
          ok: false,
          service: "atmosphere-account-web",
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

async function appviewReadiness(appview: string): Promise<Response> {
  const url = new URL("/api/health/ready", appview);
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  const body = await res.json().catch(() => ({
    ok: false,
    error: "invalid_appview_readiness_response",
  })) as Record<string, unknown>;
  return json(
    {
      ...body,
      service: "atmosphere-account-web-shell",
      appview: {
        ok: res.ok && body.ok === true,
        url: appview,
      },
      timestamp: new Date().toISOString(),
    },
    { status: res.ok ? 200 : 503 },
  );
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
