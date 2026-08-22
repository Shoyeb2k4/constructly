import { describe, it, expect, beforeEach } from "vitest";
import { getReport, periodFor, REPORTS, reportsByCategory, runReport } from "./registry";
import { procurementApi } from "@/features/procurement/data";
import { laborApi } from "@/features/labor/data";
import { projectsApi } from "@/features/projects/data";
import { budgetApi } from "@/features/budget/data";
import { contractorsApi } from "@/features/contractors/data";
import { contractsApi } from "@/features/contracts/data";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";
import type { ReportContext, ReportFilters } from "./types";

/**
 * Reports must never become a second calculation path.
 *
 * These tests exist to prove that claim rather than assert it: for each report,
 * the figures it prints are compared against the canonical source that owns
 * them. If someone later reimplements an aggregate inside a report definition,
 * the number will drift and one of these fails.
 */

const TODAY = "2026-08-20";

const CTX: Omit<ReportContext, "period"> = {
  today: TODAY,
  userId: "00000000-0000-0000-0000-000000000001",
  isOwner: true,
  permissions: [...ALL_PERMISSIONS],
};

const run = (id: string, f: ReportFilters = {}) => runReport(id, f, CTX);

/**
 * Reports run against the demo repositories (localStorage) here. Each module
 * seeds its own store on first read, so touching them first mirrors what an
 * app session does — the fresh-session tests below deliberately do NOT.
 */
async function seed() {
  await laborApi.getSheet("10000000-0000-0000-0000-000000000001", "2026-07-14");
  await laborApi.summary({});
  await procurementApi.listPurchaseOrders({});
  await procurementApi.listVendors();
  await contractorsApi.listContractors({});
}

beforeEach(() => localStorage.clear());

describe("catalogue", () => {
  it("groups every report under a business question", () => {
    const groups = reportsByCategory();
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.flatMap((g) => g.reports).length).toBe(REPORTS.length);
    for (const r of REPORTS) {
      // A name is not a question. Each entry must state what it answers.
      expect(r.question.length, `${r.id} has no question`).toBeGreaterThan(20);
      expect(r.question, `${r.id}'s question is a restatement of its name`).not.toBe(r.name);
    }
  });

  it("leads with money and keeps the flagships", () => {
    expect(reportsByCategory()[0].category).toBe("Payments");
    expect(REPORTS.filter((r) => r.featured).map((r) => r.id).sort()).toEqual([
      "budget-vs-actual",
      "contractor-position",
      "payments",
    ]);
  });

  it("gives every report a unique id", () => {
    expect(new Set(REPORTS.map((r) => r.id)).size).toBe(REPORTS.length);
  });
});

describe("period resolution", () => {
  it("defaults a period-taking report to its own default", () => {
    expect(periodFor(getReport("payments")!, {}, TODAY)).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("pins a report with no period filter to all time", () => {
    // Reconciliation and budget are cumulative by definition; a month bound
    // would silently change what they mean.
    expect(periodFor(getReport("contractor-position")!, { period: "TODAY" }, TODAY)).toMatchObject({
      from: null,
      to: null,
    });
  });

  it("honours raw bounds from an older deep link", () => {
    expect(
      periodFor(getReport("payments")!, { dateFrom: "2026-01-01", dateTo: "2026-01-31" }, TODAY),
    ).toMatchObject({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("labels every result with the period it covers", async () => {
    await seed();
    for (const def of REPORTS) {
      const result = await run(def.id);
      expect(result.periodLabel, `${def.id} has no period label`).toBeTruthy();
    }
  });
});

describe("canonical arithmetic — projects", () => {
  it("budget vs actual reads the shared budget source, not a subtraction", async () => {
    await seed();
    const [projects, spend, result] = await Promise.all([
      projectsApi.list({ includeArchived: true }),
      budgetApi.spendByProject(),
      run("budget-vs-actual"),
    ]);
    const byName = new Map(projects.map((p) => [p.name, p.id]));
    for (const row of result.rows.filter((r) => r.kind !== "total")) {
      const id = byName.get(String(row.cells[1]))!;
      const s = spend[id] ?? { laborPaise: 0, procurementPaise: 0 };
      expect(Number(row.cells[3])).toBe(s.laborPaise);
      expect(Number(row.cells[4])).toBe(s.procurementPaise);
      // And the identity still holds on every row.
      expect(Number(row.cells[3]) + Number(row.cells[4])).toBe(Number(row.cells[5]));
    }
  });

  it("project summary totals equal the project list", async () => {
    await seed();
    const projects = await projectsApi.list({ includeArchived: true });
    const result = await run("project-summary");
    const total = result.rows.find((r) => r.kind === "total")!;
    expect(total.cells[4]).toBe(projects.reduce((s, p) => s + p.budgetPaise, 0));
    expect(total.cells[5]).toBe(projects.reduce((s, p) => s + p.usedPaise, 0));
  });
});

describe("canonical arithmetic — labour", () => {
  it("grand total matches the labour summary source exactly", async () => {
    await seed();
    const summary = await laborApi.summary({});
    const result = await run("labour-cost", { period: "ALL_TIME" });
    const grand = result.rows[result.rows.length - 1];
    expect(grand.kind).toBe("total");
    expect(grand.cells[1]).toBe(summary.totalManDays);
    expect(grand.cells[2]).toBe(summary.estimatedCostPaise);
  });

  it("labour by contractor sums to the same attendance value", async () => {
    await seed();
    const summary = await laborApi.summary({});
    const result = await run("labour-by-contractor", { period: "ALL_TIME" });
    const total = result.rows.find((r) => r.kind === "total")!;
    expect(total.cells[1]).toBe(summary.totalManDays);
    expect(total.cells[2]).toBe(summary.estimatedCostPaise);
    // Rows partition the whole: nothing double-counted, nothing dropped.
    const rows = result.rows.filter((r) => r.kind !== "total");
    expect(rows.reduce((s, r) => s + Number(r.cells[2]), 0)).toBe(summary.estimatedCostPaise);
  });
});

describe("canonical arithmetic — contractors", () => {
  it("takes Due and Ahead from the reconciliation engine and never nets them", async () => {
    await seed();
    const contractors = await contractorsApi.listContractors({ status: "ALL" });
    const result = await run("contractor-position");
    const total = result.rows.find((r) => r.kind === "total")!;

    let due = 0;
    let ahead = 0;
    let earned = 0;
    for (const c of contractors) {
      const profile = await contractsApi.getContractorProfile(c.id);
      if (!profile) continue;
      due += profile.lifetime.totalCurrentDuePaise;
      ahead += profile.lifetime.totalAdvanceCreditPaise;
      earned += profile.lifetime.totalEarnedPaise;
    }
    expect(total.cells[3]).toBe(earned);
    expect(total.cells[7]).toBe(due);
    expect(total.cells[8]).toBe(ahead);
    // Two separate columns, never one netted position.
    const labels = result.columns.map((c) => c.label);
    expect(labels).toContain("Currently due");
    expect(labels).toContain("Paid ahead");
    expect(labels.some((l) => /net/i.test(l))).toBe(false);
  });

  it("advances & settlements match the contractors cost summary", async () => {
    await seed();
    const cost = await contractorsApi.contractorCostSummary();
    const result = await run("contractor-settlements");
    const total = result.rows.find((r) => r.kind === "total")!;
    expect(total.cells[2]).toBe(cost.reduce((s, c) => s + c.totalBillPaise, 0));
    expect(total.cells[4]).toBe(cost.reduce((s, c) => s + c.totalPaidPaise, 0));
    expect(total.cells[5]).toBe(cost.reduce((s, c) => s + c.advanceBalancePaise, 0));
  });
});

describe("canonical arithmetic — procurement", () => {
  it("purchase-order totals equal the shared PO list", async () => {
    await seed();
    const pos = await procurementApi.listPurchaseOrders({});
    const result = await run("procurement", { period: "ALL_TIME" });
    const total = result.rows.find((r) => r.kind === "total")!;
    expect(total.cells[7]).toBe(pos.reduce((s, p) => s + p.totalPaise, 0));
    expect(total.cells[8]).toBe(pos.reduce((s, p) => s + p.paidPaise, 0));
    expect(result.rows.filter((r) => r.kind !== "total").length).toBe(pos.length);
  });

  it("vendor still-owed matches the vendor list", async () => {
    await seed();
    const vendors = await procurementApi.listVendors();
    const result = await run("vendor-summary");
    const total = result.rows.find((r) => r.kind === "total")!;
    expect(total.cells[5]).toBe(
      vendors.reduce((s, v) => s + Math.max(0, v.outstandingPaise), 0),
    );
  });

  it("says nothing about delivery, which the domain does not record", async () => {
    await seed();
    const result = await run("procurement", { period: "ALL_TIME" });
    // Column labels only — the note deliberately SAYS the word "delivery" in
    // order to deny it, so including it here would assert against the honesty
    // the note exists to provide.
    const labels = result.columns.map((c) => c.label).join(" ");
    expect(/delivered|received|on time|late/i.test(labels)).toBe(false);
    expect(result.note).toMatch(/records no goods receipt/);
  });
});

describe("filters", () => {
  it("scopes a report to one project", async () => {
    await seed();
    const all = await run("procurement", { period: "ALL_TIME" });
    const scoped = await run("procurement", {
      period: "ALL_TIME",
      projectId: "10000000-0000-0000-0000-000000000002",
    });
    const dataRows = (r: typeof all) => r.rows.filter((x) => x.kind !== "total").length;
    expect(dataRows(scoped)).toBeLessThan(dataRows(all));
  });

  it("echoes the active filters so an export can describe itself", async () => {
    await seed();
    const projects = await projectsApi.list({ includeArchived: true });
    const result = await run("procurement", { period: "ALL_TIME", projectId: projects[0].id });
    expect(result.activeFilters).toContainEqual({ label: "Project", value: projects[0].name });
    // And a report with no filters applied says so rather than echoing nothing
    // that looks like a filter.
    expect((await run("procurement", { period: "ALL_TIME" })).activeFilters).toEqual([]);
  });
});

describe("empty states", () => {
  it("tells a quiet period apart from a company with no records", async () => {
    await seed();
    const quiet = await run("labour-cost", { period: "CUSTOM", dateFrom: "2001-01-01", dateTo: "2001-01-02" });
    expect(quiet.isEmpty).toBe(true);
    // The company plainly HAS labour history — just not in 2001.
    expect(quiet.hasAnyData).toBe(true);
  });

  it("reports a genuinely empty company as having no data at all", async () => {
    for (const k of [
      "constructly.demo.labourAttendance.v2",
      "constructly.demo.labourCategories.v2",
      "constructly.demo.labourSubcategories.v2",
      "constructly.demo.projects.v1",
    ]) {
      localStorage.setItem(k, "[]");
    }
    const result = await run("labour-cost", { period: "ALL_TIME" });
    expect(result.isEmpty).toBe(true);
    expect(result.hasAnyData).toBe(false);
  });
});

describe("a fresh session, before any module has been visited", () => {
  // Every module's demo repository seeds lazily on first read. A report that
  // reaches for a raw store instead of the module's own API reports zero and
  // then changes underneath the user — the defect Phases 5 and 6 both found.
  it.each([
    "payments",
    "budget-vs-actual",
    "project-summary",
    "labour-cost",
    "labour-by-contractor",
    "contractor-position",
    "contractor-settlements",
    "procurement",
    "vendor-summary",
    "deadlines",
  ])("%s reports real data with no store primed", async (id) => {
    localStorage.clear();
    const result = await run(id, { period: "ALL_TIME" });
    expect(result.hasAnyData, `${id} reported an empty company on a fresh session`).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});
