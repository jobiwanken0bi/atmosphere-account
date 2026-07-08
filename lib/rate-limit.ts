/**
 * Scoped rate limits for public API surfaces.
 *
 * `checkRateLimit` is a tiny in-memory token bucket. On Deno Deploy, isolates
 * are per-region and relatively short-lived, so it is a soft deterrent. Use
 * `checkDurableRateLimit` for high-risk flows that need shared enforcement
 * across Deno/Railway instances.
 *
 * The durable limiter intentionally uses a fixed window instead of a SQL token
 * bucket. It keeps the DB writes cheap and predictable while preserving the
 * same `{ ok, retryAfter }` response contract as the in-memory limiter.
 */
import { define } from "../utils.ts";
import { type DbClient, withDb } from "./db.ts";
import { reportIpSecret } from "./env.ts";

/** Bucket capacity (max burst). */
const CAPACITY = 60;
/**
 * Refill window in milliseconds. The bucket refills linearly so a
 * caller making 1 req/sec sustains forever; bursts above CAPACITY
 * within REFILL_MS get a 429.
 */
const REFILL_MS = 60_000;

export interface RateLimitOptions {
  capacity?: number;
  refillMs?: number;
  scope?: string;
  now?: number;
}

export interface DurableRateLimitOptions extends RateLimitOptions {
  withDb?: <T>(fn: (c: DbClient) => Promise<T>) => Promise<T>;
  fallbackToMemory?: boolean;
  keySecret?: string;
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfter: number };

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
function maybeTrim(now: number, refillMs: number): void {
  if (buckets.size < 2_000) return;
  for (const [ip, b] of buckets) {
    if (now - b.last > refillMs * 5) buckets.delete(ip);
  }
}

/** Returns true if the request is allowed; false if it should be rejected. */
function take(
  key: string,
  now: number,
  capacity: number,
  refillMs: number,
): boolean {
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, last: now };
    buckets.set(key, b);
    maybeTrim(now, refillMs);
  } else {
    const elapsed = now - b.last;
    if (elapsed > 0) {
      b.tokens = Math.min(
        capacity,
        b.tokens + (elapsed / refillMs) * capacity,
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

export function checkRateLimit(
  req: Request,
  options: RateLimitOptions = {},
): RateLimitResult {
  const capacity = positiveInteger(options.capacity, CAPACITY);
  const refillMs = positiveInteger(options.refillMs, REFILL_MS);
  const scope = options.scope ?? "default";
  const key = `${scope}:${callerIp(req)}`;
  const now = options.now ?? Date.now();
  if (take(key, now, capacity, refillMs)) return { ok: true };
  return { ok: false, retryAfter: Math.ceil(refillMs / 1000) };
}

export async function checkDurableRateLimit(
  req: Request,
  options: DurableRateLimitOptions = {},
): Promise<RateLimitResult> {
  const capacity = positiveInteger(options.capacity, CAPACITY);
  const refillMs = positiveInteger(options.refillMs, REFILL_MS);
  const scope = options.scope ?? "default";
  const now = options.now ?? Date.now();
  const bucketKey = await durableBucketKey(
    scope,
    callerIp(req),
    options.keySecret ?? reportIpSecret(),
  );
  const run = options.withDb ?? withDb;
  try {
    return await run((c) => takeDurable(c, bucketKey, now, capacity, refillMs));
  } catch {
    if (options.fallbackToMemory === false) {
      throw new Error("rate limit failed");
    }
    return checkRateLimit(req, options);
  }
}

async function durableBucketKey(
  scope: string,
  ip: string,
  secret: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${secret}\n${scope}\n${ip}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `${scope}:${b64url(digest.slice(0, 18))}`;
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

function rowsAffected(result: { rowsAffected?: number | bigint }): number {
  return Number(result.rowsAffected ?? 0);
}

async function takeDurable(
  c: DbClient,
  bucketKey: string,
  now: number,
  capacity: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const resetAt = now + windowMs;
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await c.execute({
      sql: `
        SELECT count, reset_at
        FROM rate_limit_bucket
        WHERE bucket_key = ?
        LIMIT 1
      `,
      args: [bucketKey],
    });
    const row = existing.rows[0] as Record<string, unknown> | undefined;

    if (!row) {
      try {
        await c.execute({
          sql: `
            INSERT INTO rate_limit_bucket (
              bucket_key, count, reset_at, updated_at
            ) VALUES (?, 1, ?, ?)
          `,
          args: [bucketKey, resetAt, now],
        });
        return { ok: true };
      } catch {
        continue;
      }
    }

    const currentCount = Number(row.count ?? 0);
    const currentResetAt = Number(row.reset_at ?? 0);
    if (currentResetAt <= now) {
      const result = await c.execute({
        sql: `
          UPDATE rate_limit_bucket
          SET count = 1, reset_at = ?, updated_at = ?
          WHERE bucket_key = ? AND reset_at = ?
        `,
        args: [resetAt, now, bucketKey, currentResetAt],
      });
      if (rowsAffected(result) > 0) return { ok: true };
      continue;
    }

    if (currentCount >= capacity) {
      return {
        ok: false,
        retryAfter: Math.max(1, Math.ceil((currentResetAt - now) / 1000)),
      };
    }

    const result = await c.execute({
      sql: `
        UPDATE rate_limit_bucket
        SET count = count + 1, updated_at = ?
        WHERE bucket_key = ?
          AND reset_at = ?
          AND count = ?
      `,
      args: [now, bucketKey, currentResetAt, currentCount],
    });
    if (rowsAffected(result) > 0) return { ok: true };
  }

  return {
    ok: false,
    retryAfter: Math.max(1, Math.ceil(windowMs / 1000)),
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const parsed = Math.floor(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
export function withRateLimit<H extends FreshHandler>(
  handler: H,
  options: RateLimitOptions = {},
): H {
  return ((ctx) => {
    const result = checkRateLimit(ctx.req, options);
    if (!result.ok) {
      return new Response(
        JSON.stringify({ error: "rate_limited" }),
        {
          status: 429,
          headers: {
            "content-type": "application/json; charset=utf-8",
            // Suggest waiting a full window for capacity to refill;
            // callers can retry sooner since the bucket refills linearly.
            "retry-after": String(result.retryAfter),
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
