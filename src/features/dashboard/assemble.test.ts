import { describe, it, expect } from "vitest";
import { assembleDashboard, bucketSpendByWeek, weekStart } from "./assemble";
import type { RawDashboardData, RawProject } from "./types";

const today = "2026-07-15"; // a Wednesday

function project(over: Partial<RawProject> & Pick<RawProject, "id" | "name">): RawProject {
  return {
    code: "PRJ-0001",
    stage: "CONSTRUCTION",
    archived: false,
    budgetPaise: 10_000_000,
    laborPaise: 2_000_000,
    procurementPaise: 3_000_000,
    expectedCompletionDate: "2026-12-31",
    deadlines: [],
    lastActivityAt: today + "T00:00:00.000Z",
    ...over,
  };
}

function raw(over: Partial<RawDashboardData> = {}): RawDashboardData {
  return {
    projects: [],
    spendEntries: [],
    labourEntries: [],
    pendingPOs: [],
    procurementPOs: [],
    procurementPayments: [],
    approvalRequired: false,
    activity: [],
    today,
    ...over,
  };
}

describe("weekStart", () => {
  it("returns the Monday of the week", () => {
    expect(weekStart("2026-07-15")).toBe("2026-07-13"); // Mon
    expect(weekStart("2026-07-13")).toBe("2026-07-13");
  });
});

describe("bucketSpendByWeek", () => {
  it("produces 8 weekly buckets ending this week", () => {
    const b = bucketSpendByWeek([{ date: today, laborPaise: 100, procurementPaise: 200 }], today);
    expect(b).toHaveLength(8);
    expect(b[7].weekStart).toBe("2026-07-13");
    expect(b[7].laborPaise).toBe(100);
    expect(b[7].procurementPaise).toBe(200);
  });
  it("ignores entries outside the window", () => {
    const b = bucketSpendByWeek([{ date: "2020-01-01", laborPaise: 999, procurementPaise: 0 }], today);
    expect(b.reduce((s, w) => s + w.laborPaise, 0)).toBe(0);
  });
});

describe("assembleDashboard", () => {
  it("flags an empty company", () => {
    expect(assembleDashboard(raw()).isEmpty).toBe(true);
  });

  it("counts active projects (excludes closed + archived)", () => {
    const snap = assembleDashboard(
      raw({
        projects: [
          project({ id: "1", name: "A" }),
          project({ id: "2", name: "B", stage: "CLOSED" }),
          project({ id: "3", name: "C", archived: true }),
        ],
      }),
    );
    expect(snap.kpis.activeProjects).toBe(1);
  });

  it("detects overdue projects and over-budget warnings", () => {
    const snap = assembleDashboard(
      raw({
        projects: [
          project({ id: "1", name: "Late", expectedCompletionDate: "2026-07-01" }),
          project({ id: "2", name: "Hot", budgetPaise: 4_000_000 }), // used 5M > 4M
        ],
      }),
    );
    expect(snap.kpis.overdue).toBe(1);
    expect(snap.attention.overdueProjects[0].name).toBe("Late");
    expect(snap.attention.budgetWarnings.some((b) => b.name === "Hot")).toBe(true);
  });

  it("surfaces upcoming deadlines within 14 days", () => {
    const snap = assembleDashboard(
      raw({
        projects: [
          project({
            id: "1",
            name: "A",
            deadlines: [
              { id: "d1", title: "Soon", dueDate: "2026-07-20", completedAt: null },
              { id: "d2", title: "Far", dueDate: "2026-09-01", completedAt: null },
              { id: "d3", title: "Done", dueDate: "2026-07-18", completedAt: today },
            ],
          }),
        ],
      }),
    );
    expect(snap.attention.upcomingDeadlines.map((d) => d.title)).toEqual(["Soon"]);
  });

  it("flags stale projects with no recent activity", () => {
    const snap = assembleDashboard(
      raw({ projects: [project({ id: "1", name: "Quiet", lastActivityAt: "2026-06-01T00:00:00Z" })] }),
    );
    expect(snap.attention.staleProjects[0].name).toBe("Quiet");
  });

  it("sums budget and computes cost split from active projects", () => {
    const snap = assembleDashboard(raw({ projects: [project({ id: "1", name: "A" })] }));
    expect(snap.kpis.budgetUsedPaise).toBe(5_000_000);
    expect(snap.costSplit).toEqual({ laborPaise: 2_000_000, procurementPaise: 3_000_000 });
  });

  it("builds the labour widget from subcategory entries grouped by category", () => {
    const snap = assembleDashboard(
      raw({
        labourEntries: [
          { date: today, categoryName: "Carpenter", subcategoryName: "Main Carpenter", color: "#8B5CF6", quantityPresent: 12, estimatedCostPaise: 12 * 90000 },
          { date: today, categoryName: "Carpenter", subcategoryName: "Carpenter Helper", color: "#8B5CF6", quantityPresent: 8, estimatedCostPaise: 8 * 55000 },
          { date: today, categoryName: "Mason", subcategoryName: "Mason", color: "#3B82F6", quantityPresent: 9, estimatedCostPaise: 9 * 85000 },
          { date: "2026-07-14", categoryName: "Carpenter", subcategoryName: "Main Carpenter", color: "#8B5CF6", quantityPresent: 10, estimatedCostPaise: 10 * 90000 },
        ],
      }),
    );
    expect(snap.kpis.todaysLaborCount).toBe(29);
    expect(snap.kpis.todaysWagesPaise).toBe(12 * 90000 + 8 * 55000 + 9 * 85000);
    expect(snap.labour.todayCostPaise).toBe(snap.kpis.todaysWagesPaise);
    expect(snap.labour.manDays30).toBe(39);
    expect(snap.labour.todayByCategory[0]).toEqual({
      name: "Carpenter",
      color: "#8B5CF6",
      quantity: 20,
      subcategories: [
        { name: "Main Carpenter", quantity: 12 },
        { name: "Carpenter Helper", quantity: 8 },
      ],
    });
    expect(snap.labour.trend).toEqual([
      { date: "2026-07-14", total: 10 },
      { date: today, total: 29 },
    ]);
  });

  it("assembles the procurement widget: spend, GST, outstanding, rollups, deliveries, trend", () => {
    const po = (over: Partial<import("./types").RawProcurementPO>): import("./types").RawProcurementPO => ({
      id: "po", poNumber: "PO", vendorId: "v1", vendorName: "Steelco", projectId: "p1", projectName: "A",
      projectCode: "PRJ-1", status: "APPROVED", purchaseDate: "2026-07-01", expectedDelivery: null,
      gstPaise: 0, totalPaise: 0, paidPaise: 0, createdAt: "2026-07-01T00:00:00Z", lines: [], ...over,
    });
    const snap = assembleDashboard(
      raw({
        approvalRequired: false,
        procurementPOs: [
          po({ id: "po1", poNumber: "PO-1", vendorId: "v1", vendorName: "Steelco", status: "APPROVED", purchaseDate: "2026-07-01", expectedDelivery: "2026-07-20", gstPaise: 54_000, totalPaise: 300_000, paidPaise: 100_000, lines: [{ material: "TMT Steel", category: "Steel", amountPaise: 246_000 }] }),
          po({ id: "po2", poNumber: "PO-2", vendorId: "v2", vendorName: "Cementco", projectId: "p2", projectName: "B", projectCode: "PRJ-2", status: "APPROVED", purchaseDate: "2026-06-10", gstPaise: 12_000, totalPaise: 100_000, paidPaise: 100_000, lines: [{ material: "OPC Cement", category: "Cement", amountPaise: 88_000 }] }),
          po({ id: "po3", poNumber: "PO-3", vendorId: "v1", vendorName: "Steelco", status: "DRAFT", purchaseDate: "2026-07-10", totalPaise: 999, lines: [{ material: "TMT Steel", category: "Steel", amountPaise: 999 }] }),
        ],
        procurementPayments: [
          { vendorId: "v1", amountPaise: 100_000 },
          { vendorId: "v2", amountPaise: 100_000 },
        ],
      }),
    );
    const pr = snap.procurement;
    // Draft excluded from spend + GST.
    expect(pr.spendPaise).toBe(400_000);
    expect(pr.gstPaidPaise).toBe(66_000); // 54k + 12k (draft excluded)
    // Steelco: 300k purchased − 100k paid = 200k outstanding; Cementco fully paid.
    expect(pr.outstandingPaise).toBe(200_000);
    expect(pr.pendingPaymentsCount).toBe(1); // only po1 has a balance
    expect(pr.outstandingVendors).toEqual([{ vendorId: "v1", name: "Steelco", amountPaise: 200_000 }]);
    expect(pr.topVendors[0]).toEqual({ vendorId: "v1", name: "Steelco", amountPaise: 300_000 });
    // Spend by project (grand totals, draft excluded).
    expect(pr.spendByProject).toEqual([
      { projectId: "p1", name: "A", code: "PRJ-1", amountPaise: 300_000 },
      { projectId: "p2", name: "B", code: "PRJ-2", amountPaise: 100_000 },
    ]);
    // Top materials by taxable amount (draft excluded).
    // An unlinked fixture line: its own legacy bucket, labelled by its snapshot.
    expect(pr.topMaterials[0]).toEqual({
      key: "legacy:tmt steel",
      materialId: null,
      material: "TMT Steel",
      linked: false,
      archived: false,
      category: "Steel",
      amountPaise: 246_000,
    });
    // Upcoming delivery: po1 expected 2026-07-20 (5 days from today 2026-07-15).
    expect(pr.upcomingDeliveries).toEqual([
      { poId: "po1", poNumber: "PO-1", vendorName: "Steelco", projectName: "A", expectedDelivery: "2026-07-20", daysUntil: 5, totalPaise: 300_000 },
    ]);
    expect(pr.recentPOs[0].poNumber).toBe("PO-3"); // most recent by date
    expect(pr.monthlyTrend).toHaveLength(6);
    expect(pr.monthlyTrend.find((m) => m.month === "2026-07")!.procurementPaise).toBe(300_000);
  });
});
