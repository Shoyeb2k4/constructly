import { isDemoMode } from "@/lib/env";
import type { ContractsRepository } from "./repository";
import { demoContractsRepository } from "./demo/demo-repository";
import * as agreements from "./server/actions";
import * as scope from "./server/scope";
import * as milestones from "./server/milestones";
import * as amendments from "./server/amendments";
import * as reconciliation from "./server/reconciliation";
import * as attribution from "./server/attribution";
import type { ContractFilters } from "./types";

const serverRepository: ContractsRepository = {
  listContracts: agreements.listContracts,
  getContract: agreements.getContract,
  createContract: agreements.createContract,
  updateContract: agreements.updateContract,
  setContractStatus: agreements.setContractStatus,
  cancelContract: agreements.cancelContract,
  deleteContract: agreements.deleteContract,

  listScopeItems: scope.listScopeItems,
  addScopeItem: scope.addScopeItem,
  removeScopeItem: scope.removeScopeItem,
  listRateRevisions: scope.listRateRevisions,
  setScopeRate: scope.setScopeRate,

  listMilestones: milestones.listMilestones,
  createMilestone: milestones.createMilestone,
  createMilestonesBulk: milestones.createMilestonesBulk,
  updateMilestone: milestones.updateMilestone,
  reorderMilestones: milestones.reorderMilestones,
  setMilestoneStatus: milestones.setMilestoneStatus,
  deleteMilestone: milestones.deleteMilestone,

  listAmendments: amendments.listAmendments,
  proposeAmendment: amendments.proposeAmendment,
  approveAmendment: amendments.approveAmendment,
  rejectAmendment: amendments.rejectAmendment,

  recordContractPayment: agreements.recordContractPayment,
  reverseContractPayment: agreements.reverseContractPayment,

  listAttributableLabour: attribution.listAttributableLabour,
  previewAttribution: attribution.previewAttribution,
  attributeSettledLabour: attribution.attributeSettledLabour,
  reverseAttribution: attribution.reverseAttribution,

  listHistory: reconciliation.listHistory,
  getContractorProfile: reconciliation.getContractorProfile,
  projectContractsSummary: reconciliation.projectContractorsCommercialSummary,
};

export const contractsApi: ContractsRepository = isDemoMode
  ? demoContractsRepository
  : serverRepository;

export const contractKeys = {
  all: ["contracts"] as const,
  list: (f?: ContractFilters) => ["contracts", "list", f ?? {}] as const,
  detail: (id: string) => ["contracts", "detail", id] as const,
  scope: (contractId: string) => ["contracts", "scope", contractId] as const,
  rates: (scopeItemId: string) => ["contracts", "rates", scopeItemId] as const,
  milestones: (contractId: string) => ["contracts", "milestones", contractId] as const,
  amendments: (contractId: string) => ["contracts", "amendments", contractId] as const,
  profile: (contractorId: string) => ["contracts", "profile", contractorId] as const,
  history: (contractorId: string) => ["contracts", "history", contractorId] as const,
  projectSummary: (projectId: string) => ["contracts", "project-summary", projectId] as const,
};
