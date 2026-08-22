import { describe, it, expect, beforeEach } from "vitest";
// From the pure model, NOT `exporters.ts`: that module pulls jsPDF, SheetJS and
// the branded-PDF helper, and the last of those drags in Prisma — which loads
// `.env` on import and silently flips this file out of demo mode.
import { buildCsv, buildExportRows, CRLF } from "./export-model";
import { runReport } from "./registry";
import { canExportReport, canViewReport, reportClass } from "./report-meta";
import { projectsApi } from "@/features/projects/data";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";
import { toRupees } from "@/lib/money";
import type { ReportContext, ReportFilters } from "./types";

/**
 * An export is the report — not a subset, not a superset.
 *
 * Two things are being defended. First, that a file cannot contain a row its
 * owner could not see on screen: the export is built from the SAME `run` under
 * the SAME filters, so scoping is structural rather than a second filter that
 * could drift. Second, that a spreadsheet found in someone's downloads six
 * months later still says what it is a report OF — company, period, filters,
 * generated-at — because there is no toolbar next to it to explain.
 */

const TODAY = "2026-08-20";
const CTX: Omit<ReportContext, "period"> = {
  today: TODAY,
  userId: "00000000-0000-0000-0000-000000000001",
  isOwner: true,
  permissions: [...ALL_PERMISSIONS],
};
const run = (id: string, f: ReportFilters = {}) => runReport(id, f, CTX);
const COMPANY = "Meridian Build Co.";

const withPerms = (...granted: Permission[]) => {
  const set = new Set<string>(granted);
  return (p: Permission) => set.has(p);
};

beforeEach(() => localStorage.clear());

describe("an export describes itself", () => {
  it("carries company, report, period, filters and generated-at", async () => {
    const projects = await projectsApi.list({ includeArchived: true });
    const result = await run("procurement", {
      period: "ALL_TIME",
      projectId: projects[0].id,
    });
    const rows = buildExportRows(result, COMPANY);
    const flat = rows.map((r) => r.join("|"));

    expect(flat[0]).toBe(COMPANY);
    expect(flat[1]).toBe(result.title);
    expect(flat).toContain(`Period|${result.periodLabel}`);
    expect(flat).toContain(`Project|${projects[0].name}`);
    expect(flat.some((l) => l.startsWith("Generated|"))).toBe(true);
  });

  it("says so explicitly when no filter is applied", async () => {
    const result = await run("procurement", { period: "ALL_TIME" });
    const flat = buildExportRows(result, COMPANY).map((r) => r.join("|"));
    // "Filters: None" rather than an absent line that reads as a filtered file.
    expect(flat).toContain("Filters|None");
  });

  it("carries the honest note where the report has one", async () => {
    const result = await run("payments", { period: "ALL_TIME" });
    const text = buildCsv(result, COMPANY);
    expect(text).toContain("record no payment mode");
  });
});

describe("an export contains exactly the rows on screen", () => {
  it.each([
    "payments",
    "budget-vs-actual",
    "project-summary",
    "labour-cost",
    "contractor-position",
    "procurement",
    "vendor-summary",
  ])("%s exports every row and no others", async (id) => {
    const result = await run(id, { period: "ALL_TIME" });
    const rows = buildExportRows(result, COMPANY);
    // Header row index, then one line per report row (group rows collapse to
    // a single label cell, which is still one line).
    const headerIdx = rows.findIndex((r) => r[0] === result.columns[0].label);
    expect(headerIdx).toBeGreaterThan(0);
    const noteLines = result.note ? 2 : 0;
    const dataLines = rows.length - headerIdx - 1 - noteLines;
    expect(dataLines).toBe(result.rows.length);
  });

  it("narrows the export when the report is narrowed", async () => {
    const all = await run("procurement", { period: "ALL_TIME" });
    const scoped = await run("procurement", {
      period: "ALL_TIME",
      projectId: "10000000-0000-0000-0000-000000000002",
    });
    expect(buildExportRows(scoped, COMPANY).length).toBeLessThan(
      buildExportRows(all, COMPANY).length,
    );
  });

  it("respects the period, so an export cannot leak another month", async () => {
    const quiet = await run("payments", {
      period: "CUSTOM",
      dateFrom: "2001-01-01",
      dateTo: "2001-12-31",
    });
    const rows = buildExportRows(quiet, COMPANY);
    const headerIdx = rows.findIndex((r) => r[0] === quiet.columns[0].label);
    const noteLines = quiet.note ? 2 : 0;
    expect(rows.length - headerIdx - 1 - noteLines).toBe(quiet.rows.length);
    expect(quiet.rows.filter((r) => r.kind !== "total")).toHaveLength(0);
  });
});

describe("spreadsheet cells stay usable", () => {
  it("writes money as a NUMBER in rupees, not a formatted string", async () => {
    const result = await run("procurement", { period: "ALL_TIME" });
    const rows = buildExportRows(result, COMPANY);
    const headerIdx = rows.findIndex((r) => r[0] === result.columns[0].label);
    const moneyIdx = result.columns.findIndex((c) => c.kind === "money");
    const firstData = result.rows.find((r) => r.kind !== "group" && r.kind !== "total")!;
    const exported = rows[headerIdx + 1][moneyIdx];

    expect(typeof exported).toBe("number");
    expect(exported).toBe(toRupees(Number(firstData.cells[moneyIdx])));
    // Never a display string — summing the column must work in the spreadsheet.
    expect(String(exported)).not.toContain("₹");
    expect(String(exported)).not.toContain(",");
  });

  it("quotes CSV cells that contain a comma, quote or newline", async () => {
    const result = await run("payments", { period: "ALL_TIME" });
    const csv = buildCsv(result, COMPANY);
    // The note contains commas and must survive as ONE field.
    const noteLine = csv.split(CRLF).find((l) => l.includes("payment mode"));
    expect(noteLine!.startsWith('"')).toBe(true);
    expect(noteLine!.endsWith('"')).toBe(true);
  });

  it("uses CRLF line endings", async () => {
    const result = await run("vendor-summary");
    expect(buildCsv(result, COMPANY)).toContain(CRLF);
  });
});

describe("export permissions", () => {
  it("requires reports.export on top of the ability to view", () => {
    const viewerOnly = withPerms("reports.view", "reports.view_operational");
    expect(canViewReport(viewerOnly, "procurement")).toBe(true);
    // Viewing never implies exporting — the data must not leave on a view grant.
    expect(canExportReport(viewerOnly, "procurement")).toBe(false);

    const exporter = withPerms("reports.view", "reports.view_operational", "reports.export");
    expect(canExportReport(exporter, "procurement")).toBe(true);
  });

  it("will not export a financial report to an operational-only holder", () => {
    const operational = withPerms(
      "reports.view",
      "reports.view_operational",
      "reports.export",
    );
    for (const id of ["payments", "budget-vs-actual", "contractor-position"]) {
      expect(reportClass(id)).toBe("financial");
      expect(canViewReport(operational, id), `${id} was viewable`).toBe(false);
      expect(canExportReport(operational, id), `${id} was exportable`).toBe(false);
    }
  });

  it("grants both classes through reports.view_all", () => {
    const all = withPerms("reports.view", "reports.view_all", "reports.export");
    for (const id of ["payments", "procurement", "contractor-position", "deadlines"]) {
      expect(canViewReport(all, id)).toBe(true);
      expect(canExportReport(all, id)).toBe(true);
    }
  });

  it("grants nothing without reports.view", () => {
    const none = withPerms("reports.view_all", "reports.export", "reports.view_financial");
    expect(canViewReport(none, "payments")).toBe(false);
    expect(canExportReport(none, "payments")).toBe(false);
  });
});
