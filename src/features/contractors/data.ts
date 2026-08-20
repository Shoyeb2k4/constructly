import { isDemoMode } from "@/lib/env";
import type { ContractorsRepository } from "./repository";
import { demoContractorsRepository } from "./demo/demo-repository";
import * as server from "./server/actions";
import * as rescope from "./server/advance-rescope";
import type { ContractorFilters } from "./types";
import type { SettlementFilters } from "./repository";

const serverRepository: ContractorsRepository = {
  listContractors: server.listContractors,
  getContractor: server.getContractor,
  createContractor: server.createContractor,
  findContractorDuplicates: server.findContractorDuplicates,
  archiveContractor: server.archiveContractor,
  restoreContractor: server.restoreContractor,
  updateContractor: server.updateContractor,
  recordAdvance: server.recordAdvance,
  previewAdvanceRescope: rescope.previewAdvanceRescope,
  rescopeAdvance: rescope.rescopeAdvance,
  reverseAdvanceRescope: rescope.reverseAdvanceRescope,

  getLedger: server.getLedger,
  previewSettlement: server.previewSettlement,
  createSettlement: server.createSettlement,
  reverseSettlement: server.reverseSettlement,
  listSettlements: server.listSettlements,
  outstandingAdvances: server.outstandingAdvances,
  contractorCostSummary: server.contractorCostSummary,
};

export const contractorsApi: ContractorsRepository = isDemoMode
  ? demoContractorsRepository
  : serverRepository;

export const contractorKeys = {
  all: ["contractors"] as const,
  list: (f?: ContractorFilters) => ["contractors", "list", f ?? {}] as const,
  detail: (id: string) => ["contractors", "detail", id] as const,
  ledger: (id: string) => ["contractors", "ledger", id] as const,
  settlements: (f?: SettlementFilters) => ["contractors", "settlements", f ?? {}] as const,
  outstanding: ["contractors", "outstanding"] as const,
  costSummary: ["contractors", "cost-summary"] as const,
};
