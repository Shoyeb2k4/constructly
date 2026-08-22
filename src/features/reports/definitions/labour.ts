import { laborApi } from "@/features/labor/data";
import { projectsApi } from "@/features/projects/data";
import type { ReportDef, ReportResult, ReportRow } from "../types";
import { countKpi, echoFilters, moneyKpi, now } from "./shared";

/**
 * Labour reports.
 *
 * Every figure here is the module's own, in the module's own words: man-days,
 * attendance value, and the caveat that attendance value is not a payable.
 *
 * The load-bearing property is the SNAPSHOT. `laborApi.summary` folds each
 * attendance row's stored `estimatedCostPaise` — quantity × the rate that
 * applied on the day — and never looks up today's rate. That is what stops a
 * rate revision from rewriting last quarter's report, and it is pinned by test.
 */

const labourCost: ReportDef = {
  id: "labour-cost",
  name: "Labour cost",
  question: "How many man-days were worked, and what were they worth, by trade?",
  category: "Labour",
  filters: ["period", "project"],
  defaultPeriod: "THIS_MONTH",
  async run(f, ctx): Promise<ReportResult> {
    const [summary, everSummary, projects] = await Promise.all([
      laborApi.summary({
        projectId: f.projectId || "ALL",
        from: f.dateFrom,
        to: f.dateTo,
      }),
      // Unbounded, for the empty-state distinction only: "no labour in August"
      // and "this company has never recorded attendance" are different
      // statements and must not read the same.
      laborApi.summary({}),
      projectsApi.list({ includeArchived: true }),
    ]);

    const rows: ReportRow[] = [];
    for (const c of summary.byCategory) {
      rows.push({ kind: "group", cells: [c.name, "", ""] });
      for (const s of c.subcategories) {
        rows.push({ cells: [`   ${s.name}`, s.manDays, s.estimatedCostPaise] });
      }
      rows.push({ kind: "total", cells: [`${c.name} total`, c.manDays, c.estimatedCostPaise] });
    }
    rows.push({
      kind: "total",
      cells: ["Grand total", summary.totalManDays, summary.estimatedCostPaise],
    });

    // The canonical trend the labour module already computes — man-days per
    // day, which is what `LabourSummary.trend` carries. A shape over time is
    // the one thing the grouped table genuinely cannot show; the exact figures
    // stay in the rows.
    const points = summary.trend.map((t) => ({ label: t.date, value: t.total }));

    return {
      id: this.id,
      title: "Labour cost",
      subtitle: `${summary.byCategory.length} labour ${summary.byCategory.length === 1 ? "type" : "types"}`,
      generatedAt: now(),
      periodLabel: ctx.period.label,
      activeFilters: echoFilters(f, { project: new Map(projects.map((p) => [p.id, p.name])) }),
      kpis: [
        countKpi("Man-days", summary.totalManDays, "Σ workers present per day"),
        moneyKpi(
          "Attendance value",
          summary.estimatedCostPaise,
          "Quantity × the rate on the day",
        ),
        countKpi("Days with attendance", summary.trend.length),
      ],
      columns: [
        { key: "name", label: "Category / Labour type" },
        { key: "manDays", label: "Man-days", kind: "number" },
        { key: "cost", label: "Attendance value", kind: "money" },
      ],
      rows,
      chart:
        points.length > 1
          ? {
              title: "Man-days worked over the period",
              kind: "number" as const,
              description: `Man-days recorded per day across ${ctx.period.label}, ${summary.totalManDays} in total. Exact figures by labour type are in the table below.`,
              points,
            }
          : undefined,
      note: "Attendance value is what the work recorded came to at the rate that applied on the day. A later rate revision never changes it, and it is not a payable — settlement is what turns it into money owed.",
      isEmpty: summary.totalManDays === 0,
      hasAnyData: everSummary.totalManDays > 0,
    };
  },
};

const labourByContractor: ReportDef = {
  id: "labour-by-contractor",
  name: "Labour by contractor",
  question: "Whose crews did the work, and how much of it was not assigned to anyone?",
  category: "Labour",
  filters: ["period", "project"],
  defaultPeriod: "THIS_MONTH",
  async run(f, ctx): Promise<ReportResult> {
    const [summary, everSummary, projects] = await Promise.all([
      laborApi.summary({ projectId: f.projectId || "ALL", from: f.dateFrom, to: f.dateTo }),
      laborApi.summary({}),
      projectsApi.list({ includeArchived: true }),
    ]);

    const sorted = summary.byContractor
      .slice()
      .sort((a, b) => b.estimatedCostPaise - a.estimatedCostPaise);

    const rows: ReportRow[] = sorted.map((c) => ({
      // Unattributed labour has no contractor record to open, so it gets no
      // link rather than a link that goes nowhere useful.
      href: c.contractorId ? `/labor/contractors/${c.contractorId}` : undefined,
      cells: [c.name, c.manDays, c.estimatedCostPaise],
    }));
    rows.push({
      kind: "total",
      cells: ["Total", summary.totalManDays, summary.estimatedCostPaise],
    });

    const unattributed = sorted.find((c) => !c.contractorId);

    return {
      id: this.id,
      title: "Labour by contractor",
      subtitle: `${sorted.length} ${sorted.length === 1 ? "group" : "groups"}`,
      generatedAt: now(),
      periodLabel: ctx.period.label,
      activeFilters: echoFilters(f, { project: new Map(projects.map((p) => [p.id, p.name])) }),
      kpis: [
        countKpi("Man-days", summary.totalManDays),
        moneyKpi("Attendance value", summary.estimatedCostPaise),
        moneyKpi(
          "Not assigned to a contractor",
          unattributed?.estimatedCostPaise ?? 0,
          "Recorded work with no crew attributed yet",
        ),
      ],
      columns: [
        { key: "contractor", label: "Contractor" },
        { key: "manDays", label: "Man-days", kind: "number" },
        { key: "cost", label: "Attendance value", kind: "money" },
      ],
      rows,
      note: "Labour not assigned to a contractor is recorded work awaiting attribution — it is not lost, and it is not a shortfall.",
      isEmpty: summary.totalManDays === 0,
      hasAnyData: everSummary.totalManDays > 0,
    };
  },
};

export const LABOUR_REPORTS: ReportDef[] = [labourCost, labourByContractor];
