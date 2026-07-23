import { define } from "../utils.ts";
import { IS_HOSTED_RUNTIME } from "./env.ts";

const DEFAULT_SLOW_REQUEST_MS = 1_500;
const DEFAULT_SLOW_REQUEST_LOG_COOLDOWN_MS = 60_000;
const DEFAULT_RUNTIME_MEMORY_LOG_INTERVAL_MS = 5 * 60_000;
const SLOW_REQUEST_THRESHOLD_MS = slowRequestThresholdMs();
const RUNTIME_MEMORY_LOG_INTERVAL_MS = runtimeMemoryLogIntervalMs();
const slowRequestLogState = new Map<
  string,
  { lastLoggedAt: number; suppressed: number }
>();
const runtimeMemoryLogState: RuntimeMemoryLogState = {
  lastLoggedAt: null,
  lastRssBytes: null,
};

export const slowRequestLoggingMiddleware = define.middleware(async (ctx) => {
  const started = performance.now();
  const response = await ctx.next();
  const elapsed = Math.round(performance.now() - started);

  if (
    SLOW_REQUEST_THRESHOLD_MS !== null && elapsed >= SLOW_REQUEST_THRESHOLD_MS
  ) {
    const url = new URL(ctx.req.url);
    const decision = recordSlowRequestLog({
      key: `${ctx.req.method} ${url.pathname} ${
        Math.floor(response.status / 100)
      }xx`,
      now: Date.now(),
      state: slowRequestLogState,
    });
    if (decision.log) {
      const suffix = decision.suppressed > 0
        ? ` suppressed=${decision.suppressed}`
        : "";
      const message = `[request] slow ${ctx.req.method} ${url.pathname} ` +
        `${response.status} ${elapsed}ms${suffix}`;
      if (response.status >= 500) console.warn(message);
      else console.info(message);
    }
  }

  return response;
});

export const runtimeMemoryLoggingMiddleware = define.middleware(async (ctx) => {
  const response = await ctx.next();
  if (RUNTIME_MEMORY_LOG_INTERVAL_MS !== null) {
    const line = recordRuntimeMemoryLog({
      now: Date.now(),
      intervalMs: RUNTIME_MEMORY_LOG_INTERVAL_MS,
      state: runtimeMemoryLogState,
      snapshot: Deno.memoryUsage(),
      uptimeMs: performance.now(),
    });
    if (line) console.info(line);
  }
  return response;
});

export interface RuntimeMemorySnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
}

export interface RuntimeMemoryLogState {
  lastLoggedAt: number | null;
  lastRssBytes: number | null;
}

export function recordRuntimeMemoryLog(input: {
  now: number;
  intervalMs: number;
  state: RuntimeMemoryLogState;
  snapshot: RuntimeMemorySnapshot;
  uptimeMs: number;
}): string | null {
  if (
    input.state.lastLoggedAt !== null &&
    input.now - input.state.lastLoggedAt < input.intervalMs
  ) {
    return null;
  }
  const previousRss = input.state.lastRssBytes;
  input.state.lastLoggedAt = input.now;
  input.state.lastRssBytes = input.snapshot.rss;
  const rssDeltaMb = previousRss === null
    ? null
    : bytesToMb(input.snapshot.rss - previousRss);
  return `[memory] ${
    JSON.stringify({
      rssMb: bytesToMb(input.snapshot.rss),
      rssDeltaMb,
      heapUsedMb: bytesToMb(input.snapshot.heapUsed),
      heapTotalMb: bytesToMb(input.snapshot.heapTotal),
      externalMb: bytesToMb(input.snapshot.external),
      uptimeSeconds: Math.round(input.uptimeMs / 1000),
    })
  }`;
}

export function recordSlowRequestLog(input: {
  key: string;
  now: number;
  state: Map<string, { lastLoggedAt: number; suppressed: number }>;
  cooldownMs?: number;
}): { log: boolean; suppressed: number } {
  const cooldownMs = input.cooldownMs ?? DEFAULT_SLOW_REQUEST_LOG_COOLDOWN_MS;
  const current = input.state.get(input.key);
  if (current && input.now - current.lastLoggedAt < cooldownMs) {
    current.suppressed++;
    return { log: false, suppressed: current.suppressed };
  }
  const suppressed = current?.suppressed ?? 0;
  input.state.set(input.key, { lastLoggedAt: input.now, suppressed: 0 });
  if (input.state.size > 500) {
    const oldest = [...input.state.entries()].sort(
      (a, b) => a[1].lastLoggedAt - b[1].lastLoggedAt,
    );
    for (const [key] of oldest.slice(0, input.state.size - 400)) {
      input.state.delete(key);
    }
  }
  return { log: true, suppressed };
}

function slowRequestThresholdMs(): number | null {
  const enabled = env("LOG_SLOW_REQUESTS");
  if (enabled === "0" || enabled === "false") return null;
  if (!IS_HOSTED_RUNTIME && enabled !== "1" && enabled !== "true") return null;

  const raw = env("SLOW_REQUEST_LOG_MS");
  if (!raw) return DEFAULT_SLOW_REQUEST_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SLOW_REQUEST_MS;
}

function runtimeMemoryLogIntervalMs(): number | null {
  const enabled = env("LOG_RUNTIME_MEMORY");
  if (enabled === "0" || enabled === "false") return null;
  if (!IS_HOSTED_RUNTIME && enabled !== "1" && enabled !== "true") return null;
  const raw = env("RUNTIME_MEMORY_LOG_INTERVAL_MS");
  if (!raw) return DEFAULT_RUNTIME_MEMORY_LOG_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 60_000
    ? parsed
    : DEFAULT_RUNTIME_MEMORY_LOG_INTERVAL_MS;
}

function bytesToMb(value: number): number {
  return Math.round((value / (1024 * 1024)) * 10) / 10;
}

function env(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}
