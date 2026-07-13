import { define } from "../utils.ts";
import { IS_HOSTED_RUNTIME } from "./env.ts";

const DEFAULT_SLOW_REQUEST_MS = 1_500;
const DEFAULT_SLOW_REQUEST_LOG_COOLDOWN_MS = 60_000;
const SLOW_REQUEST_THRESHOLD_MS = slowRequestThresholdMs();
const slowRequestLogState = new Map<
  string,
  { lastLoggedAt: number; suppressed: number }
>();

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

function env(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}
