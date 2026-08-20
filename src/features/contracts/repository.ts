import type { AttributionPreview } from "./attribution";
import type { UnattributedRowDto } from "./server/attribution";
import type {
  AgreementDetail,
  AddScopeItemInput,
  Amendment,
  Contract,
  ContractFilters,
  ContractorProfile,
  HistoryEvent,
  ContractStatus,
  CreateContractInput,
  CreateMilestoneInput,
  Milestone,
  MilestoneStatus,
  ProjectContractorSummaryRow,
  ProposeAmendmentInput,
  RateRevision,
  RecordContractPaymentInput,
  ScopeItem,
  SetScopeRateInput,
  UpdateContractInput,
  UpdateMilestoneInput,
  AttributionApplied,
  AttributionBlocked,
} from "./types";

/**
 * The agreements data surface — implemented by BOTH the real server actions and
 * the in-memory demo repository, so the UI behaves identically in either mode.
 *
 * The demo implementation must call the SAME pure engine (reconcile / rates /
 * milestones) rather than reimplementing any arithmetic. That is what keeps demo
 * mode honest as a rehearsal of production.
 */
export interface ContractsRepository {
  // Agreements
  listContracts(filters?: ContractFilters): Promise<Contract[]>;
  getContract(id: string): Promise<AgreementDetail | null>;
  createContract(input: CreateContractInput): Promise<Contract>;
  /** Work details only — an amount here is refused (USE_AMENDMENT). */
  updateContract(id: string, patch: UpdateContractInput): Promise<Contract>;
  /** Physical lifecycle change; SETTLED additionally requires nothing be due. */
  setContractStatus(id: string, status: ContractStatus): Promise<Contract>;
  /** Preserves all history. The path for an agreement with financial activity. */
  cancelContract(id: string, reason: string): Promise<Contract>;
  /** Only ever for a never-used agreement; otherwise HAS_FINANCIAL_HISTORY. */
  deleteContract(id: string): Promise<void>;

  // Scope & effective-dated rates
  listScopeItems(contractId: string): Promise<ScopeItem[]>;
  addScopeItem(input: AddScopeItemInput): Promise<ScopeItem>;
  removeScopeItem(id: string): Promise<void>;
  listRateRevisions(scopeItemId: string): Promise<RateRevision[]>;
  /** Appends a revision — never overwrites the previous rate. */
  setScopeRate(input: SetScopeRateInput): Promise<ScopeItem>;

  // Milestones (earned value)
  listMilestones(contractId: string): Promise<Milestone[]>;
  createMilestone(input: CreateMilestoneInput): Promise<Milestone[]>;
  createMilestonesBulk(contractId: string, inputs: CreateMilestoneInput[]): Promise<Milestone[]>;
  updateMilestone(id: string, patch: UpdateMilestoneInput): Promise<Milestone[]>;
  /** Presentation order only — never touches value. */
  reorderMilestones(contractId: string, orderedIds: string[]): Promise<Milestone[]>;
  /** COMPLETED is blocked past the authorised value (EARNED_VALUE_EXCEEDS_CONTRACT). */
  setMilestoneStatus(id: string, status: MilestoneStatus, opts?: { reason?: string | null }): Promise<Milestone[]>;
  deleteMilestone(id: string): Promise<Milestone[]>;

  // Amendments (the only way the authorised value changes)
  listAmendments(contractId: string): Promise<Amendment[]>;
  proposeAmendment(input: ProposeAmendmentInput): Promise<Amendment[]>;
  approveAmendment(id: string): Promise<Amendment[]>;
  rejectAmendment(id: string, reason: string): Promise<Amendment[]>;

  // Payments
  recordContractPayment(input: RecordContractPaymentInput): Promise<AgreementDetail>;
  reverseContractPayment(id: string, reason: string): Promise<void>;

  /** Audited commercial events across this contractor's agreements. */
  listHistory(contractorId: string): Promise<HistoryEvent[]>;

  // Settled-attribution correction. Refusals come back as `{ blockers }` rather
  // than thrown, so a deterministic decision survives production error masking.
  listAttributableLabour(contractorId: string, projectId: string): Promise<UnattributedRowDto[]>;
  previewAttribution(input: {
    contractorId: string;
    projectId: string;
    contractId: string;
    attendanceIds: string[];
  }): Promise<AttributionPreview | { blockers: string[] }>;
  attributeSettledLabour(input: {
    contractorId: string;
    projectId: string;
    contractId: string;
    attendanceIds: string[];
    reason: string;
  }): Promise<AttributionApplied | AttributionBlocked>;
  reverseAttribution(input: {
    correctionId: string;
    reason: string;
  }): Promise<AttributionApplied | AttributionBlocked>;

  // Reconciliation surfaces
  getContractorProfile(contractorId: string): Promise<ContractorProfile | null>;
  projectContractsSummary(projectId: string): Promise<ProjectContractorSummaryRow[]>;
}
