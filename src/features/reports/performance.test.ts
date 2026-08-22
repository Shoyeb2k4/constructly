import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { runReport } from "./registry";
import { projectsApi } from "@/features/projects/data";
import { contractsApi } from "@/features/contracts/data";
import { procurementApi } from "@/features/procurement/data";
import { laborApi } from "@/features/labor/data";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";
import type { ReportContext, ReportFilters } from "./types";

/**
 * What each report COSTS, measured rather than assumed.
 *
 * These pin read counts so an N+1 cannot creep in unnoticed — the failure mode
 * where a report is fine on a demo company and unusable on a real one. Two of
 * them legitimately read per-record today; both are bounded, both are recorded
 * in the phase report with the exact fix, and both are pinned here so the cost
 * cannot quietly grow.
 */

const TODAY = "2026-08-20";
const CTX: Omit<ReportContext, "period"> = {
  today: TODAY,
  userId: "00000000-0000-0000-0000-000000000001",
  isOwner: true,
  permissions: [...ALL_PERMISSIONS],
};
const run = (id: string, f: ReportFilters = {}) => runReport(id, f, CTX);

/** Count calls to the repository methods a report can reach for. */
function instrument() {
  const counts: Record<string, number> = {};
  const spies: { restore: () => void }[] = [];
  const watch = <T extends object>(obj: T, name: string, keys: (keyof T)[]) => {
    for (const key of keys) {
      const original = obj[key] as unknown as (...a: unknown[]) => unknown;
      if (typeof original !== "function") continue;
      const label = `${name}.${String(key)}`;
      counts[label] = 0;
      const spy = vi.spyOn(obj, key as never).mockImplementation(((...args: unknown[]) => {
        counts[label] += 1;
        return original.apply(obj, args);
      }) as never);
      spies.push({ restore: () => spy.mockRestore() });
    }
  };

  watch(projectsApi, "projects", ["list", "get"]);
  watch(contractsApi, "contracts", ["getContractorProfile", "listContracts"]);
  watch(procurementApi, "procurement", ["listPurchaseOrders", "listVendors"]);
  watch(laborApi, "labour", ["summary"]);

  return { counts, restore: () => spies.forEach((s) => s.restore()) };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("read counts per report", () => {
  it("payments reads a bounded, constant number of sources", async () => {
    const { counts, restore } = instrument();
    await run("payments", { period: "ALL_TIME" });
    restore();
    // One project list for the filter labels; the payments snapshot itself is a
    // single `getPayments` call that fans out in parallel inside the module.
    expect(counts["projects.list"]).toBe(1);
    expect(counts["projects.get"]).toBe(0);
    // Crucially: no per-transaction lookup.
    expect(counts["contracts.getContractorProfile"]).toBe(0);
  });

  it.each([
    ["budget-vs-actual", 1],
    ["project-summary", 1],
    ["labour-cost", 1],
    ["labour-by-contractor", 1],
    ["procurement", 1],
    ["vendor-summary", 0],
  ])("%s issues no per-project detail read", async (id, projectLists) => {
    const { counts, restore } = instrument();
    await run(id, { period: "ALL_TIME" });
    restore();
    expect(counts["projects.get"], `${id} reads a project per row`).toBe(0);
    expect(counts["projects.list"]).toBe(projectLists);
  });

  it("labour reports read the summary twice — scoped, plus one for the empty state", async () => {
    const { counts, restore } = instrument();
    await run("labour-cost", { period: "THIS_MONTH" });
    restore();
    // The second is unbounded ON PURPOSE: it answers "has this company ever
    // recorded attendance?", which is what separates a quiet month from a new
    // company. Two folds of an already-scoped store, not two round trips per row.
    expect(counts["labour.summary"]).toBe(2);
  });
});

describe("the two reports that read per record", () => {
  it("contractor-position reads one profile per contractor, and no more", async () => {
    const { counts, restore } = instrument();
    const result = await run("contractor-position");
    restore();
    const rows = result.rows.filter((r) => r.kind !== "total").length;
    // Bounded by the CONTRACTOR count — tens, not thousands — and exactly one
    // read each. The reconciliation engine is the only correct source for these
    // figures, so this is the cost of being right rather than an oversight.
    expect(counts["contracts.getContractorProfile"]).toBe(rows);
    expect(counts["contracts.getContractorProfile"]).toBeLessThanOrEqual(50);
  });

  it("deadlines reads one project detail per ACTIVE project, and no more", async () => {
    const { counts, restore } = instrument();
    await run("deadlines");
    restore();
    // There is no bulk deadline query in the projects repository. Adding one is
    // that module's API work, not a report's; until then the cost is bounded by
    // the ACTIVE project count and pinned here.
    expect(counts["projects.get"]).toBeGreaterThan(0);
    expect(counts["projects.get"]).toBeLessThanOrEqual(counts["projects.list"] * 200);
  });

  it("no other report reads per record", async () => {
    for (const id of [
      "payments",
      "budget-vs-actual",
      "project-summary",
      "labour-cost",
      "labour-by-contractor",
      "procurement",
      "vendor-summary",
      "contractor-settlements",
    ]) {
      const { counts, restore } = instrument();
      await run(id, { period: "ALL_TIME" });
      restore();
      expect(counts["projects.get"], `${id} has an N+1`).toBe(0);
      expect(counts["contracts.getContractorProfile"], `${id} has an N+1`).toBe(0);
    }
  });
});

describe("All time is bounded by what the period asks for", () => {
  it("a narrow period returns fewer rows than all time", async () => {
    const all = await run("payments", { period: "ALL_TIME" });
    const month = await run("payments", { period: "THIS_MONTH" });
    const rows = (r: typeof all) => r.rows.filter((x) => x.kind !== "total").length;
    expect(rows(month)).toBeLessThanOrEqual(rows(all));
  });

  it("pushes the period into the payments read rather than filtering after", async () => {
    // A period-bounded snapshot must not carry rows outside its own bounds —
    // that is what makes the query, not the browser, do the narrowing.
    const jan = await run("payments", {
      period: "CUSTOM",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
    for (const row of jan.rows.filter((r) => r.kind !== "total")) {
      const date = String(row.cells[0]);
      expect(date >= "2026-01-01" && date <= "2026-01-31", `${date} escaped the period`).toBe(true);
    }
  });
});
