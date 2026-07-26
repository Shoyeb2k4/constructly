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
  | "PAYMENT";

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
  /** Enriched for display when the entry came from a settlement. */
  projectName: string | null;
  createdAt: string;
}

export interface ContractorSettlement {
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

/** Live preview shown while composing a settlement (before it's saved). */
export interface SettlementPreview {
  labourBillPaise: number;
  outstandingAdvancePaise: number;
  maxAdjustmentPaise: number;
  advanceAdjustmentPaise: number;
  netPaymentPaise: number;
  advanceBalanceAfterPaise: number;
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
