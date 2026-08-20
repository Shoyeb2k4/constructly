/**
 * Contractor commercial agreements — DTOs.
 *
 * An AGREEMENT is a contractor's commercial work package on a project ("Pappu
 * Contractor → Project A → Structure, ₹60,00,000, 6 slabs"). One contractor may
 * hold several on one project, and each is financially isolated: its own scope,
 * rates, rate history, milestones, payments and reconciliation. One agreement's
 * advance must NEVER offset another's liability.
 *
 * The DB namespace stays `contractor_contracts` / `ContractorContract`; every
 * user-facing string says "agreement".
 *
 * Money is integer paise everywhere. Prisma BigInt and Decimal are converted to
 * `number` in the mappers — neither survives the RSC boundary, and a missed
 * conversion throws at runtime rather than compile time.
 */

import type { Paise } from "@/lib/money";
import type { AttendancePosition } from "./attendance-position";

/** YYYY-MM-DD. */
export type ISODate = string;

export type ContractStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "SETTLED"
  | "CANCELLED";

/**
 * PHYSICAL progress of a milestone — deliberately not a financial state.
 * Payments are cumulative at agreement level and never sit in per-milestone
 * wallets, so "settled" is DERIVED (see MilestoneFinancialState), never stamped
 * by a user.
 */
export type MilestoneStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

/** Derived from cumulative reconciliation at a milestone's completion date. */
export type MilestoneFinancialState = "NOT_EARNED" | "DUE" | "SETTLED" | "AHEAD";

export type AmendmentType =
  | "VARIATION"
  | "SCOPE_CHANGE"
  | "RATE_CHANGE"
  | "TIME_EXTENSION"
  | "OTHER";

export type AmendmentStatus = "PROPOSED" | "APPROVED" | "REJECTED";

export type ContractPaymentType =
  | "ADVANCE"
  | "INTERIM"
  | "MILESTONE"
  | "WEEKLY"
  | "DAILY"
  | "FINAL"
  | "OTHER";

export type PaymentMode = "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "CARD" | "OTHER";

/* ── Reconciliation ─────────────────────────────────────────────────────── */

/**
 * One agreement's full commercial position. Produced ONLY by
 * `reconcileAgreement` in reconcile.ts — nothing else in the app may compute
 * these numbers.
 *
 * The vocabulary matters: "outstanding" is deliberately absent. Unearned future
 * work is NOT money currently payable, and conflating them is the misstatement
 * this whole model exists to prevent.
 */
export interface AgreementReconciliation {
  agreementId: string;

  /** Value agreed at signing. Immutable. */
  originalContractValuePaise: Paise;
  /** Σ deltas of APPROVED amendments (signed). */
  amendmentDeltaPaise: Paise;
  /** AUTHORISED value = original + approved deltas. Both ceilings bind here. */
  currentContractValuePaise: Paise;

  /** Σ COMPLETED milestone values, before the authorised-value ceiling. */
  earnedValueRawPaise: Paise;
  /** Earned value actually recognised = MIN(raw, currentContractValue). */
  earnedValuePaise: Paise;
  /**
   * MAX(raw − currentContractValue, 0). Write-time guards make this impossible
   * to create, so a non-zero value means pre-existing or repaired data and is
   * surfaced as a hard warning, never silently absorbed.
   */
  earnedValueExcessPaise: Paise;

  /** Σ attendance financially RECOGNISED by a settlement for this agreement. */
  attendanceCreditPaise: Paise;
  /** Σ non-reversed payments. */
  otherPaymentCreditPaise: Paise;
  totalCreditedPaise: Paise;

  /** MAX(earned − credited, 0). What is genuinely payable today. */
  currentDuePaise: Paise;
  /** MAX(credited − earned, 0). Paid ahead of earned work — legitimate. */
  advanceCreditPaise: Paise;

  /** currentContractValue − earned. Work still to be earned; NOT payable now. */
  remainingUnearnedPaise: Paise;
  /** currentContractValue − credited. */
  overallBalancePaise: Paise;
  /** MAX(credited − currentContractValue, 0). Should always be 0 — see above. */
  overCreditedPaise: Paise;

  /**
   * Labour recorded against this agreement but NOT yet settled. INFORMATIONAL
   * ONLY — settlement is the canonical recognition of attendance money, so this
   * never reduces currentDue. It becomes credit when the period is settled.
   */
  unsettledAttendancePaise: Paise;

  /** Σ non-CANCELLED milestone values. */
  milestoneCoveragePaise: Paise;
  /** coverage − currentContractValue. A setup-time warning, never a block. */
  milestoneCoverageVariancePaise: Paise;

  milestonesTotal: number;
  milestonesCompleted: number;
}

/**
 * A portfolio position across several INDEPENDENT agreements (a contractor's
 * lifetime, a project, a company).
 *
 * Due and Ahead are SUMMED per agreement, never re-derived from summed earned
 * and credited. Re-deriving would let one agreement's advance extinguish
 * another's real liability — an ₹8,00,000 payable and a ₹3,00,000 advance are
 * both true at once and must both be shown.
 */
export interface PortfolioReconciliation {
  agreementCount: number;
  agreementIds: string[];

  totalContractValuePaise: Paise;
  totalEarnedPaise: Paise;
  totalAttendanceCreditPaise: Paise;
  totalOtherPaymentCreditPaise: Paise;
  totalCreditedPaise: Paise;

  /** Σ each agreement's currentDue. */
  totalCurrentDuePaise: Paise;
  /** Σ each agreement's advanceCredit. Can be > 0 at the same time as due. */
  totalAdvanceCreditPaise: Paise;

  totalRemainingUnearnedPaise: Paise;
  totalOverallBalancePaise: Paise;
  totalUnsettledAttendancePaise: Paise;

  /**
   * totalEarned − totalCredited (signed). INFORMATIONAL ONLY — it nets
   * agreements against each other and must never be displayed as "due".
   */
  netCommercialPositionPaise: Paise;
}

/* ── Engine inputs (assembled by the caller; the engine does no I/O) ─────── */

export interface AmendmentEntry {
  id: string;
  status: AmendmentStatus;
  deltaPaise: Paise;
  effectiveDate: ISODate;
}

export interface MilestoneEntry {
  id: string;
  sequence: number;
  title: string;
  valuePaise: Paise;
  status: MilestoneStatus;
  /** ISO timestamp; null unless COMPLETED. */
  completedAt: string | null;
}

/** One settled attendance row's contribution to an agreement. */
export interface AttendanceCreditEntry {
  id: string;
  date: ISODate;
  amountPaise: Paise;
}

export interface PaymentEntry {
  id: string;
  date: ISODate;
  amountPaise: Paise;
  type: ContractPaymentType;
  /** ISO timestamp when reversed; null while live. */
  reversedAt: string | null;
}

/** Everything reconcileAgreement needs. No DB, no clock, no locale. */
export interface AgreementSnapshot {
  agreementId: string;
  status: ContractStatus;
  originalAmountPaise: Paise;
  /** ALL amendments — filtering to APPROVED happens inside the engine. */
  amendments: AmendmentEntry[];
  /** ALL non-soft-deleted milestones. */
  milestones: MilestoneEntry[];
  /** SETTLED attendance only (settlement is the canonical recognition). */
  attendanceCredits: AttendanceCreditEntry[];
  /** ALL payments — reversal filtering happens inside the engine. */
  payments: PaymentEntry[];
  /** Recorded but not yet settled. Informational; never enters a total. */
  unsettledAttendancePaise?: Paise;
}

/* ── Records ────────────────────────────────────────────────────────────── */

export interface Contract {
  id: string;
  contractorId: string;
  contractorName: string;
  projectId: string;
  projectName: string;
  title: string;
  reference: string | null;
  scope: string | null;
  quantity: number | null;
  unit: string | null;
  originalAmountPaise: Paise;
  currentAmountPaise: Paise;
  startDate: ISODate | null;
  expectedCompletionDate: ISODate | null;
  status: ContractStatus;
  notes: string | null;
  completedAt: string | null;
  settledAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
  /** The agreement's commercial position. Always engine-derived. */
  reconciliation: AgreementReconciliation;
}

export interface ScopeItem {
  id: string;
  contractId: string;
  labourSubcategoryId: string;
  subcategoryName: string;
  categoryId: string;
  categoryName: string;
  /** Rate effective today (paise/unit). History lives in RateRevision. */
  currentRatePaise: Paise;
  rateUnit: string;
  notes: string | null;
  createdAt: string;
}

export interface RateRevision {
  id: string;
  scopeItemId: string;
  ratePaise: Paise;
  rateUnit: string;
  effectiveFrom: ISODate;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** A derived, contiguous display range for a rate. `toDate` null = still current. */
export interface RateBand {
  revisionId: string;
  fromDate: ISODate;
  toDate: ISODate | null;
  ratePaise: Paise;
  rateUnit: string;
  reason: string | null;
}

export interface Milestone {
  id: string;
  contractId: string;
  sequence: number;
  title: string;
  description: string | null;
  valuePaise: Paise;
  plannedDate: ISODate | null;
  status: MilestoneStatus;
  completedAt: string | null;
  completedByName: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  notes: string | null;
  createdAt: string;
  /**
   * HISTORICAL: the position on the day this checkpoint completed. Immutable —
   * later payments never change it, because it records what was owed then.
   */
  financialStateAtCompletion: MilestoneFinancialState;
  /**
   * CURRENT: whether today's credits cover the cumulative earned value through
   * this checkpoint. A milestone that was DUE on completion becomes SETTLED once
   * the money arrives.
   */
  currentCoverageState: MilestoneFinancialState;
  /** Cumulative earned value once this milestone completed; null if not. */
  cumulativeEarnedPaise: Paise | null;
  /** Cumulative credit as at completion; null if not completed. */
  cumulativeCreditedPaise: Paise | null;
  /**
   * Credit level at which this checkpoint counts as covered — Σ earned value
   * through it. 0 while the milestone is incomplete.
   */
  cumulativeEarnedThresholdPaise: Paise;
}

export interface Amendment {
  id: string;
  contractId: string;
  sequence: number;
  type: AmendmentType;
  previousAmountPaise: Paise;
  revisedAmountPaise: Paise;
  deltaPaise: Paise;
  reason: string;
  effectiveDate: ISODate;
  status: AmendmentStatus;
  requestedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
}

export interface ContractPayment {
  id: string;
  contractId: string;
  contractorId: string;
  projectId: string;
  amountPaise: Paise;
  type: ContractPaymentType;
  paymentMode: PaymentMode;
  referenceNumber: string | null;
  date: ISODate;
  notes: string | null;
  /** Optional milestone context. Never part of the cumulative math. */
  milestoneId: string | null;
  milestoneTitle: string | null;
  /** Set when reversed; a reversed payment contributes to nothing. */
  reversedAt: string | null;
  reversalReason: string | null;
  createdByName: string | null;
  createdAt: string;
}

/* ── Composites ─────────────────────────────────────────────────────────── */

/** Everything one agreement's detail view needs, in a single read. */
export interface AgreementDetail {
  contract: Contract;
  scopeItems: ScopeItem[];
  milestones: Milestone[];
  payments: ContractPayment[];
  amendments: Amendment[];
  timeline: TimelinePoint[];
}

/** One cumulative point on the reconciliation timeline. */
export interface TimelinePoint {
  date: ISODate;
  label: string;
  kind: "MILESTONE" | "ATTENDANCE" | "PAYMENT" | "AMENDMENT";
  deltaPaise: Paise;
  earnedValuePaise: Paise;
  attendanceCreditPaise: Paise;
  otherPaymentCreditPaise: Paise;
  totalCreditedPaise: Paise;
  currentDuePaise: Paise;
  advanceCreditPaise: Paise;
}

/** A contractor's agreements on one project. */
export interface ProjectAgreementsGroup {
  projectId: string;
  projectName: string;
  contracts: Contract[];
  rollup: PortfolioReconciliation;
}

/**
 * Where a contractor's labour sits on ONE project.
 *
 * Reported per project, and for EVERY project the contractor has attendance on
 * — including one where they hold no agreement at all, whose settled labour is
 * unattributed by definition and would otherwise have nowhere to appear.
 */
export interface ContractorProjectAttendance extends AttendancePosition {
  projectId: string;
  projectName: string;
}

/** The Contractor Detail commercial view. */
export interface ContractorProfile {
  contractor: { id: string; name: string; phone: string | null; status: string };
  projects: ProjectAgreementsGroup[];
  /** Lifetime across every project. Due and Ahead are summed, never netted. */
  lifetime: PortfolioReconciliation;
  payments: ContractPaymentHistoryRow[];
  /**
   * Labour position per project, scoped to what the caller may see. Separate
   * from `projects` because a contractor can have attendance on a project they
   * hold no agreement on.
   */
  attendance: ContractorProjectAttendance[];
  /** The same buckets summed across every VISIBLE project. */
  attendanceTotals: AttendancePosition;
}

export interface ContractPaymentHistoryRow extends ContractPayment {
  projectName: string;
  contractTitle: string;
}

/** One contractor's commercial position on a project (Project-side view). */
export interface ProjectContractorSummaryRow {
  contractorId: string;
  contractorName: string;
  agreementCount: number;
  contractValuePaise: Paise;
  earnedPaise: Paise;
  creditedPaise: Paise;
  currentDuePaise: Paise;
  advanceCreditPaise: Paise;
}

/** One audited commercial event on a contractor's agreements. */
/** A settled-attribution correction that was applied. */
export interface AttributionApplied {
  /** The ActivityLog entry id — the correction's own reference, used to reverse it. */
  correctionId: string;
  rowCount: number;
  totalPaise: Paise;
  /** Null on a reversal, which returns the labour to unattributed. */
  contractId: string | null;
  contractTitle: string | null;
}

/**
 * A refused correction. Returned as DATA, not thrown, following the convention
 * already used for duplicate contractors and blocked contractor removals: Next
 * masks Server Action error messages in production, so a deterministic domain
 * decision has to travel as a value to survive the boundary.
 */
export interface AttributionBlocked {
  blockers: string[];
  collisions?: { rowId: string; date: ISODate; labourTypeName: string }[];
}

export interface HistoryEvent {
  id: string;
  /** Dotted action key, e.g. contract.amendment_approved. */
  action: string;
  summary: string;
  /** ISO timestamp. */
  at: string;
  actorName: string | null;
  /** Money the event moved, when the audit entry recorded one. */
  amountPaise: Paise | null;
  contractId: string | null;
  contractTitle: string | null;
  projectName: string | null;
  /**
   * Present only on an attribution correction. Null = still standing and
   * reversible; a timestamp = already reversed. Absent on every other event.
   */
  attributionReversedAt?: string | null;
}

/* ── Inputs ─────────────────────────────────────────────────────────────── */

export interface CreateContractInput {
  contractorId: string;
  projectId: string;
  title: string;
  reference?: string | null;
  scope?: string | null;
  quantity?: number | null;
  unit?: string | null;
  /** The agreed value. Seeds BOTH original and current; immutable afterwards. */
  contractAmountPaise: Paise;
  startDate?: ISODate | null;
  expectedCompletionDate?: ISODate | null;
  notes?: string | null;
}

/**
 * Work-detail edits only. There is deliberately NO amount field: changing the
 * commercial value requires a proposed-and-approved amendment, so every change
 * carries a reason, an effective date and an approver.
 */
export interface UpdateContractInput {
  title?: string;
  reference?: string | null;
  scope?: string | null;
  quantity?: number | null;
  unit?: string | null;
  startDate?: ISODate | null;
  expectedCompletionDate?: ISODate | null;
  notes?: string | null;
}

export interface AddScopeItemInput {
  contractId: string;
  labourSubcategoryId: string;
  ratePaise: Paise;
  rateUnit?: string;
  effectiveFrom: ISODate;
  notes?: string | null;
}

export interface SetScopeRateInput {
  scopeItemId: string;
  ratePaise: Paise;
  rateUnit?: string;
  effectiveFrom: ISODate;
  reason?: string | null;
}

export interface CreateMilestoneInput {
  contractId: string;
  title: string;
  description?: string | null;
  valuePaise: Paise;
  plannedDate?: ISODate | null;
  sequence?: number;
  notes?: string | null;
}

export interface UpdateMilestoneInput {
  title?: string;
  description?: string | null;
  valuePaise?: Paise;
  plannedDate?: ISODate | null;
  notes?: string | null;
}

export interface ProposeAmendmentInput {
  contractId: string;
  type: AmendmentType;
  revisedAmountPaise: Paise;
  /** Required — a value change with no stated reason is not auditable. */
  reason: string;
  effectiveDate: ISODate;
}

export interface RecordContractPaymentInput {
  contractId: string;
  amountPaise: Paise;
  type: ContractPaymentType;
  paymentMode: PaymentMode;
  date: ISODate;
  referenceNumber?: string | null;
  notes?: string | null;
  /** Optional reporting context only. */
  milestoneId?: string | null;
  /** Idempotency key — a repeated submit with the same key returns the original. */
  clientUuid?: string | null;
}

export interface ContractFilters {
  contractorId?: string;
  projectId?: string;
  status?: ContractStatus | "ALL";
}
