/**
 * Payment financial-workflow authorization — PREPARED for a future maker-checker
 * approval/posting flow. VendorPayment has no status column yet, so nothing calls
 * these in production today; they are pure, unit-tested helpers that the eventual
 * approvePayment / editPayment / cancelPayment actions will use, so the
 * authorization rules land ready and proven:
 *
 *  - Payment approval is a DEDICATED permission (payments.approve), never edit.
 *  - Once a payment is APPROVED or POSTED it is locked: ordinary payments.edit
 *    must no longer modify it (it can only be cancelled).
 *  - Maker-checker: the approver must differ from the creator (creator ≠ approver).
 */

export type PaymentStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "POSTED" | "CANCELLED";

/** Statuses in which a payment is locked against ordinary edits. */
export const LOCKED_PAYMENT_STATUSES: readonly PaymentStatus[] = ["APPROVED", "POSTED"];

/** A payment that is approved or posted can no longer be edited (only cancelled). */
export function isPaymentLocked(status: string | null | undefined): boolean {
  return status != null && (LOCKED_PAYMENT_STATUSES as readonly string[]).includes(status);
}

/**
 * Guard a future editPayment: refuse to modify a locked (approved/posted)
 * payment regardless of the payments.edit permission. Throws "IMMUTABLE".
 */
export function assertPaymentEditable(status: string | null | undefined): void {
  if (isPaymentLocked(status)) throw new Error("IMMUTABLE");
}

/**
 * Maker-checker: the user approving a payment must not be the one who created it.
 * Throws "MAKER_CHECKER". Prepared for the future approvePayment action.
 */
export function assertDifferentApprover(createdById: string, approverId: string): void {
  if (createdById === approverId) throw new Error("MAKER_CHECKER");
}
