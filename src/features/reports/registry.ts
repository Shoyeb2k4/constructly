import { resolvePeriod } from "@/lib/period";
import { PROJECT_REPORTS } from "./definitions/projects";
import { LABOUR_REPORTS } from "./definitions/labour";
import { CONTRACTOR_REPORTS } from "./definitions/contractors";
import { PROCUREMENT_REPORTS } from "./definitions/procurement";
import { PAYMENT_REPORTS } from "./definitions/payments";
import type {
  ReportCategory,
  ReportContext,
  ReportDef,
  ReportFilters,
  ReportResult,
} from "./types";

/**
 * The report catalogue.
 *
 * Grouped by the BUSINESS QUESTION each report answers rather than by the table
 * it reads, because "which vendors do we owe" and "what did we order" are
 * different questions even though both come out of purchase orders.
 *
 * Every entry's `run` calls its source module's own repository and aggregation.
 * Nothing in this directory owns a financial formula.
 */
export const REPORTS: ReportDef[] = [
  ...PAYMENT_REPORTS,
  ...PROJECT_REPORTS,
  ...CONTRACTOR_REPORTS,
  ...LABOUR_REPORTS,
  ...PROCUREMENT_REPORTS,
];

/** Catalogue order. Money first, because that is what people open Reports for. */
export const REPORT_CATEGORY_ORDER: ReportCategory[] = [
  "Payments",
  "Projects",
  "Contractors",
  "Labour",
  "Procurement",
];

export const CATEGORY_BLURB: Record<ReportCategory, string> = {
  Payments: "Cash that actually moved — to contractors and to vendors.",
  Projects: "Budget position, utilisation and what is falling due.",
  Contractors: "Commercial position on agreements, plus advances and settlements.",
  Labour: "Man-days worked and what the recorded work came to.",
  Procurement: "What was ordered, from whom, and what is still owed.",
};

export function getReport(id: string): ReportDef | undefined {
  return REPORTS.find((r) => r.id === id);
}

export function reportsByCategory(defs: ReportDef[] = REPORTS) {
  return REPORT_CATEGORY_ORDER.map((category) => ({
    category,
    blurb: CATEGORY_BLURB[category],
    reports: defs.filter((r) => r.category === category),
  })).filter((g) => g.reports.length > 0);
}

/**
 * Resolve a report's period from its filters.
 *
 * The preset wins when present; otherwise raw `dateFrom`/`dateTo` from the URL
 * are honoured so an old deep link still means what it meant. A report that
 * takes no period filter is pinned to ALL_TIME — its own `periodLabel` then
 * says what it actually covers ("Project lifetime", "Agreement lifetime")
 * rather than pretending to a range it never applied.
 */
export function periodFor(def: ReportDef, filters: ReportFilters, today: string) {
  if (!def.filters.includes("period")) return resolvePeriod("ALL_TIME", today);
  if (filters.period) {
    return resolvePeriod(filters.period, today, { from: filters.dateFrom, to: filters.dateTo });
  }
  if (filters.dateFrom || filters.dateTo) {
    return resolvePeriod("CUSTOM", today, { from: filters.dateFrom, to: filters.dateTo });
  }
  return resolvePeriod(def.defaultPeriod ?? "THIS_MONTH", today);
}

/**
 * Run a report.
 *
 * The single entry point, so the period is resolved in ONE place and every
 * report receives concrete bounds. A definition never sees a preset — which is
 * what lets a report push its period straight into a server query instead of
 * fetching a lifetime and filtering it in the browser.
 */
export async function runReport(
  id: string,
  filters: ReportFilters,
  ctx: Omit<ReportContext, "period">,
): Promise<ReportResult> {
  const def = getReport(id);
  if (!def) throw new Error("UNKNOWN_REPORT");
  const period = periodFor(def, filters, ctx.today);
  // Bounds are resolved here and passed down, so `run` receives dates, never a
  // preset — and the dates it receives are the dates its figures are labelled
  // with.
  return def.run(
    { ...filters, dateFrom: period.from ?? undefined, dateTo: period.to ?? undefined },
    { ...ctx, period },
  );
}
