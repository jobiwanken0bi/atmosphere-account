/**
 * Soft per-IP rate limit for the public read API.
 *
 * Implementation note: this is a tiny in-memory token bucket keyed by
 * the caller's IP. On Deno Deploy, isolates are per-region and
 * relatively short-lived, so this is a deterrent — not a hard fence.
 * It cleanly catches scripted abuse without standing up a Turso table
 * or a Redis dependency.
 *
 * If we ever need cross-region enforcement (or hard limits), swap the
 * `Map` for a Turso-backed counter or per-key Edge Config row — the
 * `withRateLimit` wrapper signature stays the same.
 */
import { define } from "../utils.ts";

/** Bucket capacity (max burst). */
const CAPACITY = 60;
/**
 * Refill window in milliseconds. The bucket refills linearly so a
 * caller making 1 req/sec sustains forever; bursts above CAPACITY
 * within REFILL_MS get a 429.
 */
const REFILL_MS = 60_000;

interface Bucket {
  /** Tokens currently available (float; refills linearly). */
  tokens: number;
  /** Last time we refilled, ms since epoch. */
  last: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Lightweight LRU-ish trim — when the map gets large we drop entries
 * we haven't seen recently. Keeps memory bounded under a sustained
 * scan from a botnet without a full LRU impl.
 */
function maybeTrim(now: number): void {
  if (buckets.size < 2_000) return;
  for (const [ip, b] of buckets) {
    if (now - b.last > REFILL_MS * 5) buckets.delete(ip);
  }
}

/** Returns true if the request is allowed; false if it should be rejected. */
function take(ip: string, now: number): boolean {
  let b = buckets.get(ip);
  if (!b) {
    b = { tokens: CAPACITY, last: now };
    buckets.set(ip, b);
    maybeTrim(now);
  } else {
    const elapsed = now - b.last;
    if (elapsed > 0) {
      b.tokens = Math.min(
        CAPACITY,
        b.tokens + (elapsed / REFILL_MS) * CAPACITY,
      );
      b.last = now;
    }
  }
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/**
 * Best-effort caller IP. Behind Deno Deploy / Fly we have to trust
 * `x-forwarded-for`; we take the first hop (original client) and fall
 * back to a synthetic key so we never crash on an empty header. The
 * synthetic fallback lumps anonymous callers into one bucket, which
 * is fine for "soft" limiting.
 */
function callerIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "anonymous";
}

// deno-lint-ignore no-explicit-any
type FreshHandler = (ctx: any) => Response | Promise<Response>;

/**
 * Wrap a Fresh handler with the soft rate limit. Use as:
 *
 *   GET: withRateLimit(async (ctx) => { ... })
 *
 * On 429 we return a small JSON body and a `Retry-After` header (in
 * seconds) so well-behaved clients can back off.
 */
export function withRateLimit<H extends FreshHandler>(handler: H): H {
  return ((ctx) => {
    const ip = callerIp(ctx.req);
    const now = Date.now();
    if (!take(ip, now)) {
      return new Response(
        JSON.stringify({ error: "rate_limited" }),
        {
          status: 429,
          headers: {
            "content-type": "application/json; charset=utf-8",
            // Suggest waiting a full window for capacity to refill;
            // callers can retry sooner since the bucket refills linearly.
            "retry-after": String(Math.ceil(REFILL_MS / 1000)),
          },
        },
      );
    }
    return handler(ctx);
  }) as H;
}

// Re-export the Fresh `define` so callers don't need a second import
// when adding a new rate-limited endpoint.
export { define };
