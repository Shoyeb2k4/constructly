import { describe, it, expect } from "vitest";
import { estimateCostPaise, rowTotals, summarize } from "./calc";
import type { AttendanceRecordItem } from "./types";

const rec = (over: Partial<AttendanceRecordItem>): AttendanceRecordItem => {
  const base = {
    id: Math.random().toString(36),
    projectId: "p1",
    projectName: "Skyline",
    date: "2026-07-14",
    categoryId: "carp",
    categoryName: "Carpenter",
    color: "#8B5CF6",
    subcategoryId: "main-carp",
    subcategoryName: "Main Carpenter",
    quantityPresent: 10,
    dailyRatePaiseSnapshot: 90000 as number | null,
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
    expect(estimateCostPaise(90000, 12)).toBe(1_080_000);
  });
  it("treats a missing rate as zero", () => {
    expect(estimateCostPaise(null, 12)).toBe(0);
  });
});

describe("rowTotals", () => {
  it("totals headcount and estimated cost across rows", () => {
    const t = rowTotals([
      { subcategoryId: "a", name: "Main Carpenter", dailyRatePaise: 90000, quantity: 12, notes: null },
      { subcategoryId: "b", name: "Carpenter Helper", dailyRatePaise: 55000, quantity: 8, notes: null },
      { subcategoryId: "c", name: "No-rate", dailyRatePaise: null, quantity: 3, notes: null },
    ]);
    expect(t.totalPresent).toBe(23);
    expect(t.estimatedCostPaise).toBe(12 * 90000 + 8 * 55000);
  });
});

describe("summarize (hierarchy)", () => {
  it("groups man-days by category with subcategory breakdown + totals", () => {
    const s = summarize([
      rec({ quantityPresent: 12 }), // Carpenter / Main Carpenter
      rec({ subcategoryId: "carp-help", subcategoryName: "Carpenter Helper", quantityPresent: 8, dailyRatePaiseSnapshot: 55000 }),
      rec({ categoryId: "elec", categoryName: "Electrician", subcategoryId: "main-elec", subcategoryName: "Main Electrician", quantityPresent: 4, dailyRatePaiseSnapshot: 110000 }),
      rec({ date: "2026-07-15", quantityPresent: 10 }),
      rec({ projectId: "p2", projectName: "Orion", quantityPresent: 5 }),
    ]);
    expect(s.totalManDays).toBe(39);

    const carpenter = s.byCategory.find((c) => c.categoryId === "carp")!;
    expect(carpenter.manDays).toBe(35); // 12 + 8 + 10 + 5
    expect(carpenter.subcategories.find((x) => x.subcategoryId === "main-carp")?.manDays).toBe(27);
    expect(carpenter.subcategories.find((x) => x.subcategoryId === "carp-help")?.manDays).toBe(8);

    const electrician = s.byCategory.find((c) => c.categoryId === "elec")!;
    expect(electrician.manDays).toBe(4);

    expect(s.byProject.find((p) => p.projectId === "p2")?.manDays).toBe(5);
    expect(s.trend).toEqual([
      { date: "2026-07-14", total: 29 },
      { date: "2026-07-15", total: 10 },
    ]);
    expect(s.estimatedCostPaise).toBe(27 * 90000 + 8 * 55000 + 4 * 110000);
  });

  it("uses each record's stored snapshot, not a current rate", () => {
    const s = summarize([
      rec({ quantityPresent: 10, dailyRatePaiseSnapshot: 70000 }), // recorded @ ₹700
      rec({ date: "2026-07-15", quantityPresent: 10, dailyRatePaiseSnapshot: 80000 }), // later @ ₹800
    ]);
    expect(s.estimatedCostPaise).toBe(10 * 70000 + 10 * 80000);
  });
});
