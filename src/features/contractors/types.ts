/**
 * Contractor advance & settlement ledger — a weekly contractor payment ledger
 * (NOT payroll). Advances are paid ahead; weekly per-project settlements draw
 * the advance down against the computed labour bill. The ledger is immutable.
 * All money is integer paise; DTOs expose numbers.
 */

export type ContractorStatus = "ACTIVE" | "INACTIVE";

export type ContractorLedgerType =
  | "OPENING_ADVANCE"
  | "ADVANCE"
  | "LABOUR_BILL"
  | "ADJUSTMENT"
  | "PAYMENT"
  /** Written only by a settlement reversal; increases the advance balance. */
  | "SETTLEMENT_REVERSAL";

export interface Contractor {
  id: string;
  name: string;
  phone: string | null;
  status: ContractorStatus;
  openingAdvancePaise: number;
  /** Current outstanding advance balance (Σ advances − Σ adjustments). */
  advanceBalancePaise: number;
  createdAt: string;
}

export interface ContractorLedgerEntry {
  id: string;
  contractorId: string;
  date: string;
  type: ContractorLedgerType;
  amountPaise: number;
  advanceBalanceAfterPaise: number;
  notes: string | null;
  settlementId: string | null;
  /** Commercial scope. Both null = a company-wide (legacy) advance. */
  projectId: string | null;
  contractId: string | null;
  contractTitle: string | null;
  /** Explicit provenance — one meaning per field, never polymorphic. */
  drawsFromEntryId: string | null;
  reversesEntryId: string | null;
  /** For a drawdown: the composition bucket it funded (may differ from contractId). */
  fundsContractId: string | null;
  /** Enriched for display when the entry came from a settlement. */
  projectName: string | null;
  createdAt: string;
}

export interface ContractorSettlement {
  /** Set once reversed. The settlement is kept, never deleted. */
  reversedAt?: string | null;
  reversalReason?: string | null;
  id: string;
  contractorId: string;
  contractorName: string;
  projectId: string;
  projectName: string;
  periodStart: string;
  periodEnd: string;
  labourBillPaise: number;
  advanceAdjustmentPaise: number;
  netPaymentPaise: number;
  advanceBalanceAfterPaise: number;
  notes: string | null;
  createdAt: string;
}

export interface ContractorLedger {
  contractor: Contractor;
  entries: ContractorLedgerEntry[];
}

// ── Inputs ──────────────────────────────────────────────────────────────

export interface CreateContractorInput {
  name: string;
  phone?: string | null;
  openingAdvancePaise?: number;
}

export interface UpdateContractorInput {
  name?: string;
  phone?: string | null;
  status?: ContractorStatus;
}

export interface RecordAdvanceInput {
  /** Optional commercial scope. contractId requires projectId. */
  projectId?: string | null;
  contractId?: string | null;
  contractorId: string;
  date: string;
  amountPaise: number;
  notes?: string | null;
}

export interface CreateSettlementInput {
  contractorId: string;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  advanceAdjustmentPaise: number;
  notes?: string | null;
}

/** An advance this settlement may not draw on, and the reason in plain words. */
export interface UnusableAdvanceRow {
  entryId: string;
  remainingPaise: number;
  contractId: string | null;
  contractTitle: string | null;
  reason: string;
}

/** Live preview shown while composing a settlement (before it's saved). */
export interface SettlementPreview {
  labourBillPaise: number;
  /** Every outstanding advance, whatever its scope. */
  outstandingAdvancePaise: number;
  /**
   * The most that can ACTUALLY be drawn: never more than the bill, and never
   * more than the advances eligible for this period's labour. An agreement-scoped
   * advance is excluded unless that agreement is part of the settlement, so this
   * is usually smaller than the outstanding balance — and the difference is
   * explained row by row in `unusableAdvances`.
   */
  maxAdjustmentPaise: number;
  advanceAdjustmentPaise: number;
  netPaymentPaise: number;
  advanceBalanceAfterPaise: number;
  unusableAdvances: UnusableAdvanceRow[];
}

export interface ContractorFilters {
  search?: string;
  status?: ContractorStatus | "ALL";
}

export interface OutstandingAdvanceRow {
  contractorId: string;
  name: string;
  phone: string | null;
  advanceBalancePaise: number;
}

export interface ContractorCostRow {
  contractorId: string;
  name: string;
  totalBillPaise: number;
  totalPaidPaise: number;
  totalAdjustedPaise: number;
  advanceBalancePaise: number;
  settlementCount: number;
}
