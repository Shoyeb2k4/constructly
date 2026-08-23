import { isDemoMode } from "@/lib/env";
import { isNativeClient } from "@/lib/mobile/platform";
import type { ContractorsRepository } from "./repository";
import { demoContractorsRepository } from "./demo/demo-repository";
import { httpContractorsRepository } from "./http-repository";
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

/**
 * Transport selection, in priority order:
 *   demo mode  → in-browser fixtures (unchanged)
 *   native app → HTTP RPC to the deployed Next backend (Capacitor; no Server
 *                Actions, because the bundle has no same-origin Next server)
 *   web        → Server Actions (unchanged — this is the production path)
 *
 * `isNativeClient` is a build-time constant, so each bundle keeps exactly one
 * of these branches and tree-shakes the rest: the web bundle never carries the
 * RPC client, and the mobile bundle never carries Prisma.
 */
export const contractorsApi: ContractorsRepository = isDemoMode
  ? demoContractorsRepository
  : isNativeClient
    ? httpContractorsRepository
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
