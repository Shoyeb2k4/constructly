import { describe, it, expect } from "vitest";
import {
  assemblePayments,
  countActiveFilters,
  filterTransactions,
  resolvePeriod,
  summarisePayments,
} from "./assemble";
import type {
  PaymentsVisibility,
  RawAgreementPayment,
  RawLedgerEntry,
  RawPaymentsData,
  RawSettlement,
  RawVendorPayment,
} from "./types";

/**
 * The financial invariants of the Payments Centre.
 *
 * This file is the feature. A cross-module money index is only worth having if
 * every rupee it reports moved exactly once, so these tests exist to catch the
 * two ways that can go wrong: counting something that was never cash, and
 * counting the same cash twice under two different names.
 */

const ALL_VISIBLE: PaymentsVisibility = {
  vendorPayments: true,
  agreementPayments: true,
  contractorLedger: true,
  companyWideAdvances: true,
};

const L = (over: Partial<RawLedgerEntry> = {}): RawLedgerEntry => ({
  id: "l1",
  contractorId: "c1",
  contractorName: "Pappu Contractor",
  date: "2026-02-10",
  type: "ADVANCE",
  amountPaise: 500_000_00,
  notes: null,
  projectId: "p1",
  projectName: "Skyline Residency",
  projectCode: "SKY",
  contractId: null,
  contractTitle: null,
  settlementId: null,
  ...over,
});

const S = (over: Partial<RawSettlement> = {}): RawSettlement => ({
  id: "s1",
  contractorId: "c1",
  contractorName: "Pappu Contractor",
  projectId: "p1",
  projectName: "Skyline Residency",
  projectCode: "SKY",
  periodStart: "2026-02-01",
  periodEnd: "2026-02-07",
  labourBillPaise: 600_000_00,
  advanceAdjustmentPaise: 200_000_00,
  netPaymentPaise: 400_000_00,
  notes: null,
  reversedAt: null,
  reversalReason: null,
  ...over,
});

const A = (over: Partial<RawAgreementPayment> = {}): RawAgreementPayment => ({
  id: "a1",
  contractId: "ag1",
  contractTitle: "Structure",
  contractorId: "c1",
  contractorName: "Pappu Contractor",
  projectId: "p1",
  projectName: "Skyline Residency",
  projectCode: "SKY",
  amountPaise: 200_000_00,
  type: "INTERIM",
  paymentMode: "BANK_TRANSFER",
  referenceNumber: "UTR900112",
  date: "2026-02-12",
  notes: null,
  reversedAt: null,
  reversalReason: null,
  ...over,
});

const V = (over: Partial<RawVendorPayment> = {}): RawVendorPayment => ({
  id: "v1",
  vendorId: "ven1",
  vendorName: "Sanghvi Steel",
  projectId: "p1",
  projectName: "Skyline Residency",
  projectCode: "SKY",
  purchaseOrderId: "po1",
  poNumber: "PO-0227",
  amountPaise: 150_000_00,
  paymentMode: "UPI",
  referenceNumber: "UPI-88231",
  date: "2026-02-14",
  remarks: null,
  ...over,
});

function raw(over: Partial<RawPaymentsData> = {}): RawPaymentsData {
  return {
    ledger: [],
    settlements: [],
    agreementPayments: [],
    vendorPayments: [],
    visibility: ALL_VISIBLE,
    hasAnyPayments: true,
    from: null,
    to: null,
    today: "2026-02-20",
    ...over,
  };
}

const FEB = resolvePeriod("THIS_MONTH", "2026-02-20");
const ALL = resolvePeriod("ALL_TIME", "2026-02-20");

describe("cash movement vs internal allocation", () => {
  it("counts an advance as a payment", () => {
    const snap = assemblePayments(raw({ ledger: [L()] }));
    expect(snap.transactions).toHaveLength(1);
    expect(snap.transactions[0].type).toBe("CONTRACTOR_ADVANCE");
    expect(snap.transactions[0].amountPaise).toBe(500_000_00);
  });

  it("counts an opening advance as a payment", () => {
    const snap = assemblePayments(raw({ ledger: [L({ type: "OPENING_ADVANCE" })] }));
    expect(snap.transactions).toHaveLength(1);
    expect(snap.transactions[0].type).toBe("CONTRACTOR_ADVANCE");
  });

  it.each([
    ["ADJUSTMENT", "an advance drawdown reallocates money already paid"],
    ["SCOPE_TRANSFER_OUT", "a re-scope moves money between scopes, no cash"],
    ["SCOPE_TRANSFER_IN", "the paired side of a re-scope, no cash"],
    ["LABOUR_BILL", "what the work came to, not a payment"],
    ["SETTLEMENT_REVERSAL", "a correction that returns money to the advance pool"],
  ])("excludes %s — %s", (type) => {
    const snap = assemblePayments(raw({ ledger: [L({ type })] }));
    expect(snap.transactions).toEqual([]);
  });

  it("excludes the ledger PAYMENT row, which mirrors a settlement already listed", () => {
    // A settlement writes LABOUR_BILL + ADJUSTMENT + PAYMENT. Listing the
    // PAYMENT row alongside the settlement would report the same cash twice.
    const snap = assemblePayments(
      raw({
        settlements: [S()],
        ledger: [
          L({ id: "lb", type: "LABOUR_BILL", amountPaise: 600_000_00, settlementId: "s1" }),
          L({ id: "adj", type: "ADJUSTMENT", amountPaise: 200_000_00, settlementId: "s1" }),
          L({ id: "pay", type: "PAYMENT", amountPaise: 400_000_00, settlementId: "s1" }),
        ],
      }),
    );
    expect(snap.transactions).toHaveLength(1);
    expect(snap.transactions[0].id).toBe("settlement:s1");
  });
});

describe("settlement: one act, one transaction", () => {
  it("reports the NET cash, not the labour bill", () => {
    const snap = assemblePayments(raw({ settlements: [S()] }));
    const t = snap.transactions[0];
    expect(t.amountPaise).toBe(400_000_00);
    expect(t.amountPaise).not.toBe(600_000_00);
  });

  it("carries the bill and the advance consumed as context, not as payments", () => {
    const snap = assemblePayments(raw({ settlements: [S()] }));
    const t = snap.transactions[0];
    expect(t.context.map((c) => c.amountPaise)).toEqual([600_000_00, 200_000_00]);
    // Context is never summed into a total.
    const summary = summarisePayments(snap.transactions, ALL);
    expect(summary.paidPaise).toBe(400_000_00);
  });

  it("omits the advance-consumed line when no advance was drawn", () => {
    const snap = assemblePayments(
      raw({ settlements: [S({ advanceAdjustmentPaise: 0, netPaymentPaise: 600_000_00 })] }),
    );
    expect(snap.transactions[0].context).toHaveLength(1);
    expect(snap.transactions[0].amountPaise).toBe(600_000_00);
  });

  it("does not double count the advance that funded it", () => {
    // ₹5,00,000 advance paid, then a settlement whose ₹6,00,000 bill consumed
    // ₹2,00,000 of it and paid ₹4,00,000 in cash. Total cash out is ₹9,00,000 —
    // NOT ₹11,00,000, and not ₹5,00,000 + ₹6,00,000.
    const snap = assemblePayments(raw({ ledger: [L()], settlements: [S()] }));
    const summary = summarisePayments(snap.transactions, ALL);
    expect(summary.paidPaise).toBe(900_000_00);
    expect(summary.paidCount).toBe(2);
  });
});

describe("reversals", () => {
  it("excludes a reversed agreement payment from active totals but keeps it visible", () => {
    const snap = assemblePayments(
      raw({
        agreementPayments: [
          A(),
          A({
            id: "a2",
            amountPaise: 100_000_00,
            reversedAt: "2026-02-19T00:00:00.000Z",
            reversalReason: "Duplicate entry",
          }),
        ],
      }),
    );
    expect(snap.transactions).toHaveLength(2);

    const summary = summarisePayments(snap.transactions, ALL);
    expect(summary.paidPaise).toBe(200_000_00);
    expect(summary.paidCount).toBe(1);
    expect(summary.reversedPaise).toBe(100_000_00);
    expect(summary.reversedCount).toBe(1);
  });

  it("never nets a reversal against the active figure", () => {
    // The reversed payment is reported separately and at its ORIGINAL value; it
    // is not subtracted, and it does not appear as negative money.
    const snap = assemblePayments(
      raw({ agreementPayments: [A({ reversedAt: "2026-02-19T00:00:00.000Z" })] }),
    );
    const summary = summarisePayments(snap.transactions, ALL);
    expect(summary.paidPaise).toBe(0);
    expect(summary.reversedPaise).toBe(200_000_00);
    expect(snap.transactions[0].amountPaise).toBeGreaterThan(0);
  });

  it("marks a reversed settlement REVERSED and drops it from paid totals", () => {
    const snap = assemblePayments(
      raw({
        settlements: [S({ reversedAt: "2026-02-15T00:00:00.000Z", reversalReason: "Wrong period" })],
      }),
    );
    expect(snap.transactions[0].status).toBe("REVERSED");
    expect(snap.transactions[0].reversalReason).toBe("Wrong period");
    expect(summarisePayments(snap.transactions, ALL).paidPaise).toBe(0);
  });

  it("leaves every vendor payment ACTIVE — the domain has no vendor reversal", () => {
    const snap = assemblePayments(raw({ vendorPayments: [V()] }));
    expect(snap.transactions[0].status).toBe("ACTIVE");
    expect(snap.transactions[0].reversedAt).toBeNull();
  });
});

describe("cross-instrument total", () => {
  it("equals the sum of the canonical active cash movements, each counted once", () => {
    const snap = assemblePayments(
      raw({
        ledger: [
          L(), // 5,00,000 advance
          L({ id: "l2", type: "ADJUSTMENT", amountPaise: 200_000_00 }), // not cash
          L({ id: "l3", type: "SCOPE_TRANSFER_OUT", amountPaise: 100_000_00 }), // not cash
          L({ id: "l4", type: "SCOPE_TRANSFER_IN", amountPaise: 100_000_00 }), // not cash
        ],
        settlements: [S()], // 4,00,000 net cash
        agreementPayments: [
          A(), // 2,00,000
          A({ id: "a2", amountPaise: 999_999_00, reversedAt: "2026-02-19T00:00:00.000Z" }),
        ],
        vendorPayments: [V(), V({ id: "v2", amountPaise: 50_000_00, purchaseOrderId: null, poNumber: null })],
      }),
    );
    const summary = summarisePayments(snap.transactions, ALL);

    expect(summary.paidPaise).toBe(500_000_00 + 400_000_00 + 200_000_00 + 150_000_00 + 50_000_00);
    expect(summary.paidCount).toBe(5);
    expect(summary.contractorPaidPaise).toBe(500_000_00 + 400_000_00 + 200_000_00);
    expect(summary.vendorPaidPaise).toBe(150_000_00 + 50_000_00);
    // Party totals partition the whole; nothing is in both and nothing is lost.
    expect(summary.contractorPaidPaise + summary.vendorPaidPaise).toBe(summary.paidPaise);
    // And the by-instrument breakdown sums to exactly the same figure.
    expect(summary.byType.reduce((n, r) => n + r.amountPaise, 0)).toBe(summary.paidPaise);
    expect(summary.byType.reduce((n, r) => n + r.count, 0)).toBe(summary.paidCount);
  });

  it("gives every transaction a unique id across the four sources", () => {
    const snap = assemblePayments(
      raw({
        // Same underlying id in four tables — namespacing is what keeps them apart.
        ledger: [L({ id: "x" })],
        settlements: [S({ id: "x" })],
        agreementPayments: [A({ id: "x" })],
        vendorPayments: [V({ id: "x" })],
      }),
    );
    expect(new Set(snap.transactions.map((t) => t.id)).size).toBe(4);
  });
});

describe("scope and party context", () => {
  it("labels a company-wide advance rather than borrowing a project name", () => {
    const snap = assemblePayments(
      raw({ ledger: [L({ projectId: null, projectName: null, projectCode: null })] }),
    );
    expect(snap.transactions[0].project).toBeNull();
    expect(snap.transactions[0].scopeLabel).toBe("General — no project");
  });

  it("names the agreement an advance was scoped to", () => {
    const snap = assemblePayments(raw({ ledger: [L({ contractId: "ag1", contractTitle: "Structure" })] }));
    expect(snap.transactions[0].scopeLabel).toBe("Structure");
  });

  it("says an on-account vendor payment is not against an order", () => {
    const snap = assemblePayments(
      raw({ vendorPayments: [V({ purchaseOrderId: null, poNumber: null })] }),
    );
    expect(snap.transactions[0].scopeLabel).toBe("On account — not against an order");
    expect(snap.transactions[0].source.kind).toBe("VENDOR");
  });

  it("points a PO-linked vendor payment at its purchase order", () => {
    const snap = assemblePayments(raw({ vendorPayments: [V()] }));
    expect(snap.transactions[0].source.href).toBe("/procurement/po1");
    expect(snap.transactions[0].source.label).toBe("PO-0227");
  });

  it("records no payment mode where the domain records none", () => {
    const snap = assemblePayments(raw({ ledger: [L()], settlements: [S()] }));
    expect(snap.transactions.every((t) => t.paymentMode === null)).toBe(true);
  });
});

describe("visibility", () => {
  it("omits an instrument the caller may not see", () => {
    const snap = assemblePayments(
      raw({
        ledger: [L()],
        settlements: [S()],
        agreementPayments: [A()],
        vendorPayments: [V()],
        visibility: {
          vendorPayments: true,
          agreementPayments: false,
          contractorLedger: false,
          companyWideAdvances: false,
        },
      }),
    );
    expect(snap.transactions.map((t) => t.type)).toEqual(["VENDOR_PAYMENT"]);
  });

  it("hides a company-wide advance without contractors.view_all", () => {
    const snap = assemblePayments(
      raw({
        ledger: [L({ projectId: null, projectName: null, projectCode: null }), L({ id: "l2" })],
        visibility: { ...ALL_VISIBLE, companyWideAdvances: false },
      }),
    );
    // The project-scoped advance survives; the unattributed one does not.
    expect(snap.transactions).toHaveLength(1);
    expect(snap.transactions[0].project?.id).toBe("p1");
  });
});

describe("ordering", () => {
  it("puts the newest transaction first and is stable on ties", () => {
    const snap = assemblePayments(
      raw({
        vendorPayments: [
          V({ id: "b", date: "2026-02-10" }),
          V({ id: "a", date: "2026-02-10" }),
          V({ id: "c", date: "2026-02-18" }),
        ],
      }),
    );
    expect(snap.transactions.map((t) => t.id)).toEqual([
      "vendor-payment:c",
      "vendor-payment:a",
      "vendor-payment:b",
    ]);
  });
});

describe("periods", () => {
  it("resolves this month to its true first and last day", () => {
    expect(resolvePeriod("THIS_MONTH", "2026-02-20")).toMatchObject({
      from: "2026-02-01",
      to: "2026-02-28",
      label: "February 2026",
    });
    expect(resolvePeriod("THIS_MONTH", "2026-12-05")).toMatchObject({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("rolls last month back across a year boundary", () => {
    expect(resolvePeriod("LAST_MONTH", "2026-01-09")).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
      label: "December 2025",
    });
  });

  it("uses the Indian financial year, April to March", () => {
    expect(resolvePeriod("FINANCIAL_YEAR", "2026-02-20")).toMatchObject({
      from: "2025-04-01",
      to: "2026-03-31",
      label: "FY 2025–26",
    });
    expect(resolvePeriod("FINANCIAL_YEAR", "2026-04-01")).toMatchObject({
      from: "2026-04-01",
      to: "2027-03-31",
    });
  });

  it("makes all time unbounded and says so", () => {
    expect(resolvePeriod("ALL_TIME", "2026-02-20")).toMatchObject({
      from: null,
      to: null,
      label: "All time",
    });
  });

  it("counts only what falls inside the period", () => {
    const snap = assemblePayments(
      raw({
        vendorPayments: [
          V({ id: "in", date: "2026-02-14" }),
          V({ id: "before", date: "2026-01-31", amountPaise: 900_000_00 }),
          V({ id: "after", date: "2026-03-01", amountPaise: 900_000_00 }),
        ],
      }),
    );
    expect(summarisePayments(snap.transactions, FEB).paidPaise).toBe(150_000_00);
    expect(summarisePayments(snap.transactions, ALL).paidCount).toBe(3);
  });

  it("labels every summary with the period it covers", () => {
    expect(summarisePayments([], FEB).period.label).toBe("February 2026");
  });
});

describe("filters and search", () => {
  const snap = assemblePayments(
    raw({
      ledger: [L()],
      settlements: [S()],
      agreementPayments: [A()],
      vendorPayments: [V(), V({ id: "v2", projectId: "p2", projectName: "Orion Heights", projectCode: "ORI", purchaseOrderId: null, poNumber: null, paymentMode: "CASH" })],
    }),
  );

  it("filters by instrument", () => {
    expect(filterTransactions(snap.transactions, { type: "VENDOR_PAYMENT" })).toHaveLength(2);
  });

  it("filters by party type", () => {
    expect(filterTransactions(snap.transactions, { partyType: "CONTRACTOR" })).toHaveLength(3);
  });

  it("filters by project", () => {
    expect(filterTransactions(snap.transactions, { projectId: "p2" })).toHaveLength(1);
  });

  it("filters by payment mode, which excludes instruments that record none", () => {
    const upi = filterTransactions(snap.transactions, { mode: "UPI" });
    expect(upi).toHaveLength(1);
    expect(upi[0].type).toBe("VENDOR_PAYMENT");
  });

  it("searches party, project, order number and reference", () => {
    expect(filterTransactions(snap.transactions, { search: "sanghvi" })).toHaveLength(2);
    expect(filterTransactions(snap.transactions, { search: "PO-0227" })).toHaveLength(1);
    expect(filterTransactions(snap.transactions, { search: "UTR900112" })).toHaveLength(1);
    expect(filterTransactions(snap.transactions, { search: "orion" })).toHaveLength(1);
  });

  it("never searches internal ids", () => {
    expect(filterTransactions(snap.transactions, { search: "vendor-payment" })).toHaveLength(0);
    expect(filterTransactions(snap.transactions, { search: "ven1" })).toHaveLength(0);
  });

  it("applies the period alongside the other filters", () => {
    const jan = resolvePeriod("LAST_MONTH", "2026-02-20");
    expect(filterTransactions(snap.transactions, {}, jan)).toHaveLength(0);
    expect(filterTransactions(snap.transactions, {}, FEB)).toHaveLength(5);
  });

  it("counts the active filters for the More-filters badge", () => {
    expect(countActiveFilters({})).toBe(0);
    expect(countActiveFilters({ type: "ALL", status: "ALL" })).toBe(0);
    expect(countActiveFilters({ type: "VENDOR_PAYMENT", search: " x ", mode: "UPI" })).toBe(3);
  });
});

describe("empty states", () => {
  it("tells a quiet period apart from a company that has never paid anyone", () => {
    const quiet = assemblePayments(raw({ hasAnyPayments: true }));
    expect(quiet.isEmpty).toBe(true);
    expect(quiet.hasAnyPayments).toBe(true);

    const fresh = assemblePayments(raw({ hasAnyPayments: false }));
    expect(fresh.isEmpty).toBe(true);
    expect(fresh.hasAnyPayments).toBe(false);
  });

  it("echoes the period bounds it was read for", () => {
    const snap = assemblePayments(raw({ from: "2026-02-01", to: "2026-02-28" }));
    expect(snap.from).toBe("2026-02-01");
    expect(snap.to).toBe("2026-02-28");
  });
});

describe("no invented aggregates", () => {
  it("exposes no combined outstanding, liability or cash-position figure", () => {
    const summary = summarisePayments(
      assemblePayments(raw({ vendorPayments: [V()], settlements: [S()] })).transactions,
      ALL,
    );
    const keys = Object.keys(summary);
    for (const banned of ["outstanding", "liability", "payable", "due", "cashPosition", "balance"]) {
      expect(keys.some((k) => k.toLowerCase().includes(banned.toLowerCase()))).toBe(false);
    }
  });
});
