/**
 * Half-day attendance (0.5 increments). Covers the money rounding, decimal
 * totals, and the mutation schema that guards the sync outbox + /api/sync.
 */
import { describe, it, expect } from "vitest";
import { estimateCostPaise, rowTotals, summarize } from "./calc";
import { labourAttendanceMutationSchema } from "./schema";
import type { AttendanceRecordItem, SheetRow } from "./types";

describe("half-day attendance", () => {
  describe("estimateCostPaise", () => {
    it("charges a half day at half the daily rate", () => {
      expect(estimateCostPaise(50_000, 0.5)).toBe(25_000);
    });

    it("rounds fractional paise so money stays an integer", () => {
      // 33_333 × 0.5 = 16_666.5 — must not leak a fraction into stored paise.
      const cost = estimateCostPaise(33_333, 0.5);
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBe(16_667);
    });

    it("still handles whole days and missing rates (backward compatible)", () => {
      expect(estimateCostPaise(50_000, 2)).toBe(100_000);
      expect(estimateCostPaise(null, 1.5)).toBe(0);
    });
  });

  describe("rowTotals", () => {
    it("sums decimal quantities and their costs", () => {
      const rows: SheetRow[] = [
        { subcategoryId: "a", name: "Mason", categoryId: "m", categoryName: "Mason", dailyRatePaise: 60_000, quantity: 1.5, notes: null },
        { subcategoryId: "b", name: "Helper", categoryId: "m", categoryName: "Mason", dailyRatePaise: 40_000, quantity: 0.5, notes: null },
      ];
      const totals = rowTotals(rows);
      expect(totals.totalPresent).toBe(2);
      expect(totals.estimatedCostPaise).toBe(110_000); // 90_000 + 20_000
    });
  });

  describe("mutation schema", () => {
    const base = {
      projectId: "11111111-1111-4111-8111-111111111111",
      date: "2026-07-22",
      labourSubcategoryId: "22222222-2222-4222-9222-222222222222",
    };

    it.each([0, 0.5, 1, 1.5, 2, 2.5, 10])("accepts %s", (quantityPresent) => {
      expect(() =>
        labourAttendanceMutationSchema.parse({ ...base, quantityPresent }),
      ).not.toThrow();
    });

    it.each([0.25, 1.1, 0.75, -0.5])("rejects %s (not a 0.5 step)", (quantityPresent) => {
      expect(() =>
        labourAttendanceMutationSchema.parse({ ...base, quantityPresent }),
      ).toThrow();
    });
  });

  describe("summarize", () => {
    it("accumulates half-day man-days", () => {
      const rec = (id: string, qty: number): AttendanceRecordItem => ({
        id,
        projectId: "p1",
        projectName: "Site A",
        date: "2026-07-22",
        categoryId: "c1",
        categoryName: "Mason",
        color: null,
        subcategoryId: "s1",
        subcategoryName: "Senior Mason",
        contractorId: null,
        contractorName: null,
        quantityPresent: qty,
        dailyRatePaiseSnapshot: 60_000,
        estimatedCostPaise: Math.round(60_000 * qty),
        notes: null,
      });

      const summary = summarize([rec("1", 0.5), rec("2", 1.5)]);
      expect(summary.totalManDays).toBe(2);
      expect(summary.byCategory[0].manDays).toBe(2);
      expect(summary.byCategory[0].subcategories[0].manDays).toBe(2);
    });
  });
});
