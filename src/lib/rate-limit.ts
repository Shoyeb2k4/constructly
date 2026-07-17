/**
 * Minimal in-process token-bucket rate limiter. Suitable for a single-instance
 * deployment and as a safety net behind Vercel's platform limits; swap the
 * store for Redis/Upstash when running multi-instance (the interface stays the
 * same). Keyed by an arbitrary identity string (e.g. userId or IP).
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the next token is available (for Retry-After). */
  retryAfter: number;
}

/** Consume one token for `identity`. Returns whether the request is allowed. */
export function rateLimit(identity: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const refillPerMs = opts.limit / opts.windowMs;
  const bucket = buckets.get(identity) ?? { tokens: opts.limit, updatedAt: now };

  // Refill proportionally to elapsed time, capped at the limit.
  const elapsed = now - bucket.updatedAt;
  bucket.tokens = Math.min(opts.limit, bucket.tokens + elapsed * refillPerMs);
  bucket.updatedAt = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(identity, bucket);
    return { ok: true, remaining: Math.floor(bucket.tokens), retryAfter: 0 };
  }

  buckets.set(identity, bucket);
  const retryAfter = Math.ceil((1 - bucket.tokens) / refillPerMs / 1000);
  return { ok: false, remaining: 0, retryAfter };
}

/** Test helper — clears all buckets. */
export function __resetRateLimits(): void {
  buckets.clear();
}
