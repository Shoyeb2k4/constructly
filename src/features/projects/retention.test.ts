import { describe, it, expect } from "vitest";
import {
  isValidRetention,
  purgeEligibleAt,
  isPurgeEligible,
  RETENTION_DAY_CHOICES,
} from "./retention";

const DAY = 86_400_000;

describe("isValidRetention", () => {
  it("accepts null (indefinite) and each fixed choice", () => {
    expect(isValidRetention(null)).toBe(true);
    for (const d of RETENTION_DAY_CHOICES) expect(isValidRetention(d)).toBe(true);
  });
  it("rejects arbitrary values", () => {
    expect(isValidRetention(45)).toBe(false);
    expect(isValidRetention(0)).toBe(false);
    expect(isValidRetention(-30)).toBe(false);
  });
});

describe("purgeEligibleAt", () => {
  it("is null when not deleted", () => {
    expect(purgeEligibleAt(null, 30)).toBeNull();
  });
  it("is null for indefinite retention (never becomes eligible)", () => {
    expect(purgeEligibleAt(new Date(), null)).toBeNull();
  });
  it("is deletedAt + N days", () => {
    const deletedAt = new Date("2026-01-01T00:00:00Z");
    const at = purgeEligibleAt(deletedAt, 90);
    expect(at?.toISOString()).toBe(new Date(deletedAt.getTime() + 90 * DAY).toISOString());
  });
});

describe("isPurgeEligible", () => {
  const deletedAt = new Date("2026-01-01T00:00:00Z");
  it("false before the window elapses", () => {
    const now = new Date(deletedAt.getTime() + 29 * DAY);
    expect(isPurgeEligible(deletedAt, 30, now)).toBe(false);
  });
  it("true once the window has elapsed", () => {
    const now = new Date(deletedAt.getTime() + 31 * DAY);
    expect(isPurgeEligible(deletedAt, 30, now)).toBe(true);
  });
  it("never eligible under indefinite retention", () => {
    const now = new Date(deletedAt.getTime() + 3650 * DAY);
    expect(isPurgeEligible(deletedAt, null, now)).toBe(false);
  });
});
