import type {
  Contractor,
  ContractorFilters,
  ContractorLedger,
  ContractorLedgerEntry,
  ContractorSettlement,
  ContractorCostRow,
  CreateContractorInput,
  CreateSettlementInput,
  OutstandingAdvanceRow,
  RecordAdvanceInput,
  SettlementPreview,
  UpdateContractorInput,
} from "./types";

export interface SettlementPreviewInput {
  contractorId: string;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  advanceAdjustmentPaise: number;
}

export interface SettlementFilters {
  contractorId?: string;
  projectId?: string;
}

/**
 * Contractor advance & settlement ledger contract. Demo (localStorage) and
 * server (Prisma + RLS) implementations satisfy it; the UI depends only here.
 * The ledger is append-only and immutable — there are no update/delete ops.
 */
export interface ContractorsRepository {
  listContractors(filters?: ContractorFilters): Promise<Contractor[]>;
  getContractor(id: string): Promise<Contractor | null>;
  createContractor(input: CreateContractorInput): Promise<Contractor>;
  updateContractor(id: string, patch: UpdateContractorInput): Promise<Contractor>;

  /** Record an advance payment to a contractor (appends an ADVANCE entry). */
  recordAdvance(input: RecordAdvanceInput): Promise<ContractorLedgerEntry>;

  /** Full immutable ledger for a contractor, chronological. */
  getLedger(contractorId: string): Promise<ContractorLedger>;

  /** Live preview (computed bill + clamped adjustment) — does not persist. */
  previewSettlement(input: SettlementPreviewInput): Promise<SettlementPreview>;
  /** Persist a settlement + its ledger entries (LABOUR_BILL/ADJUSTMENT/PAYMENT). */
  createSettlement(input: CreateSettlementInput): Promise<ContractorSettlement>;
  listSettlements(filters?: SettlementFilters): Promise<ContractorSettlement[]>;

  // Reports
  outstandingAdvances(): Promise<OutstandingAdvanceRow[]>;
  contractorCostSummary(): Promise<ContractorCostRow[]>;
}
