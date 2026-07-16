import type {
  AttendanceRecordItem,
  CategoryManDays,
  LabourSummary,
  SheetRow,
} from "./types";

/** Estimated cost for a headcount: (category day rate ?? 0) × quantity. */
export function estimateCostPaise(dailyRatePaise: number | null, quantity: number): number {
  return (dailyRatePaise ?? 0) * quantity;
}

export function sheetTotals(rows: SheetRow[]): { totalPresent: number; estimatedCostPaise: number } {
  return {
    totalPresent: rows.reduce((s, r) => s + r.quantity, 0),
    estimatedCostPaise: rows.reduce((s, r) => s + estimateCostPaise(r.dailyRatePaise, r.quantity), 0),
  };
}

/**
 * Summarize attendance records over a range — man-days by category, by
 * project, daily trend, and totals. Pure; demo + server both use it.
 */
export function summarize(
  records: AttendanceRecordItem[],
  rateOf: (categoryId: string) => number | null,
): LabourSummary {
  const byCategory = new Map<string, CategoryManDays>();
  const byProject = new Map<string, { projectId: string; projectName: string; manDays: number; estimatedCostPaise: number }>();
  const byDate = new Map<string, number>();

  for (const r of records) {
    const cost = estimateCostPaise(rateOf(r.categoryId), r.quantityPresent);

    const c = byCategory.get(r.categoryId) ?? {
      categoryId: r.categoryId,
      name: r.categoryName,
      color: r.color,
      manDays: 0,
      estimatedCostPaise: 0,
    };
    c.manDays += r.quantityPresent;
    c.estimatedCostPaise += cost;
    byCategory.set(r.categoryId, c);

    const p = byProject.get(r.projectId) ?? {
      projectId: r.projectId,
      projectName: r.projectName,
      manDays: 0,
      estimatedCostPaise: 0,
    };
    p.manDays += r.quantityPresent;
    p.estimatedCostPaise += cost;
    byProject.set(r.projectId, p);

    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.quantityPresent);
  }

  return {
    totalManDays: records.reduce((s, r) => s + r.quantityPresent, 0),
    estimatedCostPaise: [...byCategory.values()].reduce((s, c) => s + c.estimatedCostPaise, 0),
    byCategory: [...byCategory.values()].sort((a, b) => b.manDays - a.manDays),
    byProject: [...byProject.values()].sort((a, b) => b.manDays - a.manDays),
    trend: [...byDate.entries()]
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
