import { define } from "../../../utils.ts";
import { checkDbHealth } from "../../../lib/db.ts";
import { IS_DEV } from "../../../lib/env.ts";
import { getWorkerLeaseStatus } from "../../../lib/worker-lease.ts";

const INDEXER_LEASE = "jetstream-indexer";

export const handler = define.handlers({
  async GET(): Promise<Response> {
    try {
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
