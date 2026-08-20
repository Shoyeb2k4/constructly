import type { AdvanceScope, RescopePreview } from "./advance-rescope";
import type { RescopeApplied, RescopeBlocked } from "./server/advance-rescope";
import type { DuplicateMatch } from "./lifecycle";
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
  /** Returns `{ duplicates }` instead of creating when a look-alike exists and
   *  the caller has not yet passed `allowDuplicate`. */
  createContractor(
    input: CreateContractorInput & { allowDuplicate?: boolean },
  ): Promise<Contractor | { duplicates: DuplicateMatch[] }>;
  findContractorDuplicates(candidate: {
    name: string;
    phone?: string | null;
  }): Promise<DuplicateMatch[]>;
  /** Deactivate: keeps every record, stops new business. */
  archiveContractor(id: string): Promise<Contractor>;
  restoreContractor(id: string): Promise<Contractor>;
  updateContractor(id: string, patch: UpdateContractorInput): Promise<Contractor>;

  /** Record an advance payment to a contractor (appends an ADVANCE entry). */
  recordAdvance(input: RecordAdvanceInput): Promise<ContractorLedgerEntry>;

  /** Full immutable ledger for a contractor, chronological. */
  getLedger(contractorId: string): Promise<ContractorLedger>;

  // Governed re-scope of UNUSED advance money. Cash-neutral and balance-neutral;
  // refusals come back as `{ blockers }` so they survive production masking.
  previewAdvanceRescope(input: {
    contractorId: string;
    advanceId: string;
    target: AdvanceScope;
    transferPaise: number;
  }): Promise<RescopePreview | RescopeBlocked>;
  rescopeAdvance(input: {
    contractorId: string;
    advanceId: string;
    target: AdvanceScope;
    transferPaise: number;
    reason: string;
  }): Promise<RescopeApplied | RescopeBlocked>;
  reverseAdvanceRescope(input: {
    transferId: string;
    reason: string;
  }): Promise<RescopeApplied | RescopeBlocked>;

  /** Live preview (computed bill + clamped adjustment) — does not persist. */
  previewSettlement(input: SettlementPreviewInput): Promise<SettlementPreview>;
  /** Persist a settlement + its ledger entries (LABOUR_BILL/ADJUSTMENT/PAYMENT). */
  createSettlement(input: CreateSettlementInput): Promise<ContractorSettlement>;
  listSettlements(filters?: SettlementFilters): Promise<ContractorSettlement[]>;

  // Reports
  /**
   * Reverse a settlement. Un-recognises the labour, restores each drawdown to
   * the advance it came from, and turns the already-paid net cash into an
   * unapplied advance — per composition bucket, so agreement attribution the
   * settlement recorded is never collapsed into anonymous project money.
   */
  reverseSettlement(settlementId: string, reason: string): Promise<ContractorSettlement>;
  outstandingAdvances(): Promise<OutstandingAdvanceRow[]>;
  contractorCostSummary(): Promise<ContractorCostRow[]>;
}
