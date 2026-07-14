import { isDemoMode } from "@/lib/env";
import type { LaborRepository, DateRange } from "./repository";
import { demoLaborRepository } from "./demo/demo-repository";
import * as server from "./server/actions";
import type { LaborFilters } from "./types";

const serverRepository: LaborRepository = {
  listLaborers: server.listLaborers,
  createLaborer: server.createLaborer,
  updateLaborer: server.updateLaborer,
  setLaborerStatus: server.setLaborerStatus,
  bulkSetLaborerStatus: server.bulkSetLaborerStatus,
  findDuplicateLaborers: server.findDuplicateLaborers,
  listTrades: server.listTrades,
  listContractors: server.listContractors,
  createContractor: server.createContractor,
  setContractorStatus: server.setContractorStatus,
  getSheet: server.getSheet,
  setAttendance: server.setAttendance,
  markAllPresent: server.markAllPresent,
  copyYesterday: server.copyYesterday,
  addToCrew: server.addToCrew,
  crossProjectPresence: server.crossProjectPresence,
  laborCostByProject: server.laborCostByProject,
  laborCostByContractor: server.laborCostByContractor,
};

export const laborApi: LaborRepository = isDemoMode
  ? demoLaborRepository
  : serverRepository;

export const laborKeys = {
  all: ["labor"] as const,
  laborers: (f?: LaborFilters) => ["labor", "laborers", f ?? {}] as const,
  trades: ["labor", "trades"] as const,
  contractors: ["labor", "contractors"] as const,
  sheet: (projectId: string, date: string) => ["labor", "sheet", projectId, date] as const,
  costByProject: (r: DateRange) => ["labor", "cost", "project", r] as const,
  costByContractor: (r: DateRange) => ["labor", "cost", "contractor", r] as const,
};
