/**
 * Governed correction of SETTLED attendance attribution — PURE.
 *
 * The operation is deliberately narrow: settled labour that carries no
 * agreement (`contract_id IS NULL`) is assigned to one, and can be assigned
 * back. Nothing else moves.
 *
 * Why this is safe to do by changing one column:
 *
 *   • Agreement attendance credit is DERIVED from `labour_attendance.contract_id`
 *     (see toSnapshot → attendanceCredits), so the credit figure follows the row
 *     automatically. There is no denormalised agreement total to drift.
 *   • The settlement's BREAKDOWN is a frozen snapshot of what that settlement
 *     knew, and reversal reads it rather than today's attendance — precisely so
 *     that a later re-attribution cannot mis-attribute historical cash. The
 *     architecture anticipated this operation.
 *
 * Why it is nevertheless governed: it changes RECOGNISED financial credit on a
 * closed settlement. It therefore needs its own permission, a stated reason, a
 * full audit trail and a way back — not an edit button.
 *
 * What it is NOT: a payment, a settlement, an advance drawdown, or a way to move
 * labour between two agreements. Agreement A → Agreement B is deliberately out
 * of scope: it DECREASES one agreement's credit, which can retroactively break a
 * satisfied position or a close-out, and needs source-side rules this version
 * does not have.
 */

import type { Paise } from "@/lib/money";
import type {
  AgreementReconciliation,
  AgreementSnapshot,
  ContractStatus,
  ISODate,
} from "./types";
import { reconcileAgreement } from "./reconcile";

/* ── Eligibility ────────────────────────────────────────────────────────── */

/**
 * Whether an agreement may RECEIVE historical attribution.
 *
 * Looser than the rules for new forward-looking commitments (a scoped advance,
 * a rate revision), and deliberately so: those commit an agreement to work not
 * yet done, whereas this records what already happened. COMPLETED especially
 * must stay open — noticing a mis-attribution at close-out is the single most
 * likely way this feature gets used.
 *
 * SETTLED is refused because close-out was only permitted while earned ===
 * credited === authorised; adding credit underneath it would make that label a
 * lie. Move the agreement back to COMPLETED first — that path already exists.
 * CANCELLED is refused because a void agreement earns nothing and is credited
 * nothing.
 */
export function attributionTargetBlockedReason(status: ContractStatus | string): string | null {
  if (status === "SETTLED") return "TARGET_AGREEMENT_SETTLED";
  if (status === "CANCELLED") return "TARGET_AGREEMENT_CANCELLED";
  return null;
}

/** One attendance row, reduced to what eligibility and collision need. */
export interface AttributionRow {
  id: string;
  date: ISODate;
  labourSubcategoryId: string;
  labourTypeName: string;
  quantityPresent: number;
  dailyRatePaiseSnapshot: Paise | null;
  estimatedCostPaise: Paise;
  contractId: string | null;
  settlementId: string | null;
  /** True when the row's settlement has been reversed. */
  settlementReversed: boolean;
}

/**
 * Why this row cannot be attributed, or null when it can.
 *
 * Unsettled rows are excluded on purpose rather than by oversight: they are
 * already freely editable through the ordinary attendance flow, so routing them
 * through a governed correction would be ceremony without benefit.
 */
export function rowBlockedReason(row: AttributionRow): string | null {
  if (row.settlementId == null) return "ROW_NOT_SETTLED";
  if (row.settlementReversed) return "ROW_SETTLEMENT_REVERSED";
  if (row.contractId != null) return "ROW_ALREADY_ATTRIBUTED";
  return null;
}

/* ── Collision ──────────────────────────────────────────────────────────── */

/**
 * The canonical five-field attendance identity, as the DB unique index defines
 * it: (project, date, labour type, contractor, agreement).
 *
 * Postgres treats NULLs as distinct, so any number of UNATTRIBUTED rows coexist
 * happily. The collision only appears at the moment of attribution, when the
 * NULL becomes a real agreement id — and it is a hard constraint, not a policy
 * choice.
 */
export function identityKey(date: ISODate, labourSubcategoryId: string): string {
  return `${date}|${labourSubcategoryId}`;
}

export interface AttributionCollision {
  rowId: string;
  date: ISODate;
  labourTypeName: string;
}

/**
 * Rows that would collide with attendance the TARGET already holds.
 *
 * Refused, never merged. Merging would have to add the two quantities and their
 * values into one settled row, which changes `quantityPresent` and
 * `estimatedCostPaise` on money a settlement has already recognised — exactly
 * the immutability this whole workflow exists to respect. A merge is a different
 * correction with different invariants, and it is out of scope.
 */
export function findCollisions(
  selected: AttributionRow[],
  existingTargetRows: { date: ISODate; labourSubcategoryId: string }[],
): AttributionCollision[] {
  const taken = new Set(existingTargetRows.map((r) => identityKey(r.date, r.labourSubcategoryId)));
  const collisions: AttributionCollision[] = [];
  // A selection can also collide with ITSELF: two unattributed rows for the same
  // day and labour type are legal today and would become one identity.
  const seen = new Set<string>();
  for (const r of selected) {
    const key = identityKey(r.date, r.labourSubcategoryId);
    if (taken.has(key) || seen.has(key)) {
      collisions.push({ rowId: r.id, date: r.date, labourTypeName: r.labourTypeName });
    }
    seen.add(key);
  }
  return collisions;
}

/* ── Preview ────────────────────────────────────────────────────────────── */

export interface AttributionPosition {
  attendanceCreditPaise: Paise;
  totalCreditedPaise: Paise;
  currentDuePaise: Paise;
  advanceCreditPaise: Paise;
  overCreditedPaise: Paise;
  earnedValuePaise: Paise;
}

export interface AttributionPreview {
  rowCount: number;
  totalPaise: Paise;
  settlementIds: string[];
  target: {
    contractId: string;
    title: string;
    projectId: string;
    projectName: string;
    status: ContractStatus | string;
  };
  before: AttributionPosition;
  after: AttributionPosition;
  unattributedBeforePaise: Paise;
  unattributedAfterPaise: Paise;
  /** Always zero. Stated rather than implied — see the note below. */
  cashImpactPaise: 0;
  /** Always zero. */
  advanceDrawdownImpactPaise: 0;
  warnings: string[];
  blockers: string[];
}

const position = (r: AgreementReconciliation): AttributionPosition => ({
  attendanceCreditPaise: r.attendanceCreditPaise,
  totalCreditedPaise: r.totalCreditedPaise,
  currentDuePaise: r.currentDuePaise,
  advanceCreditPaise: r.advanceCreditPaise,
  overCreditedPaise: r.overCreditedPaise,
  earnedValuePaise: r.earnedValuePaise,
});

/**
 * What the correction would do, computed with the CANONICAL engine.
 *
 * The "after" position is produced by appending the selected rows to the
 * agreement's own snapshot and re-running `reconcileAgreement` — the same
 * function the Command Centre renders from. There is deliberately no second
 * formula here: a preview that computes credit its own way is a preview that can
 * disagree with the write.
 *
 * Cash and advance impact are hard-coded zero because they ARE zero, and saying
 * so is the point. Attribution is a labelling correction: no payment is made, no
 * advance is consumed, no settlement is re-run. A user looking at ₹2,00,000
 * moving between columns deserves to be told explicitly that no money moved.
 */
export function buildAttributionPreview(args: {
  snapshot: AgreementSnapshot;
  target: AttributionPreview["target"];
  selected: AttributionRow[];
  /** Total settled-unattributed on this project, before the correction. */
  unattributedBeforePaise: Paise;
  collisions: AttributionCollision[];
}): AttributionPreview {
  const { snapshot, target, selected, unattributedBeforePaise, collisions } = args;

  const totalPaise = selected.reduce((t, r) => t + r.estimatedCostPaise, 0);
  const before = reconcileAgreement(snapshot);
  const after = reconcileAgreement({
    ...snapshot,
    attendanceCredits: [
      ...snapshot.attendanceCredits,
      ...selected.map((r) => ({ id: r.id, date: r.date, amountPaise: r.estimatedCostPaise })),
    ],
  });

  const blockers: string[] = [];
  const targetBlocked = attributionTargetBlockedReason(target.status);
  if (targetBlocked) blockers.push(targetBlocked);
  for (const r of selected) {
    const reason = rowBlockedReason(r);
    if (reason && !blockers.includes(reason)) blockers.push(reason);
  }
  if (collisions.length > 0) blockers.push("IDENTITY_COLLISION");
  if (selected.length === 0) blockers.push("NOTHING_SELECTED");

  const warnings: string[] = [];
  // Ahead is legitimate and must not block: settlement itself credits attendance
  // with no ceiling, and refusing here would leave the labour permanently
  // unattributable. It is surfaced so it is a decision, not a surprise.
  if (after.advanceCreditPaise > before.advanceCreditPaise) warnings.push("CREATES_AHEAD");
  if (after.overCreditedPaise > before.overCreditedPaise) warnings.push("EXCEEDS_AUTHORISED");
  const settlementIds = [...new Set(selected.map((r) => r.settlementId).filter((s): s is string => !!s))];
  if (settlementIds.length > 1) warnings.push("SPANS_SETTLEMENTS");

  return {
    rowCount: selected.length,
    totalPaise,
    settlementIds,
    target,
    before: position(before),
    after: position(after),
    unattributedBeforePaise,
    unattributedAfterPaise: unattributedBeforePaise - totalPaise,
    cashImpactPaise: 0,
    advanceDrawdownImpactPaise: 0,
    warnings,
    blockers,
  };
}

/* ── Vocabulary ─────────────────────────────────────────────────────────── */

const BLOCKER_TEXT: Record<string, string> = {
  TARGET_AGREEMENT_SETTLED:
    "That agreement is closed out as settled, so it can't take more attendance credit. Move it back to completed first.",
  TARGET_AGREEMENT_CANCELLED:
    "That agreement is cancelled, so it earns nothing and can't be credited.",
  ROW_NOT_SETTLED:
    "Some of the selected labour hasn't been settled yet — attribute it on the attendance sheet instead.",
  ROW_SETTLEMENT_REVERSED:
    "Some of the selected labour belongs to a settlement that has been reversed, so it is no longer settled.",
  ROW_ALREADY_ATTRIBUTED:
    "Some of the selected labour is already attributed to an agreement. Moving labour between agreements isn't supported yet.",
  IDENTITY_COLLISION:
    "That agreement already has attendance for the same day and labour type. Combining settled rows needs its own correction workflow.",
  NOTHING_SELECTED: "Select the labour you want to attribute.",
  INVALID_TARGET: "That agreement doesn't belong to this contractor on this project.",
  STALE_SELECTION:
    "The selected labour changed while you were reviewing it. Reopen the list and try again.",
  NOT_FOUND: "That correction no longer exists.",
  ALREADY_REVERSED: "This attribution has already been reversed.",
  REASON_REQUIRED: "A correction needs a reason.",
  FORBIDDEN: "You don't have permission to correct settled attribution.",
};

export function describeBlocker(code: string): string {
  return BLOCKER_TEXT[code] ?? "That correction can't be applied.";
}

const WARNING_TEXT: Record<string, string> = {
  CREATES_AHEAD:
    "This will credit the agreement more than it has earned, leaving it paid ahead. That can be legitimate — check it is what you mean.",
  EXCEEDS_AUTHORISED:
    "This will take total credits past the agreement's authorised value. Consider whether an amendment is needed.",
  SPANS_SETTLEMENTS: "The selected labour comes from more than one settlement.",
};

export function describeWarning(code: string): string {
  return WARNING_TEXT[code] ?? code;
}

/**
 * A collision named in words, so the refusal is actionable rather than a code.
 * The date and labour type are exactly what the user needs to find the clash.
 */
export function describeCollisions(collisions: AttributionCollision[], targetTitle: string): string {
  if (collisions.length === 0) return "";
  const [first] = collisions;
  const more = collisions.length > 1 ? ` (and ${collisions.length - 1} more)` : "";
  return (
    `This labour can't be attributed to ${targetTitle} because ${targetTitle} already has a ` +
    `${first.labourTypeName} attendance row for ${first.date}${more}. Combining settled rows ` +
    `needs its own correction workflow.`
  );
}
