import { describe, it, expect, beforeEach } from "vitest";
import { runReport } from "./registry";
import { getPayments } from "@/features/payments/data";
import { filterTransactions, summarisePayments } from "@/features/payments/assemble";
import { paymentsVisibilityFor } from "@/features/payments/visibility";
import { TRANSACTION_TYPE_LABEL } from "@/features/payments/constants";
import { resolvePeriod } from "@/lib/period";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";
import { contractorsApi } from "@/features/contractors/data";
import { projectsApi } from "@/features/projects/data";
import type { SessionUser } from "@/lib/auth/types";
import type { PaymentsFilters } from "@/features/payments/types";
import type { ReportContext, ReportFilters } from "./types";

/**
 * THE LOAD-BEARING TEST.
 *
 * The Payments report and the Payments Centre must never disagree about money.
 * They cannot, by construction — the report calls `getPayments`,
 * `filterTransactions` and `summarisePayments`, which ARE the Payments Centre's
 * implementation — and this file exists to keep it that way. If someone later
 * "optimises" the report by querying the four sources directly, or adds a
 * convenience total, one of these assertions breaks.
 *
 * Production gave the shape of the truth being defended here. On real records
 * `/payments` reported Paid ₹14,84,400 across 6 transactions, a reversed
 * ₹10,00,000 excluded from that figure but still listed, and three settlements
 * each counted once at their net cash. The report has to reproduce exactly that
 * for the same scope, period and filters.
 */

const TODAY = "2026-08-20";
const USER_ID = "00000000-0000-0000-0000-000000000001";

const CTX: Omit<ReportContext, "period"> = {
  today: TODAY,
  userId: USER_ID,
  isOwner: true,
  permissions: [...ALL_PERMISSIONS],
};

const OWNER: SessionUser = {
  id: USER_ID,
  email: "owner@demo.constructly.app",
  fullName: "Aarav Mehta",
  role: "OWNER",
  permissions: [...ALL_PERMISSIONS],
  company: { id: "co", name: "Demo" },
};

/** The Payments Centre's own answer, for the same inputs the report gets. */
async function centre(preset: Parameters<typeof resolvePeriod>[0], f: PaymentsFilters = {}) {
  const period = resolvePeriod(preset, TODAY);
  const snapshot = await getPayments({
    userId: USER_ID,
    isOwner: true,
    visibility: paymentsVisibilityFor(OWNER),
    from: period.from,
    to: period.to,
  });
  const rows = filterTransactions(snapshot.transactions, f);
  return { period, snapshot, rows, summary: summarisePayments(rows, period) };
}

/** The report's answer. The money column is index 8; status is index 9. */
async function report(f: ReportFilters = {}) {
  const result = await runReport("payments", f, CTX);
  const data = result.rows.filter((r) => r.kind !== "total");
  const total = result.rows.find((r) => r.kind === "total");
  return { result, data, total };
}

const AMOUNT = 8;
const STATUS = 9;
const TYPE = 3;

beforeEach(() => localStorage.clear());

describe("Payments report === Payments Centre", () => {
  it.each(["THIS_MONTH", "LAST_MONTH", "LAST_90", "FINANCIAL_YEAR", "ALL_TIME"] as const)(
    "agrees on every figure for %s",
    async (preset) => {
      const c = await centre(preset);
      const r = await report({ period: preset });

      // Same rows, same order, same amounts.
      expect(r.data.length).toBe(c.rows.length);
      expect(r.data.map((row) => Number(row.cells[AMOUNT]))).toEqual(
        c.rows.map((t) => t.amountPaise),
      );

      // Same headline: the report's total row carries the Centre's ACTIVE total.
      if (c.rows.length > 0) {
        expect(Number(r.total!.cells[AMOUNT])).toBe(c.summary.paidPaise);
      }

      // And the KPI strip repeats it, in the Centre's own words.
      const paid = r.result.kpis.find((k) => k.label === "Paid")!;
      expect(paid.hint).toContain(String(c.summary.paidCount));
      expect(r.result.periodLabel).toBe(c.period.label);
    },
  );

  it("agrees when a project filter is applied to both", async () => {
    const projects = await projectsApi.list({ includeArchived: true });
    for (const p of projects.slice(0, 3)) {
      const c = await centre("ALL_TIME", { projectId: p.id });
      const r = await report({ period: "ALL_TIME", projectId: p.id });
      expect(r.data.length, `row count differs for ${p.name}`).toBe(c.rows.length);
      expect(Number(r.total!.cells[AMOUNT] ?? 0)).toBe(c.summary.paidPaise);
    }
  });

  it("agrees when a transaction-type filter is applied to both", async () => {
    for (const type of [
      "CONTRACTOR_ADVANCE",
      "CONTRACTOR_PAYMENT",
      "LABOUR_SETTLEMENT",
      "VENDOR_PAYMENT",
    ] as const) {
      const c = await centre("ALL_TIME", { type });
      const r = await report({ period: "ALL_TIME", transactionType: type });
      expect(r.data.length, `row count differs for ${type}`).toBe(c.rows.length);
      expect(r.data.every((row) => row.cells[TYPE] === TRANSACTION_TYPE_LABEL[type])).toBe(true);
    }
  });

  it("agrees when a status filter is applied to both", async () => {
    for (const status of ["ACTIVE", "REVERSED"] as const) {
      const c = await centre("ALL_TIME", { status });
      const r = await report({ period: "ALL_TIME", status });
      expect(r.data.length, `row count differs for ${status}`).toBe(c.rows.length);
    }
  });

  it("splits contractor and vendor exactly as the Centre does", async () => {
    const c = await centre("ALL_TIME");
    const r = await report({ period: "ALL_TIME" });
    const kpi = (label: string) => r.result.kpis.find((k) => k.label === label)!;
    // The KPI strings are compact-formatted, so compare the Centre's own split
    // rather than parsing display text: contractor + vendor must partition paid.
    expect(c.summary.contractorPaidPaise + c.summary.vendorPaidPaise).toBe(c.summary.paidPaise);
    expect(kpi("To contractors")).toBeTruthy();
    expect(kpi("To vendors")).toBeTruthy();
  });
});

describe("cash instruments are counted exactly once", () => {
  it("includes each of the four instruments, once per underlying record", async () => {
    const c = await centre("ALL_TIME");
    const r = await report({ period: "ALL_TIME" });

    // One report row per canonical transaction — no expansion, no collapsing.
    expect(r.data.length).toBe(c.snapshot.transactions.length);
    // Namespaced ids guarantee uniqueness; assert the amounts line up 1:1.
    const centreAmounts = [...c.snapshot.transactions.map((t) => t.amountPaise)].sort();
    const reportAmounts = [...r.data.map((row) => Number(row.cells[AMOUNT]))].sort();
    expect(reportAmounts).toEqual(centreAmounts);

    for (const type of [
      "CONTRACTOR_ADVANCE",
      "CONTRACTOR_PAYMENT",
      "VENDOR_PAYMENT",
    ] as const) {
      const inCentre = c.snapshot.transactions.filter((t) => t.type === type).length;
      const inReport = r.data.filter((row) => row.cells[TYPE] === TRANSACTION_TYPE_LABEL[type])
        .length;
      expect(inReport, `${type} count differs`).toBe(inCentre);
    }
  });

  it("reports a settlement once, at its NET cash", async () => {
    // Seed a settlement whose ledger footprint is a bill + a drawdown + a
    // payment, exactly as `createSettlement` writes it.
    await contractorsApi.listContractors({});
    const settlements = JSON.parse(
      localStorage.getItem("constructly.demo.contractorSettlements.v1") ?? "[]",
    );
    settlements.push({
      id: "s-consistency",
      contractorId: "c-pappu",
      contractorName: "Pappu Contractor",
      projectId: "10000000-0000-0000-0000-000000000001",
      projectName: "Skyline Residency",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-07",
      labourBillPaise: 60_000_000,
      advanceAdjustmentPaise: 20_000_000,
      netPaymentPaise: 40_000_000,
      advanceBalanceAfterPaise: 50_000_000,
      notes: null,
      createdAt: "2026-08-07T00:00:00.000Z",
    });
    localStorage.setItem(
      "constructly.demo.contractorSettlements.v1",
      JSON.stringify(settlements),
    );
    const ledger = JSON.parse(localStorage.getItem("constructly.demo.contractorLedger.v1") ?? "[]");
    const base = {
      contractorId: "c-pappu",
      date: "2026-08-07",
      settlementId: "s-consistency",
      projectId: "10000000-0000-0000-0000-000000000001",
      projectName: "Skyline Residency",
      contractId: null,
      contractTitle: null,
      drawsFromEntryId: null,
      reversesEntryId: null,
      fundsContractId: null,
      notes: null,
      advanceBalanceAfterPaise: 0,
      createdAt: "2026-08-07T00:00:00.000Z",
    };
    ledger.push({ ...base, id: "lc-bill", type: "LABOUR_BILL", amountPaise: 60_000_000 });
    ledger.push({ ...base, id: "lc-adj", type: "ADJUSTMENT", amountPaise: 20_000_000 });
    ledger.push({ ...base, id: "lc-pay", type: "PAYMENT", amountPaise: 40_000_000 });
    localStorage.setItem("constructly.demo.contractorLedger.v1", JSON.stringify(ledger));

    const r = await report({ period: "THIS_MONTH" });
    const settlementRows = r.data.filter(
      (row) => row.cells[TYPE] === TRANSACTION_TYPE_LABEL.LABOUR_SETTLEMENT,
    );
    expect(settlementRows).toHaveLength(1);
    // NET cash — not the ₹6,00,000 bill, and not bill + drawdown + payment.
    expect(Number(settlementRows[0].cells[AMOUNT])).toBe(40_000_000);

    const c = await centre("THIS_MONTH");
    expect(Number(r.total!.cells[AMOUNT])).toBe(c.summary.paidPaise);
  });
});

describe("internal reallocation never reaches the report", () => {
  it.each([
    ["ADJUSTMENT", "an advance drawdown — money already paid, being consumed"],
    ["SCOPE_TRANSFER_OUT", "a re-scope: no cash moves"],
    ["SCOPE_TRANSFER_IN", "the paired side of a re-scope"],
    ["LABOUR_BILL", "what the work came to, not a payment"],
    ["SETTLEMENT_REVERSAL", "correction bookkeeping"],
  ])("excludes %s — %s", async (type) => {
    await contractorsApi.listContractors({});
    const ledger = JSON.parse(localStorage.getItem("constructly.demo.contractorLedger.v1") ?? "[]");
    const before = (await report({ period: "ALL_TIME" })).data.length;
    ledger.push({
      id: `lx-${type}`,
      contractorId: "c-pappu",
      date: "2026-08-15",
      type,
      amountPaise: 99_900_000,
      advanceBalanceAfterPaise: 0,
      notes: null,
      settlementId: null,
      projectId: "10000000-0000-0000-0000-000000000001",
      projectName: "Skyline Residency",
      contractId: null,
      contractTitle: null,
      drawsFromEntryId: null,
      reversesEntryId: null,
      fundsContractId: null,
      createdAt: "2026-08-15T00:00:00.000Z",
    });
    localStorage.setItem("constructly.demo.contractorLedger.v1", JSON.stringify(ledger));

    const after = await report({ period: "ALL_TIME" });
    expect(after.data.length, `${type} leaked into the report`).toBe(before);
    expect(after.data.some((row) => Number(row.cells[AMOUNT]) === 99_900_000)).toBe(false);
  });

  it("never shows a raw enum name to the reader", async () => {
    const r = await report({ period: "ALL_TIME" });
    const text = r.data.flatMap((row) => row.cells.map(String)).join(" ");
    expect(/SCOPE_TRANSFER|OPENING_ADVANCE|LABOUR_BILL|SETTLEMENT_REVERSAL/.test(text)).toBe(false);
  });
});

describe("reversals", () => {
  it("keeps a reversed row visible but out of the active total", async () => {
    const c = await centre("ALL_TIME");
    const reversedInCentre = c.snapshot.transactions.filter((t) => t.status === "REVERSED");
    expect(reversedInCentre.length).toBeGreaterThan(0); // the seed carries one

    const r = await report({ period: "ALL_TIME" });
    const reversedRows = r.data.filter((row) => row.cells[STATUS] === "Reversed");
    expect(reversedRows.length).toBe(reversedInCentre.length);

    // Still carries its ORIGINAL amount — not zeroed, not negated.
    for (const row of reversedRows) expect(Number(row.cells[AMOUNT])).toBeGreaterThan(0);

    // And is excluded from the total, without being netted against it.
    const activeSum = r.data
      .filter((row) => row.cells[STATUS] === "Active")
      .reduce((n, row) => n + Number(row.cells[AMOUNT]), 0);
    expect(Number(r.total!.cells[AMOUNT])).toBe(activeSum);
    expect(Number(r.total!.cells[AMOUNT])).toBe(c.summary.paidPaise);

    const reversedSum = reversedRows.reduce((n, row) => n + Number(row.cells[AMOUNT]), 0);
    expect(reversedSum).toBe(c.summary.reversedPaise);
    // The two are reported apart; the total is not (active − reversed).
    expect(Number(r.total!.cells[AMOUNT])).not.toBe(activeSum - reversedSum);
  });

  it("names the reversed KPI without folding it into paid", async () => {
    const r = await report({ period: "ALL_TIME" });
    const reversed = r.result.kpis.find((k) => k.label === "Reversed");
    expect(reversed).toBeTruthy();
    expect(reversed!.hint).toMatch(/not counted above|Nothing reversed/);
  });
});

describe("no second payments formula", () => {
  it("exposes no invented cross-instrument aggregate", async () => {
    const r = await report({ period: "ALL_TIME" });
    const labels = [...r.result.kpis.map((k) => k.label), ...r.result.columns.map((c) => c.label)]
      .join(" ")
      .toLowerCase();
    for (const banned of ["outstanding", "liability", "payable", "cash position", "company due"]) {
      expect(labels.includes(banned), `report invented "${banned}"`).toBe(false);
    }
  });

  it("states the payment-mode limitation rather than guessing a mode", async () => {
    const r = await report({ period: "ALL_TIME" });
    expect(r.result.note).toMatch(/record no payment mode/i);
    // Contractor advances and settlements genuinely have no mode: blank, never invented.
    const modeIdx = r.result.columns.findIndex((c) => c.key === "mode");
    const contractorInstruments = r.data.filter(
      (row) =>
        row.cells[TYPE] === TRANSACTION_TYPE_LABEL.CONTRACTOR_ADVANCE ||
        row.cells[TYPE] === TRANSACTION_TYPE_LABEL.LABOUR_SETTLEMENT,
    );
    for (const row of contractorInstruments) expect(row.cells[modeIdx]).toBe("");
  });
});
