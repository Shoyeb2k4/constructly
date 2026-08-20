/**
 * Pure assembly for the Payments Centre. No DB, no clock, no locale.
 *
 * Everything load-bearing about this feature lives here, because "one place to
 * find every payment" is only useful if each payment appears EXACTLY ONCE and
 * for its real amount. The three rules:
 *
 * 1. CASH ONLY. A ledger row is a transaction if and only if it moved cash.
 *    ADVANCE and OPENING_ADVANCE did. ADJUSTMENT, SCOPE_TRANSFER_OUT/IN,
 *    LABOUR_BILL and SETTLEMENT_REVERSAL did not, and are excluded.
 *
 * 2. ONE SETTLEMENT, ONE TRANSACTION. A settlement writes a LABOUR_BILL, one
 *    ADJUSTMENT per advance it drew on, and a PAYMENT — three or more ledger
 *    rows for one act. The canonical representation is the settlement itself,
 *    for its NET cash. The ledger PAYMENT row is its mirror and is skipped, or
 *    the same rupees would be listed twice.
 *
 * 3. REVERSED MONEY IS NOT ACTIVE MONEY, AND NOT NEGATIVE MONEY. A reversed
 *    transaction stays visible with its original amount and a REVERSED status;
 *    it is excluded from paid totals and reported on its own line. It never
 *    nets against the active figure, because netting would state a movement
 *    that did not happen.
 */

import type {
  PaymentPeriod,
  PaymentTransaction,
  PaymentTransactionType,
  PaymentsFilters,
  PaymentsSnapshot,
  PaymentsSummary,
  PaymentTypeTotal,
  PeriodPreset,
  RawAgreementPayment,
  RawLedgerEntry,
  RawPaymentsData,
  RawSettlement,
  RawVendorPayment,
} from "./types";

/**
 * Ledger types that represent cash leaving the company.
 *
 * PAYMENT is absent on purpose — see rule 2. It is real cash, but the
 * settlement it belongs to already represents it.
 */
const CASH_LEDGER_TYPES = new Set(["ADVANCE", "OPENING_ADVANCE"]);

/** Company-wide advances say so in words rather than borrowing a project name. */
export const GENERAL_ADVANCE_LABEL = "General — no project";

function contractorHref(id: string) {
  return `/labor/contractors/${id}`;
}

function advanceToTransaction(e: RawLedgerEntry): PaymentTransaction {
  const scope = e.contractTitle
    ? e.contractTitle
    : e.projectId
      ? null
      : GENERAL_ADVANCE_LABEL;
  return {
    id: `advance:${e.id}`,
    type: "CONTRACTOR_ADVANCE",
    date: e.date,
    amountPaise: e.amountPaise,
    party: {
      type: "CONTRACTOR",
      id: e.contractorId,
      name: e.contractorName,
      href: contractorHref(e.contractorId),
    },
    project: e.projectId
      ? { id: e.projectId, name: e.projectName ?? "", code: e.projectCode }
      : null,
    scopeLabel: scope,
    source: {
      kind: "ADVANCE_LEDGER",
      id: e.contractorId,
      href: `${contractorHref(e.contractorId)}?section=ledger`,
      label: "Advance ledger",
    },
    // The contractor ledger records no mode and no reference. Showing an empty
    // cell is honest; inventing "Cash" would not be.
    paymentMode: null,
    reference: null,
    status: "ACTIVE",
    reversedAt: null,
    reversalReason: null,
    description:
      e.notes ??
      (e.type === "OPENING_ADVANCE" ? "Opening advance" : "Labour advance"),
    context: [],
  };
}

function settlementToTransaction(s: RawSettlement): PaymentTransaction {
  const context = [
    {
      label: "Labour bill for the period",
      amountPaise: s.labourBillPaise,
      note: "What the work came to, not a payment",
    },
  ];
  if (s.advanceAdjustmentPaise > 0) {
    context.push({
      label: "Advance consumed",
      amountPaise: s.advanceAdjustmentPaise,
      note: "Already-paid advance applied to the bill — no new cash",
    });
  }
  return {
    id: `settlement:${s.id}`,
    type: "LABOUR_SETTLEMENT",
    // A settlement pays a period, and the period end is the date it settles to.
    date: s.periodEnd,
    // NET cash only. The bill and the advance drawn against it are context.
    amountPaise: s.netPaymentPaise,
    party: {
      type: "CONTRACTOR",
      id: s.contractorId,
      name: s.contractorName,
      href: contractorHref(s.contractorId),
    },
    project: { id: s.projectId, name: s.projectName, code: s.projectCode },
    scopeLabel: `${s.periodStart} to ${s.periodEnd}`,
    source: {
      kind: "SETTLEMENT",
      id: s.id,
      href: `${contractorHref(s.contractorId)}?section=payments`,
      label: "Settlements",
    },
    paymentMode: null,
    reference: null,
    status: s.reversedAt ? "REVERSED" : "ACTIVE",
    reversedAt: s.reversedAt,
    reversalReason: s.reversalReason,
    description: s.notes,
    context,
  };
}

function agreementToTransaction(p: RawAgreementPayment): PaymentTransaction {
  return {
    id: `agreement-payment:${p.id}`,
    type: "CONTRACTOR_PAYMENT",
    date: p.date,
    amountPaise: p.amountPaise,
    party: {
      type: "CONTRACTOR",
      id: p.contractorId,
      name: p.contractorName,
      href: contractorHref(p.contractorId),
    },
    project: { id: p.projectId, name: p.projectName, code: p.projectCode },
    scopeLabel: p.contractTitle,
    source: {
      kind: "AGREEMENT",
      id: p.contractId,
      href: `${contractorHref(p.contractorId)}?section=payments`,
      label: "Agreement payments",
    },
    paymentMode: p.paymentMode,
    reference: p.referenceNumber,
    status: p.reversedAt ? "REVERSED" : "ACTIVE",
    reversedAt: p.reversedAt,
    reversalReason: p.reversalReason,
    description: p.notes,
    context: [],
  };
}

function vendorToTransaction(p: RawVendorPayment): PaymentTransaction {
  return {
    id: `vendor-payment:${p.id}`,
    type: "VENDOR_PAYMENT",
    date: p.date,
    amountPaise: p.amountPaise,
    party: {
      type: "VENDOR",
      id: p.vendorId,
      name: p.vendorName,
      href: `/vendors/${p.vendorId}`,
    },
    project: { id: p.projectId, name: p.projectName, code: p.projectCode },
    // An on-account payment is not against any order, and says so rather than
    // leaving the reader to guess which order it was.
    scopeLabel: p.poNumber ?? "On account — not against an order",
    source: p.purchaseOrderId
      ? {
          kind: "PURCHASE_ORDER",
          id: p.purchaseOrderId,
          href: `/procurement/${p.purchaseOrderId}`,
          label: p.poNumber ?? "Purchase order",
        }
      : {
          kind: "VENDOR",
          id: p.vendorId,
          href: `/vendors/${p.vendorId}`,
          label: p.vendorName,
        },
    paymentMode: p.paymentMode,
    reference: p.referenceNumber,
    // Vendor payments have no reversal concept in the domain. Every one of them
    // is ACTIVE, and the UI must not offer a Reverse action for consistency's
    // sake — see the module notes.
    status: "ACTIVE",
    reversedAt: null,
    reversalReason: null,
    description: p.remarks,
    context: [],
  };
}

/** Newest first; ties broken by id so the order is stable across renders. */
function byDateDesc(a: PaymentTransaction, b: PaymentTransaction) {
  return b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
}

export function assemblePayments(raw: RawPaymentsData): PaymentsSnapshot {
  const transactions: PaymentTransaction[] = [];

  if (raw.visibility.contractorLedger) {
    for (const e of raw.ledger) {
      if (!CASH_LEDGER_TYPES.has(e.type)) continue;
      // A company-wide advance has no project, so project scoping cannot reach
      // it; the ledger's own rule (view_all) governs instead.
      if (!e.projectId && !raw.visibility.companyWideAdvances) continue;
      transactions.push(advanceToTransaction(e));
    }
    for (const s of raw.settlements) transactions.push(settlementToTransaction(s));
  }
  if (raw.visibility.agreementPayments) {
    for (const p of raw.agreementPayments) transactions.push(agreementToTransaction(p));
  }
  if (raw.visibility.vendorPayments) {
    for (const p of raw.vendorPayments) transactions.push(vendorToTransaction(p));
  }

  transactions.sort(byDateDesc);

  return {
    transactions,
    isEmpty: transactions.length === 0,
    hasAnyPayments: raw.hasAnyPayments,
    from: raw.from,
    to: raw.to,
    visibility: raw.visibility,
    today: raw.today,
  };
}

/* ── Period ───────────────────────────────────────────────────────────── */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** YYYY-MM-DD arithmetic in UTC, so a timezone can never shift a period edge. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStart(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

function monthEnd(year: number, month: number): string {
  return addDays(monthStart(month === 11 ? year + 1 : year, (month + 1) % 12), -1);
}

/**
 * Resolve a preset against the viewer's today. The financial year is the Indian
 * one (1 April – 31 March) because that is the year this product's users close
 * their books on.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  today: string,
  custom?: { from?: string | null; to?: string | null },
): PaymentPeriod {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;

  switch (preset) {
    case "THIS_MONTH":
      return {
        preset,
        from: monthStart(year, month),
        to: monthEnd(year, month),
        label: `${MONTHS[month]} ${year}`,
      };
    case "LAST_MONTH": {
      const y = month === 0 ? year - 1 : year;
      const m = month === 0 ? 11 : month - 1;
      return { preset, from: monthStart(y, m), to: monthEnd(y, m), label: `${MONTHS[m]} ${y}` };
    }
    case "LAST_90":
      return { preset, from: addDays(today, -89), to: today, label: "Last 90 days" };
    case "FINANCIAL_YEAR": {
      const startYear = month >= 3 ? year : year - 1;
      return {
        preset,
        from: `${startYear}-04-01`,
        to: `${startYear + 1}-03-31`,
        label: `FY ${startYear}–${String(startYear + 1).slice(2)}`,
      };
    }
    case "CUSTOM": {
      const from = custom?.from || null;
      const to = custom?.to || null;
      const label =
        from && to ? `${from} to ${to}` : from ? `From ${from}` : to ? `Up to ${to}` : "All time";
      return { preset, from, to, label };
    }
    case "ALL_TIME":
    default:
      return { preset: "ALL_TIME", from: null, to: null, label: "All time" };
  }
}

export function inPeriod(date: string, period: PaymentPeriod): boolean {
  if (period.from && date < period.from) return false;
  if (period.to && date > period.to) return false;
  return true;
}

/* ── Filtering & search ───────────────────────────────────────────────── */

/**
 * Search covers the identifiers a person actually remembers: who they paid, the
 * order or agreement it was against, the reference they wrote down, and the
 * note they left. It never reaches into ids — a UUID is not something anyone
 * types, and exposing one would only leak internals.
 */
function matchesSearch(t: PaymentTransaction, needle: string): boolean {
  const hay = [
    t.party.name,
    t.project?.name,
    t.project?.code,
    t.scopeLabel,
    t.source.label,
    t.reference,
    t.description,
  ];
  return hay.some((v) => v != null && v.toLowerCase().includes(needle));
}

export function filterTransactions(
  transactions: PaymentTransaction[],
  filters: PaymentsFilters,
  period?: PaymentPeriod,
): PaymentTransaction[] {
  const needle = filters.search?.trim().toLowerCase();
  return transactions.filter((t) => {
    if (period && !inPeriod(t.date, period)) return false;
    if (filters.type && filters.type !== "ALL" && t.type !== filters.type) return false;
    if (filters.partyType && filters.partyType !== "ALL" && t.party.type !== filters.partyType)
      return false;
    if (filters.projectId && filters.projectId !== "ALL" && t.project?.id !== filters.projectId)
      return false;
    if (filters.status && filters.status !== "ALL" && t.status !== filters.status) return false;
    if (filters.mode && filters.mode !== "ALL" && t.paymentMode !== filters.mode) return false;
    if (needle && !matchesSearch(t, needle)) return false;
    return true;
  });
}

export function countActiveFilters(filters: PaymentsFilters): number {
  let n = 0;
  if (filters.search?.trim()) n++;
  if (filters.type && filters.type !== "ALL") n++;
  if (filters.partyType && filters.partyType !== "ALL") n++;
  if (filters.projectId && filters.projectId !== "ALL") n++;
  if (filters.status && filters.status !== "ALL") n++;
  if (filters.mode && filters.mode !== "ALL") n++;
  return n;
}

/* ── Summary ──────────────────────────────────────────────────────────── */

const ALL_TYPES: PaymentTransactionType[] = [
  "CONTRACTOR_ADVANCE",
  "CONTRACTOR_PAYMENT",
  "LABOUR_SETTLEMENT",
  "VENDOR_PAYMENT",
];

/**
 * Movement totals over the transactions given, for the period given.
 *
 * Deliberately absent: any total combining what is owed with what was paid.
 * Vendor "still owed" and contractor "currently due" rest on different
 * commercial bases and adding them produces a number with no meaning.
 */
export function summarisePayments(
  transactions: PaymentTransaction[],
  period: PaymentPeriod,
): PaymentsSummary {
  const inRange = transactions.filter((t) => inPeriod(t.date, period));
  const active = inRange.filter((t) => t.status === "ACTIVE");
  const reversed = inRange.filter((t) => t.status === "REVERSED");
  const sum = (rows: PaymentTransaction[]) => rows.reduce((n, t) => n + t.amountPaise, 0);

  const contractor = active.filter((t) => t.party.type === "CONTRACTOR");
  const vendor = active.filter((t) => t.party.type === "VENDOR");

  const byType: PaymentTypeTotal[] = ALL_TYPES.map((type) => {
    const rows = active.filter((t) => t.type === type);
    return { type, amountPaise: sum(rows), count: rows.length };
  });

  return {
    period,
    paidPaise: sum(active),
    paidCount: active.length,
    contractorPaidPaise: sum(contractor),
    contractorPaidCount: contractor.length,
    vendorPaidPaise: sum(vendor),
    vendorPaidCount: vendor.length,
    reversedPaise: sum(reversed),
    reversedCount: reversed.length,
    byType,
  };
}
