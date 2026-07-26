import type { ContractorLedgerType } from "./types";

/**
 * Pure contractor ledger / settlement math. Shared by the demo repository, the
 * server actions, and the UI preview so all three agree. Integer paise only.
 */

/** How a ledger entry moves the advance balance (+advance, −adjustment, else 0). */
export function advanceDeltaPaise(type: ContractorLedgerType, amountPaise: number): number {
  switch (type) {
    case "OPENING_ADVANCE":
    case "ADVANCE":
      return amountPaise;
    case "ADJUSTMENT":
      return -amountPaise;
    case "LABOUR_BILL":
    case "PAYMENT":
      return 0; // informational — no effect on the advance balance
  }
}

/** Current advance balance from a chronological list of ledger movements. */
export function advanceBalancePaise(
  entries: { type: ContractorLedgerType; amountPaise: number }[],
): number {
  return entries.reduce((bal, e) => bal + advanceDeltaPaise(e.type, e.amountPaise), 0);
}

/**
 * The most advance that may be adjusted against a bill: never more than the
 * outstanding advance, never more than the bill itself (net can't go negative).
 */
export function maxAdjustmentPaise(
  outstandingAdvancePaise: number,
  labourBillPaise: number,
): number {
  return Math.max(0, Math.min(outstandingAdvancePaise, labourBillPaise));
}

export interface SettlementMath {
  labourBillPaise: number;
  advanceAdjustmentPaise: number;
  netPaymentPaise: number;
  advanceBalanceAfterPaise: number;
}

/**
 * Compute a settlement, clamping the requested adjustment into the allowed
 * range. Net = bill − adjustment; remaining advance = outstanding − adjustment.
 */
export function computeSettlement(
  labourBillPaise: number,
  requestedAdjustmentPaise: number,
  outstandingAdvancePaise: number,
): SettlementMath {
  const cap = maxAdjustmentPaise(outstandingAdvancePaise, labourBillPaise);
  const adj = Math.max(0, Math.min(Math.round(requestedAdjustmentPaise), cap));
  return {
    labourBillPaise,
    advanceAdjustmentPaise: adj,
    netPaymentPaise: labourBillPaise - adj,
    advanceBalanceAfterPaise: outstandingAdvancePaise - adj,
  };
}

/**
 * Server-side validation: reject an over-adjustment outright rather than
 * silently clamp (the UI clamps for preview; the action must not accept a
 * value larger than the outstanding advance). Returns an error string or null.
 */
export function validateAdjustment(
  requestedPaise: number,
  outstandingAdvancePaise: number,
  labourBillPaise: number,
): string | null {
  if (!Number.isFinite(requestedPaise) || requestedPaise < 0)
    return "Adjustment cannot be negative";
  if (requestedPaise > outstandingAdvancePaise)
    return "Adjustment cannot exceed the outstanding advance";
  if (requestedPaise > labourBillPaise)
    return "Adjustment cannot exceed the labour bill";
  return null;
}
