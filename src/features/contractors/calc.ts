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
    // A reversal hands money back to the advance pool: either restoring a
    // drawdown, or turning already-paid net cash into an unapplied advance.
    case "SETTLEMENT_REVERSAL":
    // A re-scope IN is money arriving at a new scope. Paired with an OUT of the
    // same amount in the same transaction, so the two net to zero on the
    // contractor's balance — a transfer is never new money.
    case "SCOPE_TRANSFER_IN":
      return amountPaise;
    case "ADJUSTMENT":
    case "SCOPE_TRANSFER_OUT":
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

/* ── Agreement-scoped advances ──────────────────────────────────────────── */

/** A ledger entry as far as scope and provenance maths are concerned. */
export interface ScopedLedgerEntry {
  id: string;
  type: ContractorLedgerType;
  amountPaise: number;
  projectId: string | null;
  contractId: string | null;
  /** ADJUSTMENT: the advance it consumes. SETTLEMENT_REVERSAL: the adjustment it restores. */
  drawsFromEntryId?: string | null;
  reversesEntryId?: string | null;
  /** Oldest-first ordering key. */
  date: string;
}

export interface ScopedBalances {
  /** Advances with neither project nor agreement — the legacy company-wide pool. */
  unattributedPaise: number;
  byProject: Map<string, number>;
  byContract: Map<string, number>;
}

/**
 * The advance balance split by scope. The total still equals
 * `advanceBalancePaise` over the same entries — this only says where it sits.
 */
export function advanceBalanceByScope(entries: ScopedLedgerEntry[]): ScopedBalances {
  const out: ScopedBalances = { unattributedPaise: 0, byProject: new Map(), byContract: new Map() };
  for (const e of entries) {
    const delta = advanceDeltaPaise(e.type, e.amountPaise);
    if (delta === 0) continue;
    if (e.contractId) {
      out.byContract.set(e.contractId, (out.byContract.get(e.contractId) ?? 0) + delta);
    } else if (e.projectId) {
      out.byProject.set(e.projectId, (out.byProject.get(e.projectId) ?? 0) + delta);
    } else {
      out.unattributedPaise += delta;
    }
  }
  return out;
}

/** An advance entry and how much of it is still unconsumed. */
export interface OutstandingAdvance {
  entryId: string;
  projectId: string | null;
  contractId: string | null;
  remainingPaise: number;
  date: string;
}

/**
 * Per-advance remaining balance: amount, less drawdowns taken from it, plus any
 * of those drawdowns later restored by a reversal. Reversing therefore returns
 * money to the exact advance it came from, with its scope intact.
 *
 * Unapplied cash created by a reversal is itself an advance, so it appears here
 * too and can fund a later settlement.
 */
export function outstandingPerAdvance(entries: ScopedLedgerEntry[]): OutstandingAdvance[] {
  const consumed = new Map<string, number>();
  const byId = new Map(entries.map((e) => [e.id, e]));

  for (const e of entries) {
    if (e.type === "ADJUSTMENT" && e.drawsFromEntryId) {
      consumed.set(e.drawsFromEntryId, (consumed.get(e.drawsFromEntryId) ?? 0) + e.amountPaise);
    }
    if (e.type === "SETTLEMENT_REVERSAL" && e.reversesEntryId) {
      const source = byId.get(e.reversesEntryId)?.drawsFromEntryId;
      if (source) consumed.set(source, (consumed.get(source) ?? 0) - e.amountPaise);
    }
    // A re-scope DRAINS its source, exactly like a drawdown does — the money is
    // no longer available at that scope. It is NOT labour consumption though:
    // it funds no bucket and pays nothing, which is why it never sets
    // fundsContractId and never carries a settlementId.
    if (e.type === "SCOPE_TRANSFER_OUT" && e.drawsFromEntryId) {
      consumed.set(e.drawsFromEntryId, (consumed.get(e.drawsFromEntryId) ?? 0) + e.amountPaise);
    }
  }

  // What can FUND a settlement. Transferred-in money is a real, spendable
  // advance at its new scope — omitting it here would leave the balance correct
  // while the money itself was unspendable, which is the exact stranding this
  // feature exists to cure.
  const isAdvance = (e: ScopedLedgerEntry) =>
    e.type === "ADVANCE" ||
    e.type === "OPENING_ADVANCE" ||
    e.type === "SCOPE_TRANSFER_IN" ||
    (e.type === "SETTLEMENT_REVERSAL" && !e.reversesEntryId);

  return entries
    .filter(isAdvance)
    .map((e) => ({
      entryId: e.id,
      projectId: e.projectId,
      contractId: e.contractId,
      remainingPaise: e.amountPaise - (consumed.get(e.id) ?? 0),
      date: e.date,
    }))
    .filter((a) => a.remainingPaise > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.entryId < b.entryId ? -1 : 1));
}

/**
 * The rows being settled, grouped by the agreement they belong to. `null` is the
 * unattributed bucket.
 *
 * Before Phase 6 nothing writes `contractId`, so this is always
 * `{ null: entireBill }`; afterwards it becomes specific. The allocation rules
 * are identical in both cases — a band simply stops matching.
 */
export type BillComposition = Map<string | null, number>;

export interface AdvanceAllocation {
  /** The advance consumed. */
  entryId: string;
  /** That advance's own scope. */
  projectId: string | null;
  contractId: string | null;
  /** The composition bucket this drawdown funded (null = unattributed). */
  fundsContractId: string | null;
  amountPaise: number;
}

/**
 * Decide which advances a settlement consumes, and which bucket each drawdown
 * funds. Strict-to-broad, and never a guess:
 *
 *   A. an AGREEMENT-scoped advance funds ONLY its own agreement's bucket, and
 *      only when that agreement is actually part of this settlement. It is never
 *      spent against unattributed labour, because that labour might belong to a
 *      different agreement and the system cannot know. Before Phase 6 such an
 *      advance therefore stays outstanding — correct attribution left unconsumed
 *      beats consumption against the wrong work.
 *   B. a PROJECT-scoped advance funds any remaining bucket in that project. It
 *      carries no agreement claim to violate, so confining it to the
 *      unattributed bucket would strand it the moment attendance is attributed.
 *   C. a COMPANY-WIDE legacy advance funds any remaining bucket.
 *
 * A bucket can never absorb more than its own labour cost, so an advance cannot
 * spill into work it did not pay for. Buckets fill in a deterministic order, so
 * the same inputs always produce the same allocation and the settlement sheet can
 * preview it before anything is written.
 */
export function allocateAdvanceDrawdown(args: {
  outstanding: OutstandingAdvance[];
  /** Total adjustment requested; allocation stops once it is exhausted. */
  requestedPaise: number;
  projectId: string;
  composition: BillComposition;
  /** Bucket fill order for broader advances. Defaults to agreements, then unattributed. */
  bucketOrder?: (string | null)[];
}): AdvanceAllocation[] {
  const { outstanding, requestedPaise, projectId, composition } = args;
  if (requestedPaise <= 0) return [];

  const capacity = new Map<string | null, number>();
  for (const [bucket, share] of composition) if (share > 0) capacity.set(bucket, share);

  const order =
    args.bucketOrder ??
    [...capacity.keys()].sort((a, b) =>
      a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0,
    );

  const allocations: AdvanceAllocation[] = [];
  let budget = requestedPaise;

  const spend = (advance: OutstandingAdvance, buckets: (string | null)[]) => {
    let available = advance.remainingPaise;
    for (const bucket of buckets) {
      if (budget <= 0 || available <= 0) return;
      const room = capacity.get(bucket) ?? 0;
      if (room <= 0) continue;
      const amountPaise = Math.min(available, room, budget);
      if (amountPaise <= 0) continue;
      allocations.push({
        entryId: advance.entryId,
        projectId: advance.projectId,
        contractId: advance.contractId,
        fundsContractId: bucket,
        amountPaise,
      });
      capacity.set(bucket, room - amountPaise);
      available -= amountPaise;
      budget -= amountPaise;
    }
  };

  for (const advance of outstanding) {
    if (budget <= 0) break;
    if (advance.contractId && capacity.has(advance.contractId)) spend(advance, [advance.contractId]);
  }
  for (const advance of outstanding) {
    if (budget <= 0) break;
    if (!advance.contractId && advance.projectId === projectId) spend(advance, order);
  }
  for (const advance of outstanding) {
    if (budget <= 0) break;
    if (!advance.contractId && !advance.projectId) spend(advance, order);
  }

  return allocations;
}

/**
 * Advances that could NOT be consumed, with the reason — so the settlement sheet
 * explains an outstanding balance instead of leaving the user to wonder why a
 * scoped advance was ignored.
 */
export function unusableAdvances(args: {
  outstanding: OutstandingAdvance[];
  allocations: AdvanceAllocation[];
  projectId: string;
  composition: BillComposition;
}): { entryId: string; remainingPaise: number; contractId: string | null; reason: string }[] {
  const spent = new Map<string, number>();
  for (const a of args.allocations) spent.set(a.entryId, (spent.get(a.entryId) ?? 0) + a.amountPaise);

  return args.outstanding
    .map((a) => ({ ...a, leftPaise: a.remainingPaise - (spent.get(a.entryId) ?? 0) }))
    .filter((a) => a.leftPaise > 0)
    .map((a) => ({
      entryId: a.entryId,
      remainingPaise: a.leftPaise,
      contractId: a.contractId,
      reason:
        a.contractId && !args.composition.has(a.contractId)
          ? "Not consumed: this period's labour hasn't been attributed to that agreement."
          : a.projectId && a.projectId !== args.projectId
            ? "Not consumed: scoped to a different project."
            : "Not consumed: the settlement's labour was already fully covered.",
    }));
}

/* ── Settlement composition breakdown ───────────────────────────────────── */

export interface SettlementBucket {
  contractId: string | null;
  labourBillPaise: number;
  advanceAdjustmentPaise: number;
  netPaymentPaise: number;
}

/**
 * The immutable per-bucket record a settlement stores about itself.
 *
 * Reversal reads THIS rather than recomputing from attendance, because
 * historical attribution can legitimately change `LabourAttendance.contractId`
 * later — and a settlement attributed after the fact would otherwise reverse
 * against a composition it never actually used, mis-attributing the cash.
 *
 * Guarantees, checked by the caller before writing:
 *   Σ bill = settlement bill, Σ adjustment = settlement adjustment,
 *   Σ net = settlement net, and per bucket bill = adjustment + net.
 */
export function buildSettlementBreakdown(
  composition: BillComposition,
  allocations: AdvanceAllocation[],
): SettlementBucket[] {
  const adjustmentByBucket = new Map<string | null, number>();
  for (const a of allocations) {
    adjustmentByBucket.set(
      a.fundsContractId,
      (adjustmentByBucket.get(a.fundsContractId) ?? 0) + a.amountPaise,
    );
  }

  return [...composition.entries()]
    .filter(([, bill]) => bill > 0)
    .map(([contractId, labourBillPaise]) => {
      const advanceAdjustmentPaise = adjustmentByBucket.get(contractId) ?? 0;
      return {
        contractId,
        labourBillPaise,
        advanceAdjustmentPaise,
        netPaymentPaise: labourBillPaise - advanceAdjustmentPaise,
      };
    });
}
