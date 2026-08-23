import { rpcMethod } from "@/lib/mobile/rpc";
import type { ContractsRepository } from "./repository";

/**
 * Contractor commercial agreements over the mobile RPC transport — the third
 * implementation of `ContractsRepository`, beside `demo/` and the
 * Server-Action-backed one in `data.ts`.
 *
 * Pure transport. Every method forwards to the identically named entry in the
 * mobile RPC allowlist, which invokes the very same server function the web app
 * calls, under the caller's real resolved session. No query logic, no
 * authorization, no formatting — anything resembling business logic here would
 * be a second source of truth, which is exactly what this architecture exists
 * to avoid.
 *
 * Annotated as `ContractsRepository`, so the compiler checks every key and
 * signature against the interface the UI already consumes. Method names match
 * the interface rather than being shortened, so repository, registry and call
 * site share one vocabulary.
 */
export const httpContractsRepository: ContractsRepository = {
  listContracts: rpcMethod("contracts", "listContracts"),
  getContract: rpcMethod("contracts", "getContract"),
  createContract: rpcMethod("contracts", "createContract"),
  updateContract: rpcMethod("contracts", "updateContract"),
  setContractStatus: rpcMethod("contracts", "setContractStatus"),
  cancelContract: rpcMethod("contracts", "cancelContract"),
  deleteContract: rpcMethod("contracts", "deleteContract"),

  listScopeItems: rpcMethod("contracts", "listScopeItems"),
  addScopeItem: rpcMethod("contracts", "addScopeItem"),
  removeScopeItem: rpcMethod("contracts", "removeScopeItem"),
  listRateRevisions: rpcMethod("contracts", "listRateRevisions"),
  setScopeRate: rpcMethod("contracts", "setScopeRate"),

  listMilestones: rpcMethod("contracts", "listMilestones"),
  createMilestone: rpcMethod("contracts", "createMilestone"),
  createMilestonesBulk: rpcMethod("contracts", "createMilestonesBulk"),
  updateMilestone: rpcMethod("contracts", "updateMilestone"),
  reorderMilestones: rpcMethod("contracts", "reorderMilestones"),
  setMilestoneStatus: rpcMethod("contracts", "setMilestoneStatus"),
  deleteMilestone: rpcMethod("contracts", "deleteMilestone"),

  listAmendments: rpcMethod("contracts", "listAmendments"),
  proposeAmendment: rpcMethod("contracts", "proposeAmendment"),
  approveAmendment: rpcMethod("contracts", "approveAmendment"),
  rejectAmendment: rpcMethod("contracts", "rejectAmendment"),

  recordContractPayment: rpcMethod("contracts", "recordContractPayment"),
  reverseContractPayment: rpcMethod("contracts", "reverseContractPayment"),

  listAttributableLabour: rpcMethod("contracts", "listAttributableLabour"),
  previewAttribution: rpcMethod("contracts", "previewAttribution"),
  attributeSettledLabour: rpcMethod("contracts", "attributeSettledLabour"),
  reverseAttribution: rpcMethod("contracts", "reverseAttribution"),

  listHistory: rpcMethod("contracts", "listHistory"),
  getContractorProfile: rpcMethod("contracts", "getContractorProfile"),
  projectContractsSummary: rpcMethod("contracts", "projectContractsSummary"),
};
