import type {
  AttendanceSheet,
  AttendanceStatus,
  Contractor,
  ContractorLaborCost,
  ContractorStatus,
  CreateContractorInput,
  CreateLaborerInput,
  DuplicateWarning,
  Laborer,
  LaborerStatus,
  LaborFilters,
  ProjectLaborCost,
  UpdateLaborerInput,
} from "./types";

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
}

/**
 * Labor & attendance data contract. Demo (localStorage) and server
 * (Prisma + sync engine) implementations satisfy it; the UI depends only here.
 */
export interface LaborRepository {
  // Roster
  listLaborers(filters?: LaborFilters): Promise<Laborer[]>;
  createLaborer(input: CreateLaborerInput): Promise<Laborer>;
  updateLaborer(id: string, patch: UpdateLaborerInput): Promise<Laborer>;
  setLaborerStatus(id: string, status: LaborerStatus): Promise<Laborer>;
  bulkSetLaborerStatus(ids: string[], status: LaborerStatus): Promise<void>;
  findDuplicateLaborers(fullName: string, phone?: string | null): Promise<DuplicateWarning[]>;
  listTrades(): Promise<string[]>;

  // Contractors
  listContractors(): Promise<Contractor[]>;
  createContractor(input: CreateContractorInput): Promise<Contractor>;
  setContractorStatus(id: string, status: ContractorStatus): Promise<Contractor>;

  // Attendance
  getSheet(projectId: string, date: string): Promise<AttendanceSheet>;
  setAttendance(
    projectId: string,
    laborerId: string,
    date: string,
    status: AttendanceStatus | null,
    otHours: number,
  ): Promise<AttendanceSheet>;
  markAllPresent(projectId: string, date: string): Promise<AttendanceSheet>;
  copyYesterday(projectId: string, date: string): Promise<AttendanceSheet>;
  addToCrew(projectId: string, laborerIds: string[], date: string): Promise<AttendanceSheet>;
  crossProjectPresence(
    laborerId: string,
    date: string,
    excludeProjectId: string,
  ): Promise<string[]>;

  // Rollups (reporting foundation)
  laborCostByProject(range: DateRange): Promise<ProjectLaborCost[]>;
  laborCostByContractor(range: DateRange): Promise<ContractorLaborCost[]>;
}
