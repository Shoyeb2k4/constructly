import { poCountsForBudget } from "@/features/budget/calc";
import type { POPaymentStatus, PurchaseOrderStatus } from "./types";

/**
 * Pure procurement math — the single source used by the demo repository, the
 * Prisma server actions, the dashboard gatherers, and the UI. All money is
 * integer paise; GST rates are integer basis points (1800 = 18%).
 */

/* ── Line + PO totals ────────────────────────────────────────────────── */

/** Taxable line amount = quantity × rate, in integer paise (ex-GST). */
export function lineAmountPaise(quantity: number, ratePaise: number): number {
  return Math.round(quantity * ratePaise);
}

/** GST for one line, rounded PER LINE so totals always equal visible sums. */
export function lineGstPaise(quantity: number, ratePaise: number, gstRateBps: number): number {
  return Math.round((quantity * ratePaise * gstRateBps) / 10_000);
}

export interface POTotals {
  subtotalPaise: number;
  gstPaise: number;
  /** Grand total = subtotal + GST. Budget + outstanding math use this. */
  totalPaise: number;
}

/** PO footer: Subtotal / GST / Grand Total from raw line inputs. */
export function poTotals(
  lines: { quantity: number; ratePaise: number; gstRateBps?: number }[],
): POTotals {
  let subtotal = 0;
  let gst = 0;
  for (const l of lines) {
    subtotal += lineAmountPaise(l.quantity, l.ratePaise);
    gst += lineGstPaise(l.quantity, l.ratePaise, l.gstRateBps ?? 0);
  }
  return { subtotalPaise: subtotal, gstPaise: gst, totalPaise: subtotal + gst };
}

/* ── Outstanding & payment status (always DERIVED, never stored) ─────── */

/** Minimal PO shape the rollup math needs (grand totals). */
export interface POForRollup {
  id: string;
  vendorId: string;
  projectId: string;
  status: PurchaseOrderStatus;
  /** Grand total (incl. GST), integer paise. */
  totalPaise: number;
  /** ISO yyyy-mm-dd. */
  purchaseDate: string;
  /** Distinct materials on the PO (for "materials supplied" rollups). */
  materials?: string[];
}

/** Minimal payment shape. */
export interface PaymentForRollup {
  vendorId: string;
  projectId: string;
  purchaseOrderId: string | null;
  amountPaise: number;
  date: string;
}

/** A PO counts toward purchases/outstanding under the same rule as budget. */
export function poCounted(status: PurchaseOrderStatus, approvalRequired: boolean): boolean {
  return poCountsForBudget(status, approvalRequired);
}

/** Σ counted PO grand totals − Σ payments, optionally scoped to a project. */
export function outstandingPaise(
  pos: POForRollup[],
  payments: PaymentForRollup[],
  scope: { vendorId?: string; projectId?: string },
  approvalRequired: boolean,
): number {
  const inScope = <T extends { vendorId: string; projectId: string }>(x: T) =>
    (!scope.vendorId || x.vendorId === scope.vendorId) &&
    (!scope.projectId || x.projectId === scope.projectId);
  const purchased = pos
    .filter((p) => inScope(p) && poCounted(p.status, approvalRequired))
    .reduce((s, p) => s + p.totalPaise, 0);
  const paid = payments.filter(inScope).reduce((s, p) => s + p.amountPaise, 0);
  return purchased - paid;
}

/** Payment status of a single PO from payments LINKED to it. */
export function poPaymentStatus(totalPaise: number, paidPaise: number): POPaymentStatus {
  if (paidPaise <= 0) return "UNPAID";
  if (paidPaise >= totalPaise) return "PAID";
  return "PARTIAL";
}

/* ── Aging buckets (0–30 / 31–60 / 60+) ──────────────────────────────── */

export interface AgingRow {
  poId: string;
  poNumber?: string;
  projectId: string;
  purchaseDate: string;
  ageDays: number;
  outstandingPaise: number;
}

export interface AgingBuckets {
  d0_30: number;
  d31_60: number;
  d60_plus: number;
  /** Unallocated credit (advances beyond all PO outstanding), ≥ 0. */
  onAccountPaise: number;
  rows: AgingRow[];
}

const DAY_MS = 86_400_000;

/** UTC whole-day difference between two ISO dates. */
export function daysBetweenUTC(fromISO: string, toISO: string): number {
  return Math.round(
    (Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / DAY_MS,
  );
}

/**
 * Vendor outstanding aged by PO date. Linked payments settle their own PO;
 * unlinked (advance / on-account) payments are applied FIFO to the OLDEST
 * outstanding POs first — standard ledger behaviour — so bucket totals always
 * sum to the vendor's true outstanding. Leftover credit surfaces separately.
 */
export function agingBuckets(
  pos: POForRollup[],
  payments: PaymentForRollup[],
  vendorId: string,
  approvalRequired: boolean,
  todayISO: string,
  projectId?: string,
): AgingBuckets {
  const counted = pos
    .filter(
      (p) =>
        p.vendorId === vendorId &&
        (!projectId || p.projectId === projectId) &&
        poCounted(p.status, approvalRequired),
    )
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate));
  const theirPayments = payments.filter(
    (p) => p.vendorId === vendorId && (!projectId || p.projectId === projectId),
  );

  const linkedPaid = new Map<string, number>();
  let pool = 0; // unlinked payments, applied FIFO below
  for (const pay of theirPayments) {
    if (pay.purchaseOrderId) {
      linkedPaid.set(pay.purchaseOrderId, (linkedPaid.get(pay.purchaseOrderId) ?? 0) + pay.amountPaise);
    } else {
      pool += pay.amountPaise;
    }
  }
  // Over-payments on a specific PO also become credit for other POs.
  const perPO = counted.map((po) => {
    const paid = linkedPaid.get(po.id) ?? 0;
    if (paid > po.totalPaise) {
      pool += paid - po.totalPaise;
      return { po, outstanding: 0 };
    }
    return { po, outstanding: po.totalPaise - paid };
  });
  for (const row of perPO) {
    if (pool <= 0) break;
    const applied = Math.min(pool, row.outstanding);
    row.outstanding -= applied;
    pool -= applied;
  }

  const buckets: AgingBuckets = { d0_30: 0, d31_60: 0, d60_plus: 0, onAccountPaise: pool, rows: [] };
  for (const { po, outstanding } of perPO) {
    if (outstanding <= 0) continue;
    const age = Math.max(0, daysBetweenUTC(po.purchaseDate, todayISO));
    if (age <= 30) buckets.d0_30 += outstanding;
    else if (age <= 60) buckets.d31_60 += outstanding;
    else buckets.d60_plus += outstanding;
    buckets.rows.push({
      poId: po.id,
      projectId: po.projectId,
      purchaseDate: po.purchaseDate,
      ageDays: age,
      outstandingPaise: outstanding,
    });
  }
  return buckets;
}

/* ── Grouped rollups ─────────────────────────────────────────────────── */

export interface GroupRollup {
  /** Group key: projectId (vendor→projects) or vendorId (project→vendors). */
  id: string;
  purchaseValuePaise: number;
  outstandingPaise: number;
  poCount: number;
  lastSupplyDate: string | null;
  materials: string[];
}

function rollupBy(
  key: "projectId" | "vendorId",
  pos: POForRollup[],
  payments: PaymentForRollup[],
  approvalRequired: boolean,
): GroupRollup[] {
  const groups = new Map<string, GroupRollup>();
  const get = (id: string) => {
    let g = groups.get(id);
    if (!g) {
      g = { id, purchaseValuePaise: 0, outstandingPaise: 0, poCount: 0, lastSupplyDate: null, materials: [] };
      groups.set(id, g);
    }
    return g;
  };
  const materialSets = new Map<string, Set<string>>();
  for (const po of pos) {
    if (!poCounted(po.status, approvalRequired)) continue;
    const g = get(po[key]);
    g.purchaseValuePaise += po.totalPaise;
    g.outstandingPaise += po.totalPaise;
    g.poCount += 1;
    if (!g.lastSupplyDate || po.purchaseDate > g.lastSupplyDate) g.lastSupplyDate = po.purchaseDate;
    if (po.materials?.length) {
      let set = materialSets.get(po[key]);
      if (!set) materialSets.set(po[key], (set = new Set()));
      po.materials.forEach((m) => set!.add(m));
    }
  }
  for (const pay of payments) {
    // Payments count against the group even before any counted PO exists
    // (advance to a vendor on a new project) — shows as negative outstanding.
    get(pay[key]).outstandingPaise -= pay.amountPaise;
  }
  for (const [id, set] of materialSets) get(id).materials = [...set].sort();
  return [...groups.values()].sort((a, b) => b.purchaseValuePaise - a.purchaseValuePaise);
}

/** Vendor profile → Projects tab: one row per project this vendor supplied. */
export function vendorProjectRollups(
  pos: POForRollup[],
  payments: PaymentForRollup[],
  vendorId: string,
  approvalRequired: boolean,
): GroupRollup[] {
  return rollupBy(
    "projectId",
    pos.filter((p) => p.vendorId === vendorId),
    payments.filter((p) => p.vendorId === vendorId),
    approvalRequired,
  );
}

/** Project procurement tab: one row per vendor involved in the project. */
export function projectVendorRollups(
  pos: POForRollup[],
  payments: PaymentForRollup[],
  projectId: string,
  approvalRequired: boolean,
): GroupRollup[] {
  return rollupBy(
    "vendorId",
    pos.filter((p) => p.projectId === projectId),
    payments.filter((p) => p.projectId === projectId),
    approvalRequired,
  );
}

/* ── Vendor ledger (future-ready · ADR-0025) ─────────────────────────── */
// A running ledger derives entirely from existing PurchaseOrder + VendorPayment
// rows — no schema redesign needed. POs are DEBITS (what we owe), payments are
// CREDITS (what we paid); the running balance is the outstanding at each point.
// Positive balance = we owe the vendor; negative = advance credit sits with them.

export interface LedgerEntry {
  date: string;
  kind: "purchase" | "payment";
  ref: string; // PO number or payment reference/id
  debitPaise: number; // purchases increase what we owe
  creditPaise: number; // payments reduce it
  balancePaise: number; // running outstanding after this entry
}

export interface LedgerMonth {
  month: string; // YYYY-MM
  purchasesPaise: number;
  paymentsPaise: number;
  closingBalancePaise: number;
}

export interface VendorLedger {
  entries: LedgerEntry[];
  months: LedgerMonth[];
  /** Final running balance: > 0 owed to vendor, < 0 advance credit. */
  closingBalancePaise: number;
}

/** Build a vendor's running ledger + monthly summary from POs and payments. */
export function vendorLedger(
  pos: (POForRollup & { poNumber?: string })[],
  payments: (PaymentForRollup & { ref?: string })[],
  vendorId: string,
  approvalRequired: boolean,
  projectId?: string,
): VendorLedger {
  const inScope = <T extends { vendorId: string; projectId: string }>(x: T) =>
    x.vendorId === vendorId && (!projectId || x.projectId === projectId);

  const raw: Omit<LedgerEntry, "balancePaise">[] = [
    ...pos
      .filter((p) => inScope(p) && poCounted(p.status, approvalRequired))
      .map((p) => ({
        date: p.purchaseDate,
        kind: "purchase" as const,
        ref: p.poNumber ?? p.id.slice(0, 8),
        debitPaise: p.totalPaise,
        creditPaise: 0,
      })),
    ...payments.filter(inScope).map((p) => ({
      date: p.date,
      kind: "payment" as const,
      ref: p.ref ?? "Payment",
      debitPaise: 0,
      creditPaise: p.amountPaise,
    })),
  ].sort((a, b) => (a.date === b.date ? (a.kind === "purchase" ? -1 : 1) : a.date.localeCompare(b.date)));

  let balance = 0;
  const entries: LedgerEntry[] = raw.map((e) => {
    balance += e.debitPaise - e.creditPaise;
    return { ...e, balancePaise: balance };
  });

  const byMonth = new Map<string, LedgerMonth>();
  for (const e of entries) {
    const m = e.date.slice(0, 7);
    const row = byMonth.get(m) ?? { month: m, purchasesPaise: 0, paymentsPaise: 0, closingBalancePaise: 0 };
    row.purchasesPaise += e.debitPaise;
    row.paymentsPaise += e.creditPaise;
    row.closingBalancePaise = e.balancePaise; // last entry in the month wins
    byMonth.set(m, row);
  }

  return {
    entries,
    months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    closingBalancePaise: balance,
  };
}

/* ── Project procurement summary (the six cards) ─────────────────────── */

export interface ProjectProcurementSummary {
  procurementBudgetPaise: number | null;
  spentPaise: number;
  /** null when no procurement budget is set. */
  remainingPaise: number | null;
  poCount: number;
  vendorsUsed: number;
  outstandingPaise: number;
}

export function projectProcurementSummary(
  procurementBudgetPaise: number | null,
  pos: POForRollup[],
  payments: PaymentForRollup[],
  projectId: string,
  approvalRequired: boolean,
): ProjectProcurementSummary {
  const theirs = pos.filter((p) => p.projectId === projectId);
  const counted = theirs.filter((p) => poCounted(p.status, approvalRequired));
  const spent = counted.reduce((s, p) => s + p.totalPaise, 0);
  return {
    procurementBudgetPaise,
    spentPaise: spent,
    remainingPaise: procurementBudgetPaise == null ? null : procurementBudgetPaise - spent,
    poCount: theirs.length,
    vendorsUsed: new Set(counted.map((p) => p.vendorId)).size,
    outstandingPaise: outstandingPaise(pos, payments, { projectId }, approvalRequired),
  };
}
