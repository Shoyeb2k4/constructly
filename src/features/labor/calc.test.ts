import { describe, it, expect } from "vitest";
import { estimateCostPaise, sheetTotals, summarize } from "./calc";
import type { AttendanceRecordItem } from "./types";

const rec = (over: Partial<AttendanceRecordItem>): AttendanceRecordItem => {
  const base = {
    id: Math.random().toString(36),
    projectId: "p1",
    projectName: "Skyline",
    date: "2026-07-14",
    categoryId: "helper",
    categoryName: "Helper",
    color: "#F59E0B",
    quantityPresent: 10,
    dailyRatePaiseSnapshot: 55000 as number | null,
    notes: null,
    ...over,
  };
  return {
    ...base,
    estimatedCostPaise:
      over.estimatedCostPaise ?? (base.dailyRatePaiseSnapshot ?? 0) * base.quantityPresent,
  };
};

describe("estimateCostPaise", () => {
  it("multiplies rate by headcount", () => {
    expect(estimateCostPaise(55000, 12)).toBe(660000); // 12 helpers @ ₹550
  });
  it("treats a missing rate as zero", () => {
    expect(estimateCostPaise(null, 12)).toBe(0);
  });
});

describe("sheetTotals", () => {
  it("totals headcount and estimated cost", () => {
    const t = sheetTotals([
      { categoryId: "h", name: "Helper", color: "#000", dailyRatePaise: 55000, quantity: 12, notes: null },
      { categoryId: "m", name: "Mason", color: "#000", dailyRatePaise: 85000, quantity: 8, notes: null },
      { categoryId: "e", name: "Electrician", color: "#000", dailyRatePaise: null, quantity: 3, notes: null },
    ]);
    expect(t.totalPresent).toBe(23);
    expect(t.estimatedCostPaise).toBe(12 * 55000 + 8 * 85000);
  });
});

describe("summarize", () => {
  it("computes man-days by category, project, and daily trend from snapshot costs", () => {
    const s = summarize([
      rec({ quantityPresent: 12 }),
      rec({ date: "2026-07-15", quantityPresent: 10 }),
      rec({ categoryId: "mason", categoryName: "Mason", quantityPresent: 8, dailyRatePaiseSnapshot: 85000 }),
      rec({ projectId: "p2", projectName: "Orion", quantityPresent: 5 }),
    ]);
    expect(s.totalManDays).toBe(35);
    expect(s.byCategory.find((c) => c.categoryId === "helper")?.manDays).toBe(27);
    expect(s.byProject.find((p) => p.projectId === "p2")?.manDays).toBe(5);
    expect(s.trend).toEqual([
      { date: "2026-07-14", total: 25 },
      { date: "2026-07-15", total: 10 },
    ]);
    expect(s.estimatedCostPaise).toBe(27 * 55000 + 8 * 85000);
  });

  it("uses each record's stored snapshot, not a current rate", () => {
    // Two records for the same category recorded under different rates.
    const s = summarize([
      rec({ quantityPresent: 10, dailyRatePaiseSnapshot: 70000 }), // recorded @ ₹700
      rec({ date: "2026-07-15", quantityPresent: 10, dailyRatePaiseSnapshot: 80000 }), // later @ ₹800
    ]);
    expect(s.estimatedCostPaise).toBe(10 * 70000 + 10 * 80000);
  });
});
