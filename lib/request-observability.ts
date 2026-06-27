import { define } from "../utils.ts";
import { IS_HOSTED_RUNTIME } from "./env.ts";

const DEFAULT_SLOW_REQUEST_MS = 1_000;
const SLOW_REQUEST_THRESHOLD_MS = slowRequestThresholdMs();

export const slowRequestLoggingMiddleware = define.middleware(async (ctx) => {
  const started = performance.now();
  const response = await ctx.next();
  const elapsed = Math.round(performance.now() - started);

  if (
    SLOW_REQUEST_THRESHOLD_MS !== null && elapsed >= SLOW_REQUEST_THRESHOLD_MS
  ) {
    const url = new URL(ctx.req.url);
    console.warn(
      `[request] slow ${ctx.req.method} ${url.pathname} ` +
        `${response.status} ${elapsed}ms`,
    );
  }

  return response;
});

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
