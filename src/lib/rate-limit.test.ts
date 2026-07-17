import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { rateLimit, __resetRateLimits } from "./rate-limit";

beforeEach(() => __resetRateLimits());
afterEach(() => vi.useRealTimers());

describe("rateLimit", () => {
  it("allows up to the limit, then blocks", () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect(rateLimit("u1", opts).ok).toBe(true);
    expect(rateLimit("u1", opts).ok).toBe(true);
    expect(rateLimit("u1", opts).ok).toBe(true);
    const blocked = rateLimit("u1", opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("isolates identities", () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(rateLimit("a", opts).ok).toBe(true);
    expect(rateLimit("a", opts).ok).toBe(false);
    expect(rateLimit("b", opts).ok).toBe(true); // separate bucket
  });

  it("refills tokens over time", () => {
    vi.useFakeTimers();
    const opts = { limit: 2, windowMs: 1000 };
    expect(rateLimit("t", opts).ok).toBe(true);
    expect(rateLimit("t", opts).ok).toBe(true);
    expect(rateLimit("t", opts).ok).toBe(false);
    vi.advanceTimersByTime(600); // > 1 token refilled (2/sec)
    expect(rateLimit("t", opts).ok).toBe(true);
  });
});
