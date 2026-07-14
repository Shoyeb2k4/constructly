import { describe, it, expect } from "vitest";
import { computeWage } from "./wage";

const WAGE = 80000; // ₹800/day in paise

describe("computeWage", () => {
  it("pays full wage when present", () => {
    expect(computeWage(WAGE, "PRESENT").wagePayablePaise).toBe(80000);
  });
  it("pays half when half-day", () => {
    expect(computeWage(WAGE, "HALF_DAY").wagePayablePaise).toBe(40000);
  });
  it("pays nothing when absent", () => {
    expect(computeWage(WAGE, "ABSENT").wagePayablePaise).toBe(0);
  });
  it("adds overtime at the hourly day-rate", () => {
    // ₹800/8 = ₹100/h; 2h OT → +₹200
    expect(computeWage(WAGE, "PRESENT", 2).wagePayablePaise).toBe(80000 + 20000);
  });
  it("ignores overtime when absent", () => {
    expect(computeWage(WAGE, "ABSENT", 5).wagePayablePaise).toBe(0);
  });
  it("adds overtime on a half-day", () => {
    expect(computeWage(WAGE, "HALF_DAY", 1).wagePayablePaise).toBe(40000 + 10000);
  });
  it("snapshots the wage rate", () => {
    expect(computeWage(WAGE, "PRESENT").wageRatePaise).toBe(WAGE);
  });
  it("is zero for unmarked", () => {
    expect(computeWage(WAGE, null).wagePayablePaise).toBe(0);
  });
  it("rounds odd half-day wages to the paise", () => {
    // ₹855 → 85500 paise; half = 42750
    expect(computeWage(85500, "HALF_DAY").wagePayablePaise).toBe(42750);
  });
});
