import { describe, it, expect, beforeEach } from "vitest";
import { getReport, REPORTS } from "./registry";
import { procurementApi } from "@/features/procurement/data";
import { laborApi } from "@/features/labor/data";

// Reports run against the demo repositories (localStorage) in the test env.
// Seed the labour + procurement stores first so project `usedPaise` (derived
// from them) is realistic, exactly as it is in the app.
async function seed() {
  await laborApi.getSheet("10000000-0000-0000-0000-000000000001", "2026-07-14"); // seeds categories
  await laborApi.summary({});
  await procurementApi.listPurchaseOrders({});
  await procurementApi.listVendors();
}

beforeEach(() => localStorage.clear());

describe("reports registry", () => {
  it("exposes a flagship Budget vs Actual plus five more", () => {
    expect(REPORTS.map((r) => r.id)).toContain("budget-vs-actual");
    expect(REPORTS.find((r) => r.id === "budget-vs-actual")!.featured).toBe(true);
    expect(REPORTS.length).toBe(6);
  });

  it("procurement report totals equal the shared PO list (single source)", async () => {
    await seed();
    const pos = await procurementApi.listPurchaseOrders({});
    const result = await getReport("procurement")!.run({});
    const expectedTotal = pos.reduce((s, p) => s + p.totalPaise, 0);
    const totalRow = result.rows.find((r) => r.kind === "total")!;
    // Last money column is the grand total.
    expect(totalRow.cells[7]).toBe(expectedTotal);
    expect(result.rows.filter((r) => r.kind !== "total").length).toBe(pos.length);
  });

  it("budget vs actual: labour + procurement === used on every row", async () => {
    await seed();
    const result = await getReport("budget-vs-actual")!.run({});
    for (const row of result.rows.filter((r) => r.kind !== "total")) {
      const labour = Number(row.cells[3]);
      const procurement = Number(row.cells[4]);
      const used = Number(row.cells[5]);
      expect(labour + procurement).toBe(used);
    }
  });

  it("labour cost grand total matches the labour summary source", async () => {
    await seed();
    const summary = await laborApi.summary({});
    const result = await getReport("labour-cost")!.run({});
    const grand = result.rows[result.rows.length - 1];
    expect(grand.kind).toBe("total");
    expect(grand.cells[1]).toBe(summary.totalManDays);
    expect(grand.cells[2]).toBe(summary.estimatedCostPaise);
  });

  it("vendor report outstanding matches the vendor list", async () => {
    await seed();
    const vendors = await procurementApi.listVendors();
    const result = await getReport("vendor-summary")!.run({});
    const expected = vendors.reduce((s, v) => s + Math.max(0, v.outstandingPaise), 0);
    const totalRow = result.rows.find((r) => r.kind === "total")!;
    expect(totalRow.cells[5]).toBe(expected);
  });

  it("scopes a report to one project via filters", async () => {
    await seed();
    const all = await getReport("procurement")!.run({});
    const scoped = await getReport("procurement")!.run({ projectId: "10000000-0000-0000-0000-000000000002" });
    const dataRows = (r: typeof all) => r.rows.filter((x) => x.kind !== "total").length;
    expect(dataRows(scoped)).toBeLessThan(dataRows(all));
  });

  it("reports a clean empty state when nothing is in scope", async () => {
    // No seed → labour summary is empty.
    const result = await getReport("labour-cost")!.run({ dateFrom: "2000-01-01", dateTo: "2000-01-02" });
    expect(result.isEmpty).toBe(true);
  });
});
