/** Labor & attendance domain types (DTOs). Money is integer paise as `number`. */

export type AttendanceStatus = "PRESENT" | "ABSENT" | "HALF_DAY";
export type LaborerStatus = "ACTIVE" | "INACTIVE";
export type ContractorStatus = "ACTIVE" | "INACTIVE";
export type SyncState = "pending" | "synced" | "conflict";

export interface Contractor {
  id: string;
  name: string;
  phone: string | null;
  status: ContractorStatus;
  /** Derived rollups (present in list responses). */
  laborerCount: number;
  laborCostPaise: number;
}

export interface Laborer {
  id: string;
  fullName: string;
  phone: string | null;
  trade: string;
  dailyWagePaise: number;
  contractorId: string | null;
  contractorName: string | null;
  status: LaborerStatus;
  notes: string | null;
}

/** One worker's attendance for a given project + date. `status: null` = unmarked. */
export interface AttendanceCell {
  laborerId: string;
  fullName: string;
  trade: string;
  dailyWagePaise: number;
  contractorId: string | null;
  contractorName: string | null;
  status: AttendanceStatus | null;
  otHours: number;
  wagePayablePaise: number;
  syncState: SyncState;
}

export interface AttendanceSummary {
  present: number;
  half: number;
  absent: number;
  unmarked: number;
  crew: number;
  totalWagePaise: number;
}

export interface AttendanceSheet {
  projectId: string;
  date: string; // YYYY-MM-DD
  cells: AttendanceCell[];
  summary: AttendanceSummary;
}

export interface LaborFilters {
  search?: string;
  trade?: string | "ALL";
  contractorId?: string | "ALL";
  status?: LaborerStatus | "ALL";
}

export interface CreateLaborerInput {
  fullName: string;
  phone?: string | null;
  trade: string;
  dailyWagePaise: number;
  contractorId?: string | null;
  notes?: string | null;
}

export type UpdateLaborerInput = Partial<CreateLaborerInput> & {
  status?: LaborerStatus;
};

export interface CreateContractorInput {
  name: string;
  phone?: string | null;
}

export interface DuplicateWarning {
  laborerId: string;
  fullName: string;
  reason: "name" | "phone";
}

export interface ProjectLaborCost {
  projectId: string;
  projectName: string;
  code: string;
  totalPaise: number;
  workerCount: number;
  manDays: number;
}

export interface ContractorLaborCost {
  contractorId: string | null;
  name: string;
  totalPaise: number;
  workerCount: number;
}
