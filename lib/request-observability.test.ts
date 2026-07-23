import {
  recordRuntimeMemoryLog,
  recordSlowRequestLog,
  type RuntimeMemoryLogState,
} from "./request-observability.ts";

Deno.test("slow request logging rate-limits repeated path/status classes", () => {
  const state = new Map<string, { lastLoggedAt: number; suppressed: number }>();
  const first = recordSlowRequestLog({ key: "GET /blob 2xx", now: 1, state });
  const second = recordSlowRequestLog({ key: "GET /blob 2xx", now: 2, state });
  const third = recordSlowRequestLog({
    key: "GET /blob 2xx",
    now: 62_000,
    state,
  });
  if (!first.log || second.log || !third.log || third.suppressed !== 1) {
    throw new Error("slow request log gate did not aggregate repeated events");
  }
});

Deno.test("runtime memory logging reports allocator categories on a cooldown", () => {
  const state: RuntimeMemoryLogState = {
    lastLoggedAt: null,
    lastRssBytes: null,
  };
  const first = recordRuntimeMemoryLog({
    now: 1_000,
    intervalMs: 60_000,
    state,
    snapshot: {
      rss: 100 * 1024 * 1024,
      heapTotal: 40 * 1024 * 1024,
      heapUsed: 30 * 1024 * 1024,
      external: 20 * 1024 * 1024,
    },
    uptimeMs: 10_000,
  });
  const suppressed = recordRuntimeMemoryLog({
    now: 2_000,
    intervalMs: 60_000,
    state,
    snapshot: {
      rss: 110 * 1024 * 1024,
      heapTotal: 40 * 1024 * 1024,
      heapUsed: 31 * 1024 * 1024,
      external: 21 * 1024 * 1024,
    },
    uptimeMs: 11_000,
  });
  const second = recordRuntimeMemoryLog({
    now: 62_000,
    intervalMs: 60_000,
    state,
    snapshot: {
      rss: 125 * 1024 * 1024,
      heapTotal: 45 * 1024 * 1024,
      heapUsed: 35 * 1024 * 1024,
      external: 25 * 1024 * 1024,
    },
    uptimeMs: 72_000,
  });

  if (
    !first?.includes('"rssMb":100') ||
    suppressed !== null ||
    !second?.includes('"rssDeltaMb":25') ||
    !second.includes('"externalMb":25')
  ) {
    throw new Error("runtime memory log did not preserve categories/cooldown");
  }
});
