import { describe, it, expect } from "vitest";
import {
  advanceDeltaPaise,
  advanceBalancePaise,
  maxAdjustmentPaise,
  computeSettlement,
  validateAdjustment,
} from "./calc";

describe("advanceDeltaPaise", () => {
  it("advances increase, adjustments decrease, bills/payments are neutral", () => {
    expect(advanceDeltaPaise("OPENING_ADVANCE", 1000)).toBe(1000);
    expect(advanceDeltaPaise("ADVANCE", 1000)).toBe(1000);
    expect(advanceDeltaPaise("ADJUSTMENT", 1000)).toBe(-1000);
    expect(advanceDeltaPaise("LABOUR_BILL", 1000)).toBe(0);
    expect(advanceDeltaPaise("PAYMENT", 1000)).toBe(0);
  });
});

describe("advanceBalancePaise", () => {
  it("sums advances minus adjustments", () => {
    expect(
      advanceBalancePaise([
        { type: "OPENING_ADVANCE", amountPaise: 10_000_000 },
        { type: "LABOUR_BILL", amountPaise: 3_800_000 },
        { type: "ADJUSTMENT", amountPaise: 800_000 },
        { type: "PAYMENT", amountPaise: 3_000_000 },
        { type: "ADVANCE", amountPaise: 5_000_000 },
      ]),
    ).toBe(14_200_000); // 10M − 0.8M + 5M
  });
});

describe("maxAdjustmentPaise", () => {
  it("is the smaller of advance and bill, never negative", () => {
    expect(maxAdjustmentPaise(10_000_000, 3_800_000)).toBe(3_800_000);
    expect(maxAdjustmentPaise(500_000, 3_800_000)).toBe(500_000);
    expect(maxAdjustmentPaise(-1, 3_800_000)).toBe(0);
  });
});

describe("computeSettlement", () => {
  it("matches the spec example (bill 38k, adjust 8k, advance 100k)", () => {
    // rupees × 100 = paise
    const r = computeSettlement(3_800_000, 800_000, 10_000_000);
    expect(r.advanceAdjustmentPaise).toBe(800_000);
    expect(r.netPaymentPaise).toBe(3_000_000); // ₹30,000
    expect(r.advanceBalanceAfterPaise).toBe(9_200_000); // ₹92,000 remaining
  });

  it("clamps an over-large adjustment to the outstanding advance", () => {
    const r = computeSettlement(3_800_000, 9_999_999, 500_000);
    expect(r.advanceAdjustmentPaise).toBe(500_000); // capped at advance
    expect(r.netPaymentPaise).toBe(3_300_000);
    expect(r.advanceBalanceAfterPaise).toBe(0);
  });

  it("clamps adjustment to the bill so net never goes negative", () => {
    const r = computeSettlement(1_000_000, 5_000_000, 8_000_000);
    expect(r.advanceAdjustmentPaise).toBe(1_000_000);
    expect(r.netPaymentPaise).toBe(0);
    expect(r.advanceBalanceAfterPaise).toBe(7_000_000);
  });

  it("no advance means full net payment", () => {
    const r = computeSettlement(3_800_000, 0, 0);
    expect(r.advanceAdjustmentPaise).toBe(0);
    expect(r.netPaymentPaise).toBe(3_800_000);
    expect(r.advanceBalanceAfterPaise).toBe(0);
  });
});

describe("validateAdjustment", () => {
  it("accepts a valid adjustment", () => {
    expect(validateAdjustment(800_000, 10_000_000, 3_800_000)).toBeNull();
  });
  it("rejects negatives, over-advance, and over-bill", () => {
    expect(validateAdjustment(-1, 10_000_000, 3_800_000)).toMatch(/negative/);
    expect(validateAdjustment(600_000, 500_000, 3_800_000)).toMatch(/outstanding advance/);
    expect(validateAdjustment(4_000_000, 10_000_000, 3_800_000)).toMatch(/labour bill/);
  });
});
