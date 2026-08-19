/**
 * Amendment rules — PURE. No I/O, no clock, integer paise throughout.
 *
 * An amendment is the ONLY thing that moves an agreement's authorised value. The
 * original figure is never touched: authorised = original + Σ APPROVED deltas,
 * so what was signed and what is currently authorised stay separately readable
 * forever.
 *
 * A PROPOSED amendment moves nothing. It is a request carrying the value it was
 * proposed against, so approval can tell that the ground shifted underneath it.
 *
 * Sits alongside reconcile.ts / milestones.ts / rates.ts as an engine module
 * rather than inside server/amendments.ts, because a `"use server"` file may only
 * export async functions — and because the proposal form needs exactly the same
 * rules to preview a change before anyone commits to it.
 */

import { formatPaiseSmart } from "@/lib/money";
import type { Paise } from "@/lib/money";
import type { AgreementReconciliation, Amendment, ContractStatus } from "./types";

/* ── The floor ──────────────────────────────────────────────────────────── */

/**
 * The FLOOR on a revised agreement value: never below what has already been
 * credited, and never below the work already recognised as earned.
 *
 * Either would leave an agreement that owes more than it authorises. The
 * reconciliation engine would survive it — earned is clamped to the authorised
 * value and the excess surfaced — but the record would assert something untrue,
 * and the contractor's entitlement would silently exceed the contract.
 *
 * Applied at BOTH ends on purpose. Proposal checks it against the position at
 * proposal time; approval re-checks it against committed state, because a
 * reduction that was legitimate when raised can become illegitimate while it
 * waits — milestones completed in between carry earned value upward, and that
 * does NOT make the amendment stale (`currentAmountPaise` never moved).
 *
 * Returns `CODE: sentence`, or null when the value is allowed.
 */
export function validateRevisedValue(args: {
  revisedAmountPaise: Paise;
  reconciliation: Pick<AgreementReconciliation, "totalCreditedPaise" | "earnedValuePaise">;
}): string | null {
  const { revisedAmountPaise, reconciliation: r } = args;
  if (revisedAmountPaise < r.totalCreditedPaise) {
    return (
      `REVISION_BELOW_CREDITED: The revised value can't be below the ` +
      `${formatPaiseSmart(r.totalCreditedPaise)} already credited against this agreement.`
    );
  }
  if (revisedAmountPaise < r.earnedValuePaise) {
    return (
      `REVISION_BELOW_EARNED: The revised value can't be below the ` +
      `${formatPaiseSmart(r.earnedValuePaise)} of work already recognised as earned.`
    );
  }
  return null;
}

/* ── Proposal preview ───────────────────────────────────────────────────── */

/**
 * What a revised value WOULD mean — for the proposal form and the approval
 * confirmation, so both show the same arithmetic the server will apply.
 *
 * `deltaPaise` is SIGNED: a reduction is a negative amendment, and the direction
 * must be unmistakable rather than inferred from two figures.
 */
export function previewAmendment(args: {
  revisedAmountPaise: Paise;
  reconciliation: AgreementReconciliation;
}): {
  currentAuthorisedPaise: Paise;
  revisedAuthorisedPaise: Paise;
  deltaPaise: Paise;
  direction: "INCREASE" | "DECREASE" | "NONE";
  /** Unearned work after approval — the figure an amendment actually moves. */
  remainingUnearnedAfterPaise: Paise;
  blockedReason: string | null;
} {
  const { revisedAmountPaise, reconciliation: r } = args;
  const current = r.currentContractValuePaise;
  const delta = revisedAmountPaise - current;

  const floor = validateRevisedValue({ revisedAmountPaise, reconciliation: r });
  const blockedReason =
    delta === 0
      ? "NO_VALUE_CHANGE: The revised value is the same as the current authorised value."
      : floor;

  return {
    currentAuthorisedPaise: current,
    revisedAuthorisedPaise: revisedAmountPaise,
    deltaPaise: delta,
    direction: delta > 0 ? "INCREASE" : delta < 0 ? "DECREASE" : "NONE",
    // Earned value is untouched by an amendment — only milestone completion
    // moves it — so the whole delta lands on unearned work.
    remainingUnearnedAfterPaise: revisedAmountPaise - r.earnedValuePaise,
    blockedReason,
  };
}

/* ── Lifecycle ──────────────────────────────────────────────────────────── */

/**
 * Agreement statuses that accept a NEW proposal. Only CANCELLED is refused by
 * the server; on hold, completed and settled agreements may all still be
 * revised, because a variation is often agreed after the work is finished.
 *
 * Approval is stricter — see `canApproveAmendment`.
 */
export function canProposeAmendment(agreementStatus: ContractStatus): boolean {
  return agreementStatus !== "CANCELLED";
}

/**
 * Approval additionally refuses a SETTLED agreement: closing out was only
 * permitted while earned === credited === authorised, so moving the authorised
 * value would contradict a sign-off that already happened. Move the agreement
 * back to completed first.
 */
export function approveBlockedReason(agreementStatus: ContractStatus): string | null {
  if (agreementStatus === "CANCELLED") {
    return "This agreement is cancelled, so its value can no longer change.";
  }
  if (agreementStatus === "SETTLED") {
    return "This agreement is closed out as settled. Move it back to completed before changing its authorised value.";
  }
  return null;
}

/** Only a PROPOSED amendment can be approved or rejected. */
export function isDecidable(amendment: Pick<Amendment, "status">): boolean {
  return amendment.status === "PROPOSED";
}

/**
 * Would approving this amendment be refused as stale?
 *
 * An amendment carries the authorised value it was proposed against. If another
 * amendment has been approved since, this one's arithmetic refers to a base
 * nobody is looking at any more — approving it would compound two deltas onto a
 * figure neither approver saw. The fix is to raise it again against the value
 * that now stands, which is why the message says so.
 */
export function isStale(
  amendment: Pick<Amendment, "previousAmountPaise">,
  currentAuthorisedPaise: Paise,
): boolean {
  return amendment.previousAmountPaise !== currentAuthorisedPaise;
}

/** Σ deltas of APPROVED amendments — the "+₹5,00,000" line under the original. */
export function approvedDeltaPaise(amendments: Amendment[]): Paise {
  return amendments
    .filter((a) => a.status === "APPROVED")
    .reduce((acc, a) => acc + a.deltaPaise, 0);
}
