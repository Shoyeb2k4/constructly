import { describe, it, expect } from "vitest";
import { deriveBudget, poCountsForBudget } from "./calc";

describe("deriveBudget", () => {
  it("combines labor + procurement into used/remaining/utilization", () => {
    const b = deriveBudget(10_000_000, { laborPaise: 4_000_000, procurementPaise: 3_000_000 });
    expect(b.usedPaise).toBe(7_000_000);
    expect(b.remainingPaise).toBe(3_000_000);
    expect(b.utilizationPct).toBe(70);
    expect(b.overBudget).toBe(false);
  });
  it("flags over budget with a negative remaining", () => {
    const b = deriveBudget(5_000_000, { laborPaise: 3_000_000, procurementPaise: 3_000_000 });
    expect(b.overBudget).toBe(true);
    expect(b.remainingPaise).toBe(-1_000_000);
    expect(b.utilizationPct).toBe(120);
  });
  it("handles a zero budget without dividing by zero", () => {
    expect(deriveBudget(0, { laborPaise: 100, procurementPaise: 0 }).utilizationPct).toBe(0);
  });
});

describe("poCountsForBudget", () => {
  it("counts only APPROVED when approval is required", () => {
    expect(poCountsForBudget("APPROVED", true)).toBe(true);
    expect(poCountsForBudget("SUBMITTED", true)).toBe(false);
    expect(poCountsForBudget("DRAFT", true)).toBe(false);
  });
  it("counts everything except DRAFT when approval is off", () => {
    expect(poCountsForBudget("SUBMITTED", false)).toBe(true);
    expect(poCountsForBudget("APPROVED", false)).toBe(true);
    expect(poCountsForBudget("DRAFT", false)).toBe(false);
  });
});
