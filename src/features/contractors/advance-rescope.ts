/**
 * Governed re-scope of UNUSED advance money — PURE.
 *
 * Pass 8 let a user say what an advance was for. This lets them correct that
 * answer, which until now was permanent: money recorded against the wrong
 * agreement — or stranded on one that was later cancelled — had no way back.
 *
 * The whole operation in one line:
 *
 *   MOVE AVAILABILITY, NEVER MONEY.
 *
 * A re-scope writes a PAIR of ledger rows in one transaction — an OUT at the
 * source scope and an IN at the target — so the contractor's total advance
 * balance is unchanged by construction rather than by arithmetic that could
 * drift. No cash is paid, no settlement runs, and nothing historical is
 * rewritten: the original advance row, every drawdown taken from it, and every
 * settlement it funded all stay exactly as they were. Only what the money may
 * fund NEXT changes.
 *
 * The three things this deliberately refuses to do:
 *   • move money that has already been spent (only `remaining` may move);
 *   • broaden scope silently (broadening relaxes a commercial commitment, so it
 *     warns — the reason and the confirmation are the control);
 *   • auto-correct on cancellation (a cancelled agreement is exactly where money
 *     strands, but the user decides where it goes, not the system).
 */

import type { Paise } from "@/lib/money";
import type { ContractorLedgerType } from "./types";

/* ── Scope ──────────────────────────────────────────────────────────────── */

export interface AdvanceScope {
  projectId: string | null;
  contractId: string | null;
}

export type ScopeKind = "GENERAL" | "PROJECT" | "AGREEMENT";

export function scopeKind(s: AdvanceScope): ScopeKind {
  if (s.contractId) return "AGREEMENT";
  if (s.projectId) return "PROJECT";
  return "GENERAL";
}

/** Narrowest to broadest. Used only to classify a move, never to rank money. */
const BREADTH: Record<ScopeKind, number> = { AGREEMENT: 0, PROJECT: 1, GENERAL: 2 };

export function isBroadening(from: AdvanceScope, to: AdvanceScope): boolean {
  return BREADTH[scopeKind(to)] > BREADTH[scopeKind(from)];
}

/** True when the two scopes are the same money in the same place. */
export function isSameScope(a: AdvanceScope, b: AdvanceScope): boolean {
  return (a.projectId ?? null) === (b.projectId ?? null) &&
    (a.contractId ?? null) === (b.contractId ?? null);
}

/**
 * Entry types that hold spendable advance money and may therefore be a transfer
 * SOURCE. Deliberately identical to the allocator's own `isAdvance` rule —
 * anything a settlement could draw on is something a re-scope can move, and
 * nothing else is.
 *
 * `SETTLEMENT_REVERSAL` qualifies only in its unapplied-cash shape (no
 * `reversesEntryId`); the restoring shape is a correction to another advance,
 * not an advance of its own.
 */
export function isTransferSource(
  type: ContractorLedgerType,
  reversesEntryId: string | null,
): boolean {
  if (type === "ADVANCE" || type === "OPENING_ADVANCE" || type === "SCOPE_TRANSFER_IN") return true;
  return type === "SETTLEMENT_REVERSAL" && !reversesEntryId;
}

/* ── Validation ─────────────────────────────────────────────────────────── */

export interface RescopeCheck {
  /** Money still available on the source entry, from the canonical formula. */
  remainingPaise: Paise;
  transferPaise: Paise;
  from: AdvanceScope;
  to: AdvanceScope;
}

/**
 * Why this transfer cannot proceed, in the order a user would ask.
 *
 * Over-transfer is a BLOCKER rather than a clamp: silently moving less than the
 * user asked for would leave them believing money is somewhere it isn't.
 */
export function rescopeBlockers(c: RescopeCheck): string[] {
  const blockers: string[] = [];
  if (!Number.isInteger(c.transferPaise) || c.transferPaise <= 0) {
    blockers.push("INVALID_AMOUNT");
  }
  if (c.remainingPaise <= 0) blockers.push("SOURCE_EXHAUSTED");
  else if (c.transferPaise > c.remainingPaise) blockers.push("OVER_TRANSFER");
  if (isSameScope(c.from, c.to)) blockers.push("NO_SCOPE_CHANGE");
  // An agreement scope without a project is not representable — the DB CHECK
  // says so too, and the composite FK could not be satisfied.
  if (c.to.contractId && !c.to.projectId) blockers.push("TARGET_AGREEMENT_INVALID");
  return blockers;
}

export function rescopeWarnings(from: AdvanceScope, to: AdvanceScope): string[] {
  return isBroadening(from, to) ? ["BROADENING_SCOPE"] : [];
}

/* ── Preview ────────────────────────────────────────────────────────────── */

export interface RescopeSourceDto {
  advanceId: string;
  type: ContractorLedgerType;
  date: string;
  scopeLabel: string;
  scope: AdvanceScope;
  originalPaise: Paise;
  consumedPaise: Paise;
  transferredOutPaise: Paise;
  remainingPaise: Paise;
}

export interface RescopePreview {
  source: RescopeSourceDto;
  target: { scope: AdvanceScope; label: string };
  transferPaise: Paise;
  before: { sourceAvailablePaise: Paise; targetAvailablePaise: Paise; contractorBalancePaise: Paise };
  after: { sourceAvailablePaise: Paise; targetAvailablePaise: Paise; contractorBalancePaise: Paise };
  /** Always zero. Stated rather than implied — see the note below. */
  cashImpactPaise: 0;
  historicalSettlementImpactPaise: 0;
  warnings: string[];
  blockers: string[];
}

/**
 * What the transfer would do.
 *
 * `contractorBalancePaise` is deliberately carried through unchanged rather than
 * recomputed from the proposed rows: the OUT and IN are equal and opposite, so
 * the balance CANNOT move, and showing it as a before/after pair that always
 * matches is the clearest way to say so. Cash and historical-settlement impact
 * are hard zeros for the same reason — a user watching ₹2,00,000 move between
 * columns deserves to be told plainly that no money went anywhere.
 */
export function buildRescopePreview(args: {
  source: RescopeSourceDto;
  target: { scope: AdvanceScope; label: string };
  transferPaise: Paise;
  /** Availability at the TARGET scope today, across every advance. */
  targetAvailableBeforePaise: Paise;
  contractorBalancePaise: Paise;
  /** Blockers the caller already knows about (target lifecycle, access, …). */
  extraBlockers?: string[];
}): RescopePreview {
  const { source, target, transferPaise, targetAvailableBeforePaise, contractorBalancePaise } = args;

  const blockers = [
    ...rescopeBlockers({
      remainingPaise: source.remainingPaise,
      transferPaise,
      from: source.scope,
      to: target.scope,
    }),
    ...(args.extraBlockers ?? []),
  ];
  const clean = blockers.length === 0;

  return {
    source,
    target,
    transferPaise,
    before: {
      sourceAvailablePaise: source.remainingPaise,
      targetAvailablePaise: targetAvailableBeforePaise,
      contractorBalancePaise,
    },
    after: {
      sourceAvailablePaise: clean ? source.remainingPaise - transferPaise : source.remainingPaise,
      targetAvailablePaise: clean
        ? targetAvailableBeforePaise + transferPaise
        : targetAvailableBeforePaise,
      // Unchanged, always. A transfer is not a payment.
      contractorBalancePaise,
    },
    cashImpactPaise: 0,
    historicalSettlementImpactPaise: 0,
    warnings: rescopeWarnings(source.scope, target.scope),
    blockers,
  };
}

/* ── Vocabulary ─────────────────────────────────────────────────────────── */

const BLOCKER_TEXT: Record<string, string> = {
  INVALID_AMOUNT: "Enter an amount greater than zero.",
  SOURCE_EXHAUSTED: "This advance has no unused balance left to move.",
  OVER_TRANSFER:
    "That is more than this advance has left. Only money that hasn't been used by a settlement can be moved.",
  NO_SCOPE_CHANGE: "That is the scope this advance already has — nothing would change.",
  SOURCE_NOT_FOUND: "That advance no longer exists.",
  SOURCE_NOT_TRANSFERABLE:
    "Only an advance can be re-scoped. Settlement drawdowns and labour bills aren't money you can move.",
  STALE_SOURCE_BALANCE:
    "This advance's available balance changed while you were reviewing it — a settlement may have drawn on it. Reopen and try again.",
  TARGET_PROJECT_INVALID: "That project isn't one you can put this contractor's money against.",
  TARGET_AGREEMENT_INVALID:
    "That agreement doesn't belong to this contractor on that project.",
  TARGET_AGREEMENT_SETTLED:
    "That agreement is closed out as settled, so money earmarked for it could never be spent.",
  TARGET_AGREEMENT_CANCELLED:
    "That agreement is cancelled, so money earmarked for it could never be spent.",
  TRANSFER_NOT_FOUND: "That re-scope no longer exists.",
  TRANSFER_ALREADY_REVERSED: "This re-scope has already been reversed.",
  TRANSFER_ALREADY_CONSUMED:
    "Part of the money this re-scope moved has since been used by a settlement, so it can no longer be reversed in full. Record a new re-scope for whatever is still available instead.",
  REASON_REQUIRED: "A re-scope needs a reason.",
  FORBIDDEN: "You don't have permission to re-scope advance funds.",
};

export function describeRescopeBlocker(code: string): string {
  return BLOCKER_TEXT[code] ?? "That re-scope can't be applied.";
}

/**
 * The broadening warning, named for the money it stops reserving. Specific on
 * purpose: "this money will no longer be reserved for Structure" is a fact
 * someone can act on; "scope will be broadened" is not.
 */
export function describeRescopeWarning(code: string, fromLabel: string): string {
  if (code === "BROADENING_SCOPE") {
    return `This money will no longer be reserved for ${fromLabel}. It becomes available to other eligible work for this contractor.`;
  }
  return code;
}
