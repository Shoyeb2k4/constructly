import type { PurchaseOrderStatus } from "./types";

/** What "remove" does for a PO, or that it's not allowed for this actor. */
export type PODeleteAction = "DELETE" | "ARCHIVE" | "FORBIDDEN";

/**
 * Deletion policy — the single source of truth shared by the server (enforce)
 * and the UI (show the right control):
 * - DRAFT     → permanently deleted (owner or the creator).
 * - SUBMITTED → permanently deleted (owner only).
 * - APPROVED  → never hard-deleted; archived instead (owner only).
 * Archived POs are restored via unarchive, not this policy.
 */
export function poDeleteAction(
  status: PurchaseOrderStatus,
  actor: { isOwner: boolean; isCreator: boolean },
): PODeleteAction {
  switch (status) {
    case "DRAFT":
      return actor.isOwner || actor.isCreator ? "DELETE" : "FORBIDDEN";
    case "SUBMITTED":
      return actor.isOwner ? "DELETE" : "FORBIDDEN";
    case "APPROVED":
      return actor.isOwner ? "ARCHIVE" : "FORBIDDEN";
    default:
      return "FORBIDDEN";
  }
}
