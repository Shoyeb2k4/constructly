import { rpcMethod } from "@/lib/mobile/rpc";
import type { ContractorsRepository } from "./repository";

/**
 * The native app's `ContractorsRepository` — the third implementation, beside
 * `demo/` and the Server-Action-backed one in `data.ts`.
 *
 * Pure transport. Every method forwards to the identically named entry in the
 * mobile RPC allowlist, which invokes the very same server function the web app
 * calls, under the caller's real resolved session. There is no query logic, no
 * authorization and no money arithmetic here, and anything resembling those
 * would be a bug: the ledger, settlement and advance semantics must come from
 * one place, not two.
 *
 * The object is annotated as `ContractorsRepository`, so the compiler checks
 * every key and signature against the interface the UI already consumes. Method
 * NAMES deliberately match the interface rather than being shortened, so the
 * repository, the registry and the call site all use one vocabulary.
 */
export const httpContractorsRepository: ContractorsRepository = {
  listContractors: rpcMethod("contractors", "listContractors"),
  getContractor: rpcMethod("contractors", "getContractor"),
  createContractor: rpcMethod("contractors", "createContractor"),
  findContractorDuplicates: rpcMethod("contractors", "findContractorDuplicates"),
  archiveContractor: rpcMethod("contractors", "archiveContractor"),
  restoreContractor: rpcMethod("contractors", "restoreContractor"),
  updateContractor: rpcMethod("contractors", "updateContractor"),

  recordAdvance: rpcMethod("contractors", "recordAdvance"),
  previewAdvanceRescope: rpcMethod("contractors", "previewAdvanceRescope"),
  rescopeAdvance: rpcMethod("contractors", "rescopeAdvance"),
  reverseAdvanceRescope: rpcMethod("contractors", "reverseAdvanceRescope"),

  getLedger: rpcMethod("contractors", "getLedger"),
  previewSettlement: rpcMethod("contractors", "previewSettlement"),
  createSettlement: rpcMethod("contractors", "createSettlement"),
  reverseSettlement: rpcMethod("contractors", "reverseSettlement"),
  listSettlements: rpcMethod("contractors", "listSettlements"),
  outstandingAdvances: rpcMethod("contractors", "outstandingAdvances"),
  contractorCostSummary: rpcMethod("contractors", "contractorCostSummary"),
};
