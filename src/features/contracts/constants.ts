import type {
  AmendmentStatus,
  AmendmentType,
  ContractPaymentType,
  ContractStatus,
  MilestoneFinancialState,
  MilestoneStatus,
  PaymentMode,
} from "./types";

export const PAYMENT_TYPES: ContractPaymentType[] = [
  "ADVANCE",
  "INTERIM",
  "MILESTONE",
  "WEEKLY",
  "DAILY",
  "FINAL",
  "OTHER",
];
export const PAYMENT_TYPE_LABEL: Record<ContractPaymentType, string> = {
  ADVANCE: "Advance",
  INTERIM: "Interim",
  MILESTONE: "Milestone",
  WEEKLY: "Weekly",
  DAILY: "Daily",
  FINAL: "Final",
  OTHER: "Other",
};

export const PAYMENT_MODES: PaymentMode[] = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"];
export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  CARD: "Card",
  OTHER: "Other",
};

export const CONTRACT_STATUSES: ContractStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "SETTLED",
  "CANCELLED",
];
export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  SETTLED: "Settled",
  CANCELLED: "Cancelled",
};
export const CONTRACT_STATUS_TONE: Record<ContractStatus, string> = {
  NOT_STARTED: "bg-surface-muted text-foreground-muted",
  IN_PROGRESS: "bg-success-subtle text-success-foreground",
  ON_HOLD: "bg-warning-subtle text-warning-foreground",
  COMPLETED: "bg-info-subtle text-info-foreground",
  SETTLED: "bg-surface-muted text-foreground-muted",
  CANCELLED: "bg-surface-muted text-foreground-subtle line-through",
};

/** PHYSICAL milestone progress. The financial state is derived separately. */
export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
export const MILESTONE_STATUS_TONE: Record<MilestoneStatus, string> = {
  NOT_STARTED: "bg-surface-muted text-foreground-muted",
  IN_PROGRESS: "bg-warning-subtle text-warning-foreground",
  COMPLETED: "bg-success-subtle text-success-foreground",
  CANCELLED: "bg-surface-muted text-foreground-subtle line-through",
};

/**
 * DERIVED from cumulative reconciliation at the checkpoint — never a status a
 * user sets. "Due" here means money payable as at that milestone, not a label.
 */
export const MILESTONE_FINANCIAL_LABEL: Record<MilestoneFinancialState, string> = {
  NOT_EARNED: "Not earned",
  DUE: "Due",
  SETTLED: "Settled",
  AHEAD: "Paid ahead",
};

export const AMENDMENT_TYPE_LABEL: Record<AmendmentType, string> = {
  VARIATION: "Variation",
  SCOPE_CHANGE: "Scope change",
  RATE_CHANGE: "Rate change",
  TIME_EXTENSION: "Time extension",
  OTHER: "Other",
};

export const AMENDMENT_STATUS_LABEL: Record<AmendmentStatus, string> = {
  PROPOSED: "Proposed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};
