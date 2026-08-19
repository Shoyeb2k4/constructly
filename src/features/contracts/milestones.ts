/**
 * Milestone lifecycle and the earned-value ceiling — PURE.
 *
 * Milestone status is PHYSICAL progress only. The financial state of a
 * checkpoint (due / settled / ahead) is DERIVED from cumulative reconciliation
 * at that checkpoint, never stamped by a user — because payments are cumulative
 * at agreement level and a milestone is not a payment bucket. Asking a user to
 * mark a slab "settled" would invite the two to disagree.
 */

import type { Paise } from "@/lib/money";
import { formatPaiseSmart } from "@/lib/money";
import { positionFor, reconcileAgreement, reconcileAsOf } from "./reconcile";
import type {
  AgreementReconciliation,
  AgreementSnapshot,
  ContractStatus,
  MilestoneEntry,
  MilestoneFinancialState,
  MilestoneStatus,
} from "./types";

/* ── Physical transitions ───────────────────────────────────────────────── */

/**
 * Un-completing (COMPLETED → IN_PROGRESS) is permitted because work is
 * sometimes signed off early and then rejected on inspection. It REDUCES earned
 * value, so the server audits it with before/after figures.
 */
export const MILESTONE_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  NOT_STARTED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED", "NOT_STARTED"],
  COMPLETED: ["IN_PROGRESS"],
  CANCELLED: ["NOT_STARTED"],
};

export function canTransitionMilestone(from: MilestoneStatus, to: MilestoneStatus): boolean {
  return MILESTONE_TRANSITIONS[from].includes(to);
}

/**
 * Guard a physical status change. Cancelling a milestone that has payments
 * booked against it is refused: the payments would be left pointing at work the
 * agreement no longer plans to do. Reverse the payments first.
 */
export function validateMilestoneTransition(args: {
  from: MilestoneStatus;
  to: MilestoneStatus;
  linkedNonReversedPaymentPaise: Paise;
}): string | null {
  const { from, to, linkedNonReversedPaymentPaise } = args;

  if (from === to) return "Milestone is already in that state.";
  if (!canTransitionMilestone(from, to)) {
    return `A ${label(from)} milestone can't move straight to ${label(to)}.`;
  }
  if (to === "CANCELLED" && linkedNonReversedPaymentPaise > 0) {
    return (
      `This milestone has ${formatPaiseSmart(linkedNonReversedPaymentPaise)} of payments ` +
      `recorded against it. Reverse those payments before cancelling it.`
    );
  }
  return null;
}

function label(s: MilestoneStatus): string {
  return s.toLowerCase().replace("_", " ");
}

/* ── The earned-value ceiling ───────────────────────────────────────────── */

/**
 * Cumulative earned value must never exceed the AUTHORISED contract value.
 *
 * Milestone values are allowed to over-cover during setup — someone planning six
 * slabs may briefly total ₹65,00,000 against a ₹60,00,000 agreement, and that is
 * a warning, not an error. But COMPLETING a milestone is financial recognition,
 * and recognising ₹65,00,000 of earned work against a ₹60,00,000 entitlement
 * would be a misstatement. The correct sequence is:
 *
 *     propose amendment → approve → authorised value rises → complete milestone
 *
 * Returns a user-facing message, or null when completion is allowed.
 */
export function validateMilestoneCompletion(args: {
  /** Σ value of milestones ALREADY completed on this agreement. */
  alreadyCompletedValuePaise: Paise;
  thisMilestoneValuePaise: Paise;
  currentContractValuePaise: Paise;
}): string | null {
  const { alreadyCompletedValuePaise, thisMilestoneValuePaise, currentContractValuePaise } = args;

  const after = alreadyCompletedValuePaise + thisMilestoneValuePaise;
  if (after > currentContractValuePaise) {
    const headroom = Math.max(0, currentContractValuePaise - alreadyCompletedValuePaise);
    return (
      `Completing this milestone would recognise ${formatPaiseSmart(after)} of earned work ` +
      `against an authorised agreement value of ` +
      `${formatPaiseSmart(currentContractValuePaise)}. ` +
      `At most ${formatPaiseSmart(headroom)} of further work can be recognised — ` +
      `raise an amendment to increase the agreement value first.`
    );
  }
  return null;
}

/** Σ value of milestones currently COMPLETED (the ceiling's left-hand side). */
export function completedValuePaise(milestones: MilestoneEntry[]): Paise {
  return milestones
    .filter((m) => m.status === "COMPLETED")
    .reduce((acc, m) => acc + m.valuePaise, 0);
}

/* ── Derived financial state ────────────────────────────────────────────── */

/**
 * What the agreement's cumulative position was at the moment this checkpoint
 * completed. An incomplete milestone has earned nothing, so it is NOT_EARNED.
 */
export function milestoneFinancialStateAtCompletion(
  snapshot: AgreementSnapshot,
  milestone: MilestoneEntry,
): MilestoneFinancialState {
  if (milestone.status !== "COMPLETED" || milestone.completedAt == null) return "NOT_EARNED";
  const at = reconcileAsOf(snapshot, milestone.completedAt.slice(0, 10));
  if (at.currentDuePaise > 0) return "DUE";
  if (at.advanceCreditPaise > 0) return "AHEAD";
  return "SETTLED";
}

/**
 * Milestones in the order their earned value accrues: by `sequence`, tiebroken
 * by id so two milestones sharing a sequence still order deterministically.
 */
function inSequenceOrder(milestones: MilestoneEntry[]): MilestoneEntry[] {
  return [...milestones].sort((a, b) =>
    a.sequence !== b.sequence ? a.sequence - b.sequence : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/**
 * Cumulative earned value up to AND INCLUDING this milestone — the credit level
 * at which this checkpoint is considered covered. Only COMPLETED milestones
 * contribute, so an incomplete earlier milestone doesn't inflate the threshold.
 */
export function cumulativeEarnedThroughPaise(
  milestones: MilestoneEntry[],
  milestone: MilestoneEntry,
): Paise {
  const ordered = inSequenceOrder(milestones);
  const index = ordered.findIndex((m) => m.id === milestone.id);
  if (index < 0) return 0;
  return ordered
    .slice(0, index + 1)
    .filter((m) => m.status === "COMPLETED")
    .reduce((acc, m) => acc + m.valuePaise, 0);
}

/**
 * Is this milestone covered by the credits standing on the agreement TODAY?
 *
 * Distinct from `milestoneFinancialStateAtCompletion`, and both are worth
 * keeping. The historical one answers "what did we owe the day this slab was
 * signed off?" and never changes. This one answers "is that slab paid for now?"
 * — so a slab that was DUE on completion becomes SETTLED once the money
 * arrives, which is what a user looking at the list actually wants to know.
 *
 * Credit is compared against the CUMULATIVE threshold through this milestone,
 * never against the milestone's own value in isolation. There is one credit pool
 * for the whole agreement; payments are never allocated to a particular
 * checkpoint, because a milestone is an earned-value marker and not a wallet.
 */
export function milestoneCurrentCoverageState(
  snapshot: AgreementSnapshot,
  milestone: MilestoneEntry,
): MilestoneFinancialState {
  if (milestone.status !== "COMPLETED") return "NOT_EARNED";

  const threshold = cumulativeEarnedThroughPaise(snapshot.milestones, milestone);
  const credited = reconcileAgreement(snapshot).totalCreditedPaise;

  if (credited < threshold) return "DUE";
  if (credited > threshold) return "AHEAD";
  return "SETTLED";
}

/* ── Agreement lifecycle ────────────────────────────────────────────────── */

export const AGREEMENT_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  NOT_STARTED: ["IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["ON_HOLD", "COMPLETED", "NOT_STARTED", "CANCELLED"],
  ON_HOLD: ["IN_PROGRESS", "NOT_STARTED", "COMPLETED", "CANCELLED"],
  COMPLETED: ["IN_PROGRESS", "SETTLED", "CANCELLED"],
  SETTLED: ["COMPLETED"],
  CANCELLED: ["NOT_STARTED"],
};

export function canTransitionAgreement(from: ContractStatus, to: ContractStatus): boolean {
  return AGREEMENT_TRANSITIONS[from].includes(to);
}

/**
 * SETTLED means the ENTIRE authorised agreement is complete and reconciled — it
 * is a final close-out, not "nothing is due right now".
 *
 * "Nothing due" alone is far too weak. A ₹60,00,000 agreement whose milestones
 * only total ₹50,00,000 can have every milestone complete, ₹50,00,000 earned,
 * ₹50,00,000 credited and ₹0 due — while ₹10,00,000 of authorised work has never
 * been earned at all. Closing that out would assert the contractor delivered the
 * whole agreement when a sixth of it was never done.
 *
 * All four must hold:
 *   • every non-cancelled milestone is COMPLETED
 *   • earned value === the authorised value (equivalently: nothing unearned)
 *   • nothing is due
 *   • nothing is paid ahead
 *
 * Together the last three mean credited === earned === authorised: the money and
 * the work both land exactly on the agreement value, with no residue either way.
 */
export function canSettleAgreement(args: {
  reconciliation: Pick<
    AgreementReconciliation,
    | "currentDuePaise"
    | "advanceCreditPaise"
    | "earnedValuePaise"
    | "currentContractValuePaise"
    | "remainingUnearnedPaise"
  >;
  milestones: MilestoneEntry[];
}): string | null {
  const { reconciliation: r, milestones } = args;

  const outstanding = milestones.filter(
    (m) => m.status !== "COMPLETED" && m.status !== "CANCELLED",
  );
  if (outstanding.length > 0) {
    return `${outstanding.length} milestone${outstanding.length === 1 ? " is" : "s are"} not complete yet.`;
  }

  // Milestones can all be complete and still not cover the authorised value —
  // under-planned coverage, not under-delivery of the plan. Either way the
  // agreement is not finished.
  if (r.remainingUnearnedPaise !== 0) {
    return (
      `${formatPaiseSmart(Math.abs(r.remainingUnearnedPaise))} of the authorised ` +
      `${formatPaiseSmart(r.currentContractValuePaise)} has not been earned. ` +
      `Add or complete the remaining milestones, or amend the agreement value down, ` +
      `before closing it out.`
    );
  }
  if (r.currentDuePaise > 0) {
    return `${formatPaiseSmart(r.currentDuePaise)} is still due on this agreement.`;
  }
  if (r.advanceCreditPaise > 0) {
    return (
      `${formatPaiseSmart(r.advanceCreditPaise)} has been credited ahead of earned work. ` +
      `Reverse the excess or amend the agreement value before closing it out.`
    );
  }
  return null;
}

/**
 * The agreement status the milestones imply. ADVISORY only — the UI may suggest
 * it, but status is never auto-applied: closing out an agreement is a decision,
 * not an arithmetic consequence.
 */
export function impliedAgreementStatus(milestones: MilestoneEntry[]): ContractStatus | null {
  const live = milestones.filter((m) => m.status !== "CANCELLED");
  if (live.length === 0) return null;
  if (live.every((m) => m.status === "COMPLETED")) return "COMPLETED";
  if (live.some((m) => m.status === "IN_PROGRESS" || m.status === "COMPLETED")) {
    return "IN_PROGRESS";
  }
  return null;
}

/* ── UI projections (pure) ──────────────────────────────────────────────── */

/**
 * PLANNED COVERAGE — how much of the authorised value the milestone plan
 * accounts for.
 *
 * Deliberately derived from the engine's own `milestoneCoveragePaise` and
 * `milestoneCoverageVariancePaise` rather than re-summing milestones, so the tab
 * and the statement can never disagree.
 *
 * Over-coverage is a WARNING, not an error: planning six slabs that briefly
 * total more than the agreement is a normal setup state. What is blocked is
 * RECOGNISING more than the authorised value — see validateMilestoneCompletion.
 */
export type CoverageState = "EXACT" | "UNDER" | "OVER" | "NONE";

export function milestoneCoverage(
  r: Pick<
    AgreementReconciliation,
    "milestoneCoveragePaise" | "milestoneCoverageVariancePaise" | "currentContractValuePaise"
  >,
): {
  state: CoverageState;
  plannedPaise: Paise;
  authorisedPaise: Paise;
  /** Signed: positive = over-covered, negative = unallocated. */
  variancePaise: Paise;
  /** Unsigned, for display alongside the wording. */
  magnitudePaise: Paise;
  message: string;
} {
  const planned = r.milestoneCoveragePaise;
  const authorised = r.currentContractValuePaise;
  const variance = r.milestoneCoverageVariancePaise;
  const magnitude = Math.abs(variance);

  const state: CoverageState =
    planned === 0 ? "NONE" : variance === 0 ? "EXACT" : variance > 0 ? "OVER" : "UNDER";

  const message =
    state === "NONE"
      ? `No milestones yet — none of the ${formatPaiseSmart(authorised)} agreement value is allocated.`
      : state === "EXACT"
        ? `Coverage complete — ${formatPaiseSmart(planned)} / ${formatPaiseSmart(authorised)}.`
        : state === "UNDER"
          ? `${formatPaiseSmart(magnitude)} not yet allocated to milestones.`
          : `${formatPaiseSmart(magnitude)} above the authorised agreement value.`;

  return { state, plannedPaise: planned, authorisedPaise: authorised, variancePaise: variance, magnitudePaise: magnitude, message };
}

/**
 * What completing this milestone would do to the agreement's position.
 *
 * Uses `positionFor` — the very function the statement's Due/Ahead lines are
 * built from — so the preview cannot drift from the result. Earned is clamped to
 * the authorised value exactly as the engine clamps it; `blockedReason` carries
 * the same refusal the server would raise, so the dialog can explain it before
 * the user commits rather than after.
 */
export function previewMilestoneCompletion(args: {
  reconciliation: Pick<
    AgreementReconciliation,
    "earnedValuePaise" | "totalCreditedPaise" | "currentContractValuePaise"
  >;
  milestoneValuePaise: Paise;
}): {
  earnedBeforePaise: Paise;
  earnedAfterPaise: Paise;
  creditedPaise: Paise;
  dueBeforePaise: Paise;
  aheadBeforePaise: Paise;
  dueAfterPaise: Paise;
  aheadAfterPaise: Paise;
  blockedReason: string | null;
} {
  const { reconciliation: r, milestoneValuePaise } = args;
  const before = positionFor(r.earnedValuePaise, r.totalCreditedPaise);

  const blockedReason = validateMilestoneCompletion({
    alreadyCompletedValuePaise: r.earnedValuePaise,
    thisMilestoneValuePaise: milestoneValuePaise,
    currentContractValuePaise: r.currentContractValuePaise,
  });

  const earnedAfter = Math.min(
    r.earnedValuePaise + milestoneValuePaise,
    r.currentContractValuePaise,
  );
  const after = positionFor(earnedAfter, r.totalCreditedPaise);

  return {
    earnedBeforePaise: r.earnedValuePaise,
    earnedAfterPaise: earnedAfter,
    creditedPaise: r.totalCreditedPaise,
    dueBeforePaise: before.currentDuePaise,
    aheadBeforePaise: before.advanceCreditPaise,
    dueAfterPaise: after.currentDuePaise,
    aheadAfterPaise: after.advanceCreditPaise,
    blockedReason,
  };
}

/** One action the milestone row may offer, already proven legal. */
export interface MilestoneAction {
  status: MilestoneStatus;
  label: string;
  /** Consequential enough to confirm; completion also previews its effect. */
  confirm: boolean;
  /** CANCELLED needs one; the server refuses without it. */
  requiresReason: boolean;
}

const MILESTONE_ACTION_LABEL: Record<MilestoneStatus, string> = {
  NOT_STARTED: "Move back to not started",
  IN_PROGRESS: "Mark in progress",
  COMPLETED: "Mark completed",
  CANCELLED: "Cancel milestone",
};

/**
 * The status changes `setMilestoneStatus` will accept for this milestone.
 *
 * Reopening a completed milestone is COMPLETED → IN_PROGRESS: the one legal move
 * out of COMPLETED, and the auditable correction path for work signed off early
 * and later rejected. It REDUCES earned value, so it confirms first.
 *
 * Returns nothing at all once the agreement itself is cancelled or settled —
 * mirroring assertMilestoneChangeAllowed on the server.
 */
export function availableMilestoneActions(
  milestone: Pick<MilestoneEntry, "status">,
  agreementStatus: ContractStatus,
): MilestoneAction[] {
  if (agreementStatus === "CANCELLED" || agreementStatus === "SETTLED") return [];
  return MILESTONE_TRANSITIONS[milestone.status].map((status) => ({
    status,
    label:
      milestone.status === "COMPLETED" && status === "IN_PROGRESS"
        ? "Reopen milestone"
        : MILESTONE_ACTION_LABEL[status],
    confirm: status === "COMPLETED" || status === "CANCELLED" || milestone.status === "COMPLETED",
    requiresReason: status === "CANCELLED",
  }));
}

/**
 * Why a milestone cannot be deleted, or null when it can.
 *
 * Mirrors `deleteMilestone`: only a never-started milestone with no payments
 * booked against it may go. Anything else is CANCELLED instead, so earned-value
 * history stays reconstructable.
 */
export function deleteMilestoneBlockedReason(
  milestone: Pick<MilestoneEntry, "status">,
  agreementStatus: ContractStatus,
): string | null {
  if (agreementStatus === "CANCELLED") return "The agreement is cancelled.";
  if (agreementStatus === "SETTLED") {
    return "The agreement is closed out as settled — move it back to completed first.";
  }
  if (milestone.status === "COMPLETED") {
    return "Completed milestones can't be deleted — reopen it first, or cancel it.";
  }
  if (milestone.status !== "NOT_STARTED") {
    return "Only a milestone that hasn't started can be deleted. Cancel it instead, which keeps the record.";
  }
  return null;
}
