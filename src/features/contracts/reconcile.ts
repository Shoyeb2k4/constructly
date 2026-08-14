/**
 * Agreement reconciliation — the single canonical source of every commercial
 * number in the contractor module. PURE: no I/O, no clock, no locale, integer
 * paise throughout. Server actions, the demo repository and the UI all read
 * through here so they cannot diverge.
 *
 * The question this answers, for any agreement at any moment:
 *
 *   How much work has this contractor contractually EARNED, how much value has
 *   already been CREDITED through settled attendance and other payments, how
 *   much is genuinely PAYABLE today, how much is paid AHEAD, and how much
 *   authorised work REMAINS?
 *
 * Two rules carry most of the weight:
 *
 *  1. ATTENDANCE MONEY IS RECOGNISED BY SETTLEMENT. Callers pass only settled
 *     attendance in `attendanceCredits`; unsettled labour rides along as an
 *     informational figure and never reduces what is due. That keeps a single
 *     canonical path for labour money and makes double-counting structurally
 *     impossible.
 *
 *  2. AGREEMENTS NEVER OFFSET EACH OTHER. `rollUpReconciliations` SUMS each
 *     agreement's due and ahead rather than re-deriving them from summed totals.
 *     An ₹8,00,000 payable on one agreement and a ₹3,00,000 advance on another
 *     are both true simultaneously; netting them to ₹5,00,000 would hide a real
 *     liability.
 */

import { sumPaise, formatPaiseSmart } from "@/lib/money";
import type { Paise } from "@/lib/money";
import type {
  AgreementReconciliation,
  AgreementSnapshot,
  AmendmentEntry,
  AttendanceCreditEntry,
  ISODate,
  MilestoneEntry,
  PaymentEntry,
  PortfolioReconciliation,
  TimelinePoint,
} from "./types";

/* ── Primitives ─────────────────────────────────────────────────────────── */

/**
 * Authorised value = original + Σ APPROVED amendment deltas. PROPOSED and
 * REJECTED amendments move nothing: an unapproved proposal must never change
 * what the contractor is entitled to.
 */
export function currentContractValuePaise(
  originalPaise: Paise,
  amendments: AmendmentEntry[],
): Paise {
  return (
    originalPaise +
    sumPaise(amendments.filter((a) => a.status === "APPROVED").map((a) => a.deltaPaise))
  );
}

/**
 * Σ value of COMPLETED milestones — the raw earned figure, before the
 * authorised-value ceiling. CANCELLED milestones never count, and there is no
 * SETTLED milestone status: settlement is a financial state derived from
 * cumulative reconciliation, not a physical one a user stamps.
 */
export function earnedValueRawPaise(milestones: MilestoneEntry[]): Paise {
  return sumPaise(milestones.filter((m) => m.status === "COMPLETED").map((m) => m.valuePaise));
}

/** Σ settled attendance attributed to this agreement. */
export function attendanceCreditPaise(credits: AttendanceCreditEntry[]): Paise {
  return sumPaise(credits.map((c) => c.amountPaise));
}

/** Σ non-reversed payments. A reversed payment contributes to nothing. */
export function otherPaymentCreditPaise(payments: PaymentEntry[]): Paise {
  return sumPaise(payments.filter((p) => p.reversedAt == null).map((p) => p.amountPaise));
}

/* ── The composite ──────────────────────────────────────────────────────── */

function build(
  agreementId: string,
  originalAmountPaise: Paise,
  amendments: AmendmentEntry[],
  milestones: MilestoneEntry[],
  credits: AttendanceCreditEntry[],
  payments: PaymentEntry[],
  unsettledAttendancePaise: Paise,
): AgreementReconciliation {
  const currentValue = currentContractValuePaise(originalAmountPaise, amendments);
  const earnedRaw = earnedValueRawPaise(milestones);

  // Ceiling: earned value can never exceed the AUTHORISED value. Milestone
  // completion is blocked at write time (EARNED_VALUE_EXCEEDS_CONTRACT), so a
  // non-zero excess means pre-existing or repaired data — clamped here so the
  // arithmetic stays sound, and surfaced so it can't hide.
  const earned = Math.min(earnedRaw, currentValue);
  const earnedExcess = Math.max(0, earnedRaw - currentValue);

  const attendanceCredit = attendanceCreditPaise(credits);
  const otherCredit = otherPaymentCreditPaise(payments);
  const credited = attendanceCredit + otherCredit;

  const coverage = sumPaise(
    milestones.filter((m) => m.status !== "CANCELLED").map((m) => m.valuePaise),
  );

  return {
    agreementId,
    originalContractValuePaise: originalAmountPaise,
    amendmentDeltaPaise: currentValue - originalAmountPaise,
    currentContractValuePaise: currentValue,

    earnedValueRawPaise: earnedRaw,
    earnedValuePaise: earned,
    earnedValueExcessPaise: earnedExcess,

    attendanceCreditPaise: attendanceCredit,
    otherPaymentCreditPaise: otherCredit,
    totalCreditedPaise: credited,

    // At most one of these is ever non-zero.
    currentDuePaise: Math.max(0, earned - credited),
    advanceCreditPaise: Math.max(0, credited - earned),

    remainingUnearnedPaise: currentValue - earned,
    overallBalancePaise: currentValue - credited,
    overCreditedPaise: Math.max(0, credited - currentValue),

    unsettledAttendancePaise,

    milestoneCoveragePaise: coverage,
    milestoneCoverageVariancePaise: coverage - currentValue,

    milestonesTotal: milestones.filter((m) => m.status !== "CANCELLED").length,
    milestonesCompleted: milestones.filter((m) => m.status === "COMPLETED").length,
  };
}

/** The agreement's position right now. */
export function reconcileAgreement(snapshot: AgreementSnapshot): AgreementReconciliation {
  return build(
    snapshot.agreementId,
    snapshot.originalAmountPaise,
    snapshot.amendments,
    snapshot.milestones,
    snapshot.attendanceCredits,
    snapshot.payments,
    snapshot.unsettledAttendancePaise ?? 0,
  );
}

/** Date-only prefix of an ISO timestamp, so `completedAt` compares with dates. */
function dayOf(ts: string): ISODate {
  return ts.slice(0, 10);
}

/**
 * The same math restricted to events on or before `asOf`. Powers the milestone
 * timeline and "as at 31 March" statements.
 *
 * Each event type is filtered by its own effective date: amendments by
 * effectiveDate, milestones by completedAt, credits and payments by date. A
 * milestone that completed later is treated as not yet earned — which is the
 * whole point of an as-at view.
 */
export function reconcileAsOf(
  snapshot: AgreementSnapshot,
  asOf: ISODate,
): AgreementReconciliation {
  const amendments = snapshot.amendments.filter((a) => a.effectiveDate <= asOf);
  const milestones = snapshot.milestones.map((m) =>
    m.status === "COMPLETED" && m.completedAt != null && dayOf(m.completedAt) <= asOf
      ? m
      : // Not yet complete as at this date — carried through with its value
        // intact so coverage still reflects the full plan.
        { ...m, status: m.status === "COMPLETED" ? ("IN_PROGRESS" as const) : m.status },
  );
  const credits = snapshot.attendanceCredits.filter((c) => c.date <= asOf);
  // A payment reversed LATER was still live as at this date, so it must be
  // presented as un-reversed — otherwise build()'s live reversal filter would
  // drop it and the as-at view would understate what had been credited.
  const payments = snapshot.payments
    .filter((p) => p.date <= asOf && (p.reversedAt == null || dayOf(p.reversedAt) > asOf))
    .map((p) => (p.reversedAt == null ? p : { ...p, reversedAt: null }));

  return build(
    snapshot.agreementId,
    snapshot.originalAmountPaise,
    amendments,
    milestones,
    credits,
    payments,
    // Unsettled attendance is a live figure, not a historical one.
    0,
  );
}

/**
 * One cumulative point per distinct event date, ascending. Every point carries
 * the FULL position as at that date — the brief's "cumulative at agreement
 * level, never slab buckets". Reading any row answers "where did we stand the
 * day Slab 2 completed?" without per-milestone allocation.
 */
export function reconciliationTimeline(snapshot: AgreementSnapshot): TimelinePoint[] {
  type Event = { date: ISODate; label: string; kind: TimelinePoint["kind"]; deltaPaise: Paise };
  const events: Event[] = [];

  for (const a of snapshot.amendments) {
    if (a.status !== "APPROVED") continue;
    events.push({
      date: a.effectiveDate,
      label: "Amendment approved",
      kind: "AMENDMENT",
      deltaPaise: a.deltaPaise,
    });
  }
  for (const m of snapshot.milestones) {
    if (m.status !== "COMPLETED" || m.completedAt == null) continue;
    events.push({
      date: dayOf(m.completedAt),
      label: m.title,
      kind: "MILESTONE",
      deltaPaise: m.valuePaise,
    });
  }
  for (const c of snapshot.attendanceCredits) {
    events.push({
      date: c.date,
      label: "Attendance settled",
      kind: "ATTENDANCE",
      deltaPaise: c.amountPaise,
    });
  }
  for (const p of snapshot.payments) {
    if (p.reversedAt != null) continue;
    events.push({ date: p.date, label: "Payment", kind: "PAYMENT", deltaPaise: p.amountPaise });
  }

  // Collapse to one point per date; the last event on a date names the point.
  const byDate = new Map<ISODate, Event>();
  for (const e of events) {
    const prev = byDate.get(e.date);
    byDate.set(e.date, prev ? { ...e, deltaPaise: prev.deltaPaise + e.deltaPaise } : e);
  }

  return [...byDate.keys()]
    .sort()
    .map((date) => {
      const e = byDate.get(date)!;
      const r = reconcileAsOf(snapshot, date);
      return {
        date,
        label: e.label,
        kind: e.kind,
        deltaPaise: e.deltaPaise,
        earnedValuePaise: r.earnedValuePaise,
        attendanceCreditPaise: r.attendanceCreditPaise,
        otherPaymentCreditPaise: r.otherPaymentCreditPaise,
        totalCreditedPaise: r.totalCreditedPaise,
        currentDuePaise: r.currentDuePaise,
        advanceCreditPaise: r.advanceCreditPaise,
      };
    });
}

/**
 * Roll several INDEPENDENT agreements into one portfolio position.
 *
 * The critical rule: `totalCurrentDue` and `totalAdvanceCredit` are the SUM of
 * each agreement's own figure. They are NOT re-derived from summed earned and
 * credited — doing that would let an advance on one agreement cancel a payable
 * on another, e.g.
 *
 *   Structure      earned ₹20,00,000  credited ₹12,00,000  due ₹8,00,000
 *   Compound Wall  earned ₹0          credited ₹3,00,000   ahead ₹3,00,000
 *
 *   correct → Due ₹8,00,000 AND Ahead ₹3,00,000
 *   wrong   → Due ₹5,00,000  (a real ₹3,00,000 obligation has vanished)
 *
 * `netCommercialPositionPaise` is offered for reporting only and must never be
 * rendered as an amount due.
 */
export function rollUpReconciliations(
  reconciliations: AgreementReconciliation[],
): PortfolioReconciliation {
  const totalEarned = sumPaise(reconciliations.map((r) => r.earnedValuePaise));
  const totalCredited = sumPaise(reconciliations.map((r) => r.totalCreditedPaise));

  return {
    agreementCount: reconciliations.length,
    agreementIds: reconciliations.map((r) => r.agreementId),

    totalContractValuePaise: sumPaise(reconciliations.map((r) => r.currentContractValuePaise)),
    totalEarnedPaise: totalEarned,
    totalAttendanceCreditPaise: sumPaise(reconciliations.map((r) => r.attendanceCreditPaise)),
    totalOtherPaymentCreditPaise: sumPaise(reconciliations.map((r) => r.otherPaymentCreditPaise)),
    totalCreditedPaise: totalCredited,

    totalCurrentDuePaise: sumPaise(reconciliations.map((r) => r.currentDuePaise)),
    totalAdvanceCreditPaise: sumPaise(reconciliations.map((r) => r.advanceCreditPaise)),

    totalRemainingUnearnedPaise: sumPaise(reconciliations.map((r) => r.remainingUnearnedPaise)),
    totalOverallBalancePaise: sumPaise(reconciliations.map((r) => r.overallBalancePaise)),
    totalUnsettledAttendancePaise: sumPaise(reconciliations.map((r) => r.unsettledAttendancePaise)),

    netCommercialPositionPaise: totalEarned - totalCredited,
  };
}

/* ── Write-time guards (pure; the server calls these inside its transaction) ─ */

/**
 * The CREDIT CEILING. Cumulative valid credits may never exceed the authorised
 * contract value — the amendment workflow exists precisely to raise it first.
 *
 * Note what this does NOT block: paying ahead of EARNED value is legitimate and
 * always allowed (an advance before any milestone completes is normal). Only the
 * authorised ceiling binds, and there is deliberately no override flag — a
 * caller entitled to raise the value must do so through an approved amendment,
 * where it carries a reason, an effective date and an approver.
 *
 * Returns a user-facing message, or null when the payment is allowed.
 */
export function validateCreditCeiling(args: {
  additionalCreditPaise: Paise;
  totalCreditedPaise: Paise;
  currentContractValuePaise: Paise;
}): string | null {
  const { additionalCreditPaise, totalCreditedPaise, currentContractValuePaise } = args;
  if (!Number.isInteger(additionalCreditPaise) || additionalCreditPaise <= 0) {
    return "Payment amount must be greater than zero.";
  }
  const after = totalCreditedPaise + additionalCreditPaise;
  if (after > currentContractValuePaise) {
    const headroom = Math.max(0, currentContractValuePaise - totalCreditedPaise);
    return (
      `This payment would take total credits past the agreement's authorised value. ` +
      `Authorised ${formatPaiseSmart(currentContractValuePaise)}, already credited ` +
      `${formatPaiseSmart(totalCreditedPaise)}, so at most ${formatPaiseSmart(headroom)} ` +
      `can be recorded. Raise an amendment to increase the agreement value first.`
    );
  }
  return null;
}
