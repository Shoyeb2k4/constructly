/**
 * Which actions an agreement may offer, and how a refusal reads — PURE.
 *
 * This module decides AFFORDANCE only. Every rule here already exists on the
 * server and the server remains authoritative; the point of restating it as a
 * pure projection is that the menu never offers an action the domain will refuse,
 * so a user is not taught to expect errors. When the two ever disagree, the
 * server wins and `describeAgreementError` explains it.
 *
 * The projections deliberately read from the agreement's `reconciliation` DTO
 * rather than from raw rows, because that DTO is the engine's own output — the
 * same numbers the server checks against.
 *
 * NOTE on server errors: Next.js MASKS Server Action error messages in
 * production (see the `duplicateCode` precedent in features/projects). Codes such
 * as USE_AMENDMENT therefore reach the browser intact only in development and in
 * demo mode. That is precisely why prevention is the primary mechanism here and
 * `describeAgreementError` is the safety net, not the other way round.
 */

import { formatPaiseSmart } from "@/lib/money";
import { canTransitionAgreement } from "./milestones";
import { CONTRACT_STATUS_LABEL } from "./constants";
import type { AgreementReconciliation, Contract, ContractStatus } from "./types";

/* ── Lifecycle ──────────────────────────────────────────────────────────── */

/** A status change the menu may offer, already proven legal for this agreement. */
export interface AgreementStatusAction {
  status: ContractStatus;
  label: string;
  /** Non-null when the transition is legal but currently blocked; explains why. */
  blockedReason: string | null;
  /** Consequential enough to warrant a confirmation step. */
  confirm: boolean;
}

/**
 * Plain-language names for what a transition MEANS, rather than the status it
 * lands on. "Put on hold" is what a user is doing; ON_HOLD is where it ends up.
 */
const ACTION_LABEL: Partial<Record<ContractStatus, string>> = {
  IN_PROGRESS: "Resume / mark in progress",
  ON_HOLD: "Put on hold",
  COMPLETED: "Mark completed",
  NOT_STARTED: "Move back to not started",
  SETTLED: "Close out as settled",
};

/**
 * SETTLED is the one status with a financial precondition, mirroring
 * `canSettleAgreement` on the server: the ENTIRE authorised value must be earned
 * and exactly reconciled, not merely "nothing due today".
 *
 * Derived from the reconciliation DTO because `milestonesTotal` /
 * `milestonesCompleted` already express "every non-cancelled milestone is
 * complete" — the engine excludes cancelled milestones from both counts.
 */
export function settleBlockedReason(r: AgreementReconciliation): string | null {
  const outstanding = r.milestonesTotal - r.milestonesCompleted;
  if (outstanding > 0) {
    return `${outstanding} milestone${outstanding === 1 ? " is" : "s are"} not complete yet.`;
  }
  if (r.remainingUnearnedPaise !== 0) {
    return (
      `${formatPaiseSmart(Math.abs(r.remainingUnearnedPaise))} of the authorised ` +
      `${formatPaiseSmart(r.currentContractValuePaise)} has not been earned.`
    );
  }
  if (r.currentDuePaise > 0) {
    return `${formatPaiseSmart(r.currentDuePaise)} is still due on this agreement.`;
  }
  if (r.advanceCreditPaise > 0) {
    return `${formatPaiseSmart(r.advanceCreditPaise)} has been credited ahead of earned work.`;
  }
  return null;
}

/**
 * The status changes `setContractStatus` will accept for this agreement.
 *
 * CANCELLED is deliberately absent: the server refuses it here (USE_CANCEL)
 * because cancelling is its own authority and needs a reason. It is offered
 * separately, gated on `contracts.cancel`.
 */
export function availableStatusActions(contract: Contract): AgreementStatusAction[] {
  const from = contract.status;
  return (["IN_PROGRESS", "ON_HOLD", "COMPLETED", "NOT_STARTED", "SETTLED"] as const)
    .filter((to) => to !== from && canTransitionAgreement(from, to))
    .map((status) => ({
      status,
      label: ACTION_LABEL[status] ?? CONTRACT_STATUS_LABEL[status],
      blockedReason: status === "SETTLED" ? settleBlockedReason(contract.reconciliation) : null,
      // Closing out and un-starting both restate the agreement's standing.
      confirm: status === "SETTLED" || status === "NOT_STARTED",
    }));
}

/** Cancelling preserves everything; it is refused only when already cancelled. */
/**
 * Whether an agreement may still receive NEW money earmarked for it — today,
 * an agreement-scoped labour advance.
 *
 * CANCELLED and SETTLED are refused, and the reason is specifically about money
 * getting STRANDED rather than about tidiness. An agreement-scoped advance is
 * only ever consumed by a settlement whose composition contains that agreement
 * (see allocateAdvanceDrawdown, pass A), and neither status can take further
 * attendance — `eligibleAgreements` excludes both. So money scoped to one would
 * be unusable from the moment it is recorded, and there is no re-scope or
 * transfer workflow to rescue it. Refusing at the door is the only point at
 * which this is still cheap to fix.
 *
 * NOT_STARTED, IN_PROGRESS, ON_HOLD and COMPLETED all stay open: each can still
 * take attendance, so each can still spend the money. Pre-funding an agreement
 * before work starts is ordinary, and a hold is temporary by definition.
 *
 * The same line `rateRevisionBlockedReason` draws for rates, for the same
 * underlying reason — an agreement that can take no labour can use neither a
 * rate nor an earmarked rupee.
 */
export function scopedAdvanceBlockedReason(agreementStatus: string): string | null {
  if (agreementStatus === "CANCELLED") return "AGREEMENT_CANCELLED";
  if (agreementStatus === "SETTLED") return "AGREEMENT_SETTLED";
  return null;
}

export function canCancelAgreement(contract: Contract): boolean {
  return contract.status !== "CANCELLED";
}

/**
 * Soft-delete is reserved for an agreement created by mistake and never used.
 *
 * Mirrors `deleteContract`'s HAS_FINANCIAL_HISTORY guard: any live payment,
 * completed milestone, attributed attendance or approved amendment blocks it.
 * Each of those is visible in the reconciliation DTO, so the menu can hide the
 * item rather than offer a delete that always fails. The server still re-checks —
 * a zero-value attendance row, say, is invisible here and refused there.
 */
export function canDeleteAgreement(contract: Contract): boolean {
  const r = contract.reconciliation;
  return (
    r.otherPaymentCreditPaise === 0 &&
    r.milestonesCompleted === 0 &&
    r.attendanceCreditPaise === 0 &&
    r.unsettledAttendancePaise === 0 &&
    r.amendmentDeltaPaise === 0
  );
}

/**
 * Why delete is unavailable, for the disabled item's explanation. Returns null
 * when it IS available.
 */
export function deleteBlockedReason(contract: Contract): string | null {
  if (canDeleteAgreement(contract)) return null;
  return (
    "This agreement has financial history — money recorded, work recognised or " +
    "labour attributed. Cancel it instead, which keeps every record."
  );
}

/* ── Error presentation ─────────────────────────────────────────────────── */

/**
 * Known domain refusals, keyed by the code the server throws. Several arrive as
 * `CODE: human sentence`, so the suffix is preferred when present — the server
 * already wrote the better message.
 */
const ERROR_TEXT: Record<string, string> = {
  USE_AMENDMENT:
    "An agreement's value changes only through an approved amendment, never by editing it directly.",
  USE_CANCEL: "Use Cancel agreement — cancelling needs a reason and its own permission.",
  INVALID_STATUS_TRANSITION: "That status change isn't allowed from the agreement's current state.",
  ALREADY_CANCELLED: "This agreement is already cancelled.",
  AGREEMENT_CANCELLED:
    "This agreement is cancelled, so nothing further can be recorded against it.",
  HAS_FINANCIAL_HISTORY:
    "This agreement has financial history, so it can't be deleted. Cancel it instead — that keeps every record.",
  AGREEMENT_NOT_FULLY_RECONCILED:
    "The agreement isn't fully earned and reconciled yet, so it can't be closed out as settled.",
  CREDIT_EXCEEDS_CONTRACT_VALUE:
    "This payment would take total credits past the agreement's authorised value. Raise an amendment first.",
  MILESTONE_NOT_FOUND: "That milestone no longer exists on this agreement.",
  AGREEMENT_SETTLED:
    "This agreement is closed out as settled. Move it back to completed before changing what it has earned.",
  EARNED_VALUE_EXCEEDS_CONTRACT:
    "Completing this would recognise more earned work than the agreement authorises. Raise an amendment to increase its value first.",
  MILESTONE_HAS_PAYMENTS:
    "Payments are recorded against this milestone. Reverse them before cancelling it.",
  MILESTONE_HAS_HISTORY:
    "Only a milestone that hasn't started can be deleted. Cancel it instead — that keeps the record.",
  CANCEL_REASON_REQUIRED: "Cancelling a milestone needs a reason.",
  INVALID_MILESTONE: "That milestone doesn't belong to this agreement.",
  AMENDMENT_STALE:
    "Another amendment was approved while this one was waiting, so it no longer applies to the value that now stands. Raise it again against the current authorised value.",
  AMENDMENT_NOT_PROPOSED: "This amendment has already been decided.",
  NO_VALUE_CHANGE: "The revised value is the same as the current authorised value.",
  REVISION_BELOW_CREDITED:
    "The revised value can't be below what has already been credited against this agreement.",
  REVISION_BELOW_EARNED:
    "The revised value can't be below the work already recognised as earned.",
  REASON_REQUIRED: "A reason is required.",
  SCOPE_IN_USE:
    "Labour has already been recorded against this type, so it stays in scope and keeps its rate history.",
  NOT_FOUND: "That record no longer exists — it may have been changed in another tab.",
  FORBIDDEN: "You don't have access to this project.",
  UNAUTHENTICATED: "Your session has expired. Sign in again to continue.",
};

/**
 * Turn any thrown value into something worth showing a user.
 *
 * Never surfaces a raw stack, a Next.js digest or a Prisma code. When the message
 * isn't a code we recognise — which includes every masked production Server
 * Action error — the caller's `fallback` describes what failed instead.
 */
export function describeAgreementError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!raw) return fallback;

  const [code, ...rest] = raw.split(":");
  const detail = rest.join(":").trim();
  // With no colon, `code` is the whole message — so a bare code matches here too.
  const known = ERROR_TEXT[code.trim()];
  if (known) return detail || known;

  // Anything else — a masked digest, a Prisma error, a network failure — is not
  // user-facing text. Say what failed instead of leaking internals.
  return fallback;
}
