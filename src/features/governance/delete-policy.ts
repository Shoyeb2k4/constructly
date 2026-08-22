/**
 * What "Delete" means, entity by entity.
 *
 * Constructly's destructive actions grew up one module at a time, each correct
 * in isolation, none written down together. The result was a product where the
 * same word meant five different things — an unused agreement really is removed,
 * a project goes to a recycle bin, a settlement can only be reversed, and a
 * recorded advance cannot be undone at all — with nothing stating which was
 * which except the code that implemented it.
 *
 * This is that statement. It grants nothing and blocks nothing: the server
 * actions remain the only authority, and every rule here is asserted against
 * them in `delete-policy.test.ts`. What it buys is a single place to answer
 * "what happens if I press Delete on this?" — for the UI, for a reviewer, and
 * for whoever adds the next entity.
 *
 * The rule the matrix encodes: **an operation may not change what already
 * happened.** Cash that moved, work that was recognised, and rates that priced
 * historical labour are corrected by appending a reversal, never by erasure.
 */

export type DeleteOutcome =
  /** The row is genuinely gone. Only where nothing references it and no history moves. */
  | "HARD_DELETE"
  /** Hidden from active use, recoverable, and still present in history. */
  | "SOFT_DELETE"
  /** The domain's own inactive lifecycle — the record stays fully readable. */
  | "ARCHIVE"
  /** A lifecycle close that preserves everything, e.g. cancelling an agreement. */
  | "CANCEL"
  /** Corrected by appending an opposing entry. The original stays visible. */
  | "REVERSE"
  /** No safe path exists. The UI must say why rather than offering a button. */
  | "REFUSE";

export interface DeletePolicy {
  /** What the user sees on the control. Never "Delete" where the truth is "Reverse". */
  label: string;
  outcome: DeleteOutcome;
  /** The outcome when the record is untouched — many entities have two modes. */
  whenUnused?: DeleteOutcome;
  /** Server errors that mean "refused", so the UI can explain rather than retry. */
  blockers: string[];
  /** One sentence for the confirmation dialog, in the user's words. */
  explains: string;
  /** True when the operation can itself be undone. */
  recoverable: boolean;
}

/**
 * Every business record that has a destructive or corrective action, and what
 * that action actually does.
 */
export const DELETE_POLICY = {
  /* ── Projects ──────────────────────────────────────────────────────── */
  project: {
    label: "Delete project",
    outcome: "SOFT_DELETE",
    blockers: ["INVALID_PASSWORD", "FORBIDDEN"],
    explains:
      "The project leaves active operations and moves to the Owner's deleted list. Its labour, orders, payments and agreements are kept and can be restored.",
    recoverable: true,
  },
  projectDeadline: {
    label: "Remove deadline",
    outcome: "HARD_DELETE",
    blockers: [],
    explains:
      "A deadline is a reminder rather than a financial record, so removing it changes nothing about money or work already done.",
    recoverable: false,
  },
  projectContractorAssignment: {
    label: "Remove from project",
    outcome: "HARD_DELETE",
    blockers: ["HAS_ATTENDANCE", "HAS_SETTLEMENTS", "HAS_LIVE_AGREEMENT"],
    explains:
      "Removes the contractor from this project. Refused while attendance, settlements or a live agreement still depend on the relationship.",
    recoverable: false,
  },

  /* ── Contractors ───────────────────────────────────────────────────── */
  contractor: {
    label: "Archive contractor",
    outcome: "ARCHIVE",
    blockers: [],
    explains:
      "The contractor takes on no new work. Every agreement, settlement, advance and attendance row is kept in full, and they can be reactivated.",
    recoverable: true,
  },

  /* ── Agreements ────────────────────────────────────────────────────── */
  agreement: {
    label: "Delete agreement",
    outcome: "SOFT_DELETE",
    whenUnused: "SOFT_DELETE",
    blockers: ["HAS_FINANCIAL_HISTORY"],
    explains:
      "Only an agreement with no payments, no completed milestones, no settled attendance and no approved amendments can be deleted. Otherwise cancel it, which keeps its history.",
    recoverable: false,
  },
  agreementCancel: {
    label: "Cancel agreement",
    outcome: "CANCEL",
    blockers: [],
    explains:
      "The agreement stops accepting new work but keeps everything already recorded against it.",
    recoverable: false,
  },
  scopeItem: {
    label: "Remove from scope",
    outcome: "SOFT_DELETE",
    blockers: ["SCOPE_IN_USE"],
    explains:
      "Refused once attendance has been recorded against this labour type on this agreement — removing it would orphan work that was already priced.",
    recoverable: false,
  },
  rateRevision: {
    label: "Revise rate",
    outcome: "REFUSE",
    blockers: ["RATE_IS_HISTORICAL"],
    explains:
      "Rates are append-only. A revision that priced past attendance cannot be deleted, because that would reprice work already recorded. Add a new revision instead.",
    recoverable: false,
  },
  milestone: {
    label: "Delete milestone",
    outcome: "SOFT_DELETE",
    blockers: ["MILESTONE_HAS_HISTORY", "MILESTONE_HAS_PAYMENTS"],
    explains:
      "Only a milestone that has not started and carries no payment can be deleted. A completed milestone has recognised earned value and must be reopened first.",
    recoverable: false,
  },
  amendment: {
    label: "Delete amendment",
    outcome: "SOFT_DELETE",
    whenUnused: "SOFT_DELETE",
    blockers: ["AMENDMENT_APPROVED"],
    explains:
      "A proposed or rejected amendment can be removed. An approved one has already changed the authorised value and is kept as history.",
    recoverable: false,
  },

  /* ── Contractor cash ───────────────────────────────────────────────── */
  advance: {
    label: "Advance recorded",
    outcome: "REFUSE",
    blockers: ["ADVANCE_IS_CASH"],
    explains:
      "An advance is cash that was handed over. It cannot be deleted. Move unused money with Re-scope, or draw it down through a settlement.",
    recoverable: false,
  },
  advanceRescope: {
    label: "Reverse re-scope",
    outcome: "REVERSE",
    blockers: ["RESCOPE_CONSUMED"],
    explains:
      "Puts the money back where it came from. Refused once a settlement has drawn on it, because that would unpick work already settled.",
    recoverable: false,
  },
  settlement: {
    label: "Reverse settlement",
    outcome: "REVERSE",
    blockers: ["ALREADY_REVERSED"],
    explains:
      "Returns the advance it drew down and the cash it paid. The settlement stays visible, marked reversed, with the reason recorded.",
    recoverable: false,
  },
  agreementPayment: {
    label: "Reverse payment",
    outcome: "REVERSE",
    blockers: ["ALREADY_REVERSED"],
    explains:
      "The payment stays visible with its original amount and stops counting toward what has been credited. A reason is required.",
    recoverable: false,
  },

  /* ── Labour ────────────────────────────────────────────────────────── */
  attendance: {
    label: "Clear attendance",
    outcome: "HARD_DELETE",
    blockers: ["ATTENDANCE_SETTLED", "ATTENDANCE_LOCKED"],
    explains:
      "Unsettled attendance can be corrected freely. Once a settlement has recognised it, the row is financially immutable — reverse the settlement instead.",
    recoverable: false,
  },
  labourType: {
    label: "Delete labour type",
    outcome: "SOFT_DELETE",
    whenUnused: "HARD_DELETE",
    blockers: ["IN_USE"],
    explains:
      "A labour type with recorded attendance is archived rather than removed, so historical rows keep their meaning. Owner Force Delete exists for genuine mistakes and states exactly what it will take with it.",
    recoverable: false,
  },

  /* ── Procurement ───────────────────────────────────────────────────── */
  purchaseOrder: {
    label: "Delete purchase order",
    outcome: "HARD_DELETE",
    whenUnused: "HARD_DELETE",
    blockers: ["PO_HAS_PAYMENTS"],
    explains:
      "Only an order with no payments recorded against it can be deleted, and then the ordered value leaves the budget with it. Once a payment exists the order stays, because the cash it paid for would otherwise have nothing to point at.",
    recoverable: false,
  },
  vendor: {
    label: "Archive vendor",
    outcome: "ARCHIVE",
    blockers: [],
    explains:
      "The vendor stops appearing for new orders and payments. Every purchase order and payment keeps them as its counterparty, and they can be reactivated. There is no permanent delete for a vendor, even one that has never been used.",
    recoverable: true,
  },
  vendorPayment: {
    label: "Vendor payment recorded",
    outcome: "REFUSE",
    blockers: ["VENDOR_PAYMENT_IMMUTABLE"],
    explains:
      "Vendor payments cannot currently be reversed or deleted after recording. This is a known gap: unlike contractor payments, the domain has no reversal for them, and deleting one would remove cash movement from the Payments centre and from every report that counts it.",
    recoverable: false,
  },

  /* ── Administration ────────────────────────────────────────────────── */
  user: {
    label: "Remove from company",
    outcome: "HARD_DELETE",
    blockers: ["LAST_OWNER", "SELF"],
    explains:
      "Removes their access. The last active owner can never be removed, and you cannot remove yourself.",
    recoverable: false,
  },
  invitation: {
    label: "Cancel invitation",
    outcome: "HARD_DELETE",
    blockers: [],
    explains:
      "An unaccepted invitation carries no history, so cancelling it removes the invite and nothing else. You can always send another.",
    recoverable: false,
  },
  customRole: {
    label: "Delete role",
    outcome: "HARD_DELETE",
    blockers: ["ROLE_IN_USE"],
    explains:
      "The role is removed and stops existing for this company. Anyone holding it must be reassigned first, so nobody is left without access.",
    recoverable: false,
  },
  builtInRole: {
    label: "Built-in role",
    outcome: "REFUSE",
    blockers: ["PROTECTED_ROLE"],
    explains:
      "Built-in roles are maintained by Constructly and cannot be edited or deleted. Duplicate one to build your own.",
    recoverable: false,
  },

  /* ── Audit ─────────────────────────────────────────────────────────── */
  activityLog: {
    label: "Audit history",
    outcome: "REFUSE",
    blockers: ["AUDIT_IMMUTABLE"],
    explains:
      "Audit history is never deletable, by anyone, including the Owner. It is the record of what was done and by whom.",
    recoverable: false,
  },
} as const satisfies Record<string, DeletePolicy>;

export type GovernedEntity = keyof typeof DELETE_POLICY;

export function deletePolicy(entity: GovernedEntity): DeletePolicy {
  return DELETE_POLICY[entity];
}

/** Entities whose records represent money that moved or work recognised. */
export const FINANCIAL_HISTORY_ENTITIES = [
  "advance",
  "settlement",
  "agreementPayment",
  "advanceRescope",
  "vendorPayment",
  "rateRevision",
  "activityLog",
] as const satisfies readonly GovernedEntity[];

/**
 * Can this entity's history ever be destroyed by a delete? For the records
 * above the answer must always be no — that is the invariant the whole matrix
 * exists to hold, and `delete-policy.test.ts` asserts it entity by entity.
 */
export function destroysHistory(entity: GovernedEntity): boolean {
  const policy = DELETE_POLICY[entity];
  return policy.outcome === "HARD_DELETE" && policy.blockers.length === 0;
}
