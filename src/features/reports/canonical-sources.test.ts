import { describe, it, expect, beforeEach } from "vitest";
import { runReport } from "./registry";
import { laborApi } from "@/features/labor/data";
import { projectsApi } from "@/features/projects/data";
import { contractsApi } from "@/features/contracts/data";
import { contractorsApi } from "@/features/contractors/data";
import { procurementApi } from "@/features/procurement/data";
import { budgetApi } from "@/features/budget/data";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";
import type { ReportContext, ReportFilters } from "./types";

/**
 * Reports must consume canonical calculations, never own them.
 *
 * The consistency test for Payments lives in payments-consistency.test.ts. This
 * file defends the same rule for the other four sources, and in particular the
 * one property that is easy to break and expensive to discover late: a report
 * of last quarter must not change when a rate is revised today.
 */

const TODAY = "2026-08-20";
const PROJECT_A = "10000000-0000-0000-0000-000000000001";

const CTX: Omit<ReportContext, "period"> = {
  today: TODAY,
  userId: "00000000-0000-0000-0000-000000000001",
  isOwner: true,
  permissions: [...ALL_PERMISSIONS],
};
const run = (id: string, f: ReportFilters = {}) => runReport(id, f, CTX);

beforeEach(() => localStorage.clear());

/* ── Labour: the snapshot rule ───────────────────────────────────────── */

describe("labour reports price history at the rate that applied on the day", () => {
  /** Record one day of attendance, then move the rate underneath it. */
  async function recordThenRevise(multiplier: number) {
    const date = "2026-08-10";
    // The sheet is grouped by contractor; each group holds the labour-type rows.
    const sheet = await laborApi.getSheet(PROJECT_A, date);
    const group = sheet.groups.find((g) =>
      g.rows.some((r) => (r.dailyRatePaise ?? 0) > 0),
    )!;
    expect(group, "no seeded group carries a rated labour type").toBeTruthy();
    const row = group.rows.find((r) => (r.dailyRatePaise ?? 0) > 0)!;
    const originalRate = row.dailyRatePaise!;

    await laborApi.setQuantity({
      projectId: PROJECT_A,
      date,
      subcategoryId: row.subcategoryId,
      quantity: 4,
      contractorId: group.contractorId,
      contractId: row.contractId,
    });

    const before = await run("labour-cost", { period: "ALL_TIME" });
    const beforeTotal = Number(before.rows[before.rows.length - 1].cells[2]);

    // A revision AFTER the fact — the case that must not rewrite history.
    await laborApi.updateSubcategory(row.subcategoryId, {
      dailyRatePaise: originalRate * multiplier,
    });

    const after = await run("labour-cost", { period: "ALL_TIME" });
    const afterTotal = Number(after.rows[after.rows.length - 1].cells[2]);
    return { originalRate, beforeTotal, afterTotal };
  }

  it("does not reprice recorded attendance when the rate is raised", async () => {
    const { beforeTotal, afterTotal } = await recordThenRevise(10);
    expect(beforeTotal).toBeGreaterThan(0);
    expect(afterTotal, "a rate revision rewrote a historical report").toBe(beforeTotal);
  });

  it("does not reprice recorded attendance when the rate is cut", async () => {
    const { beforeTotal, afterTotal } = await recordThenRevise(0.1);
    expect(afterTotal).toBe(beforeTotal);
  });

  it("folds the same snapshot the labour module folds", async () => {
    await laborApi.getSheet(PROJECT_A, "2026-08-10");
    const summary = await laborApi.summary({});
    const result = await run("labour-cost", { period: "ALL_TIME" });
    const grand = result.rows[result.rows.length - 1];
    expect(grand.cells[1]).toBe(summary.totalManDays);
    expect(grand.cells[2]).toBe(summary.estimatedCostPaise);
  });

  it("says attendance value is not a payable", async () => {
    const result = await run("labour-cost", { period: "ALL_TIME" });
    expect(result.note).toMatch(/not a payable/i);
    const labels = result.columns.map((c) => c.label).join(" ");
    // Never the agreement vocabulary — settlement is what makes money owed.
    expect(/\bdue\b|\bpayable\b|\bowed\b/i.test(labels)).toBe(false);
  });
});

/* ── Contractors: the reconciliation engine owns Due and Ahead ───────── */

describe("contractor reports take their figures from the reconciliation engine", () => {
  it("matches the engine per contractor, column for column", async () => {
    const contractors = await contractorsApi.listContractors({ status: "ALL" });
    const result = await run("contractor-position");
    const byName = new Map(
      result.rows.filter((r) => r.kind !== "total").map((r) => [String(r.cells[0]), r.cells]),
    );

    for (const c of contractors) {
      const profile = await contractsApi.getContractorProfile(c.id);
      if (!profile) continue;
      const cells = byName.get(c.name);
      expect(cells, `${c.name} missing from the report`).toBeTruthy();
      const r = profile.lifetime;
      expect(cells![2]).toBe(r.totalContractValuePaise); // Authorised
      expect(cells![3]).toBe(r.totalEarnedPaise); // Earned
      expect(cells![4]).toBe(r.totalAttendanceCreditPaise); // Attendance credit
      expect(cells![5]).toBe(r.totalOtherPaymentCreditPaise); // Other payments
      expect(cells![6]).toBe(r.totalCreditedPaise); // Credited
      expect(cells![7]).toBe(r.totalCurrentDuePaise); // Currently due
      expect(cells![8]).toBe(r.totalAdvanceCreditPaise); // Paid ahead
      expect(cells![9]).toBe(c.advanceBalancePaise); // Advance balance
    }
  });

  it("never nets Due against Ahead", async () => {
    const result = await run("contractor-position");
    const labels = result.columns.map((c) => c.label);
    expect(labels).toContain("Currently due");
    expect(labels).toContain("Paid ahead");
    // No netted column, and no use of the engine's informational net figure.
    expect(labels.some((l) => /net|position|balance owed/i.test(l) && !/Advance balance/.test(l)))
      .toBe(false);
    expect(result.note).toMatch(/never netted/i);

    // The two totals are computed independently, so a company can show both.
    const total = result.rows.find((r) => r.kind === "total")!;
    expect(typeof total.cells[7]).toBe("number");
    expect(typeof total.cells[8]).toBe("number");
  });

  it("keeps advance balance apart from agreement credit", async () => {
    const result = await run("contractor-position");
    expect(result.note).toMatch(/not agreement credit/i);
  });
});

/* ── Procurement ─────────────────────────────────────────────────────── */

describe("procurement reports keep the module's vocabulary", () => {
  it("totals match the shared purchase-order list", async () => {
    const pos = await procurementApi.listPurchaseOrders({});
    const result = await run("procurement", { period: "ALL_TIME" });
    const total = result.rows.find((r) => r.kind === "total")!;
    expect(total.cells[7]).toBe(pos.reduce((s, p) => s + p.totalPaise, 0));
    expect(total.cells[8]).toBe(pos.reduce((s, p) => s + p.paidPaise, 0));
    expect(total.cells[9]).toBe(
      pos.reduce((s, p) => s + Math.max(0, p.totalPaise - p.paidPaise), 0),
    );
  });

  it("uses Ordered value / Paid / Still owed, and never implies delivery", async () => {
    const result = await run("procurement", { period: "ALL_TIME" });
    const labels = result.columns.map((c) => c.label);
    expect(labels).toContain("Ordered value");
    expect(labels).toContain("Still owed");
    expect(/delivered|received|goods in/i.test(labels.join(" "))).toBe(false);
    expect(result.note).toMatch(/records no goods receipt/);
  });

  it("does not add vendor Still owed to any contractor figure", async () => {
    const vendor = await run("vendor-summary");
    const labels = vendor.columns.map((c) => c.label).join(" ");
    expect(/currently due|contractor/i.test(labels)).toBe(false);
    expect(vendor.note).toMatch(/different commercial bases/);
  });
});

/* ── Projects ────────────────────────────────────────────────────────── */

describe("report figures obey the project money standard", () => {
  it("carries paise on every money KPI so it can be shown in full", async () => {
    for (const id of ["payments", "budget-vs-actual", "contractor-position", "labour-cost"]) {
      const result = await run(id, { period: "ALL_TIME" });
      const money = result.kpis.filter((k) => /₹/.test(k.value));
      expect(money.length, `${id} has no money KPI`).toBeGreaterThan(0);
      for (const k of money) {
        // Without paise the shell can only render the compact, ROUNDED string.
        expect(k.paise, `${id} KPI "${k.label}" cannot be shown in full`).toBeTypeOf("number");
      }
    }
  });

  it("agrees between a money KPI and the total it summarises", async () => {
    const result = await run("payments", { period: "ALL_TIME" });
    const paid = result.kpis.find((k) => k.label === "Paid")!;
    const total = result.rows.find((r) => r.kind === "total")!;
    expect(paid.paise).toBe(Number(total.cells[8]));
  });
});

describe("project reports use the shared budget source", () => {
  it("reads labour and procurement from spendByProject, not a subtraction", async () => {
    await laborApi.summary({});
    await procurementApi.listPurchaseOrders({});
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
    }
  });

  it("invents no project liability or project due", async () => {
    for (const id of ["budget-vs-actual", "project-summary", "deadlines"]) {
      const result = await run(id);
      const text = [
        ...result.columns.map((c) => c.label),
        ...result.kpis.map((k) => k.label),
      ]
        .join(" ")
        .toLowerCase();
      for (const banned of ["liability", "project due", "payable", "outstanding"]) {
        expect(text.includes(banned), `${id} invented "${banned}"`).toBe(false);
      }
    }
  });

  it("says budget used is not a statement of what has been paid", async () => {
    const result = await run("budget-vs-actual");
    expect(result.note).toMatch(/not a statement of what has been paid/i);
  });
});
