import type {
  AttendanceRecordItem,
  CategoryManDays,
  ContractorManDays,
  LabourSummary,
  SheetGroup,
  SheetRow,
} from "./types";

/** Stable key for the "no contractor" (legacy/unattributed) rollup bucket. */
const UNATTRIBUTED = "__unattributed__";

/** Estimated cost for a headcount: (day rate ?? 0) × quantity. Rounded because
 *  half-day quantities (0.5 steps) can otherwise yield fractional paise. */
export function estimateCostPaise(dailyRatePaise: number | null, quantity: number): number {
  return Math.round((dailyRatePaise ?? 0) * quantity);
}

/**
 * The stable identity of one sheet group.
 *
 * `contractorId` ALONE is not unique. `buildSheet` legitimately emits two groups
 * for the same contractor: the configured one (their current labour types and
 * agreements) and a synthesized historical one holding rows recorded against a
 * contractor/type/agreement combination that has since been de-configured. Both
 * carry the same `contractorId`, so keying React on it alone made the two
 * collide — React may then reuse, omit or duplicate the wrong subtree, which on
 * an attendance sheet means a headcount shown against the wrong row. The
 * collapse state was keyed on the same value, so collapsing one closed both.
 *
 * `configured` is the missing half and is enough: there is at most one configured
 * group per contractor (one ProjectContractor row) and at most one historical
 * group per contractor (they are folded into a Map keyed on contractor id). An
 * array index would also be unique, but it is not STABLE — inserting a group
 * above shifts every key below it, which is the bug this exists to prevent.
 */
export function groupKey(g: Pick<SheetGroup, "contractorId" | "configured">): string {
  return `${g.contractorId ?? "__unattributed__"}|${g.configured ? "configured" : "historical"}`;
}

export function rowTotals(rows: SheetRow[]): { totalPresent: number; estimatedCostPaise: number } {
  return {
    totalPresent: rows.reduce((s, r) => s + r.quantity, 0),
    estimatedCostPaise: rows.reduce((s, r) => s + estimateCostPaise(r.dailyRatePaise, r.quantity), 0),
  };
}

export function sheetTotals(groups: SheetGroup[]): { totalPresent: number; estimatedCostPaise: number } {
  return {
    totalPresent: groups.reduce((s, g) => s + g.totalPresent, 0),
    estimatedCostPaise: groups.reduce((s, g) => s + g.estimatedCostPaise, 0),
  };
}

/**
 * Summarize attendance records — man-days by category (with subcategory
 * breakdown), by project, daily trend, and totals. Costs come from each
 * record's stored snapshot (ADR-0022). Pure; demo + server both use it.
 */
export function summarize(records: AttendanceRecordItem[]): LabourSummary {
  const byContractor = new Map<string, ContractorManDays>();
  const byCategory = new Map<string, CategoryManDays>();
  const byProject = new Map<string, { projectId: string; projectName: string; manDays: number; estimatedCostPaise: number }>();
  const byDate = new Map<string, number>();

  for (const r of records) {
    const cost = r.estimatedCostPaise;

    const ck = r.contractorId ?? UNATTRIBUTED;
    const con = byContractor.get(ck) ?? {
      contractorId: r.contractorId,
      name: r.contractorName ?? "Unattributed",
      manDays: 0,
      estimatedCostPaise: 0,
    };
    con.manDays += r.quantityPresent;
    con.estimatedCostPaise += cost;
    byContractor.set(ck, con);

    const c = byCategory.get(r.categoryId) ?? {
      categoryId: r.categoryId,
      name: r.categoryName,
      color: r.color,
      manDays: 0,
      estimatedCostPaise: 0,
      subcategories: [],
    };
    c.manDays += r.quantityPresent;
    c.estimatedCostPaise += cost;
    let sub = c.subcategories.find((s) => s.subcategoryId === r.subcategoryId);
    if (!sub) {
      sub = { subcategoryId: r.subcategoryId, name: r.subcategoryName, manDays: 0, estimatedCostPaise: 0 };
      c.subcategories.push(sub);
    }
    sub.manDays += r.quantityPresent;
    sub.estimatedCostPaise += cost;
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

  for (const c of byCategory.values()) {
    c.subcategories.sort((a, b) => b.manDays - a.manDays);
  }

  return {
    totalManDays: records.reduce((s, r) => s + r.quantityPresent, 0),
    estimatedCostPaise: [...byCategory.values()].reduce((s, c) => s + c.estimatedCostPaise, 0),
    byContractor: [...byContractor.values()].sort((a, b) => b.manDays - a.manDays),
    byCategory: [...byCategory.values()].sort((a, b) => b.manDays - a.manDays),
    byProject: [...byProject.values()].sort((a, b) => b.manDays - a.manDays),
    trend: [...byDate.entries()]
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
