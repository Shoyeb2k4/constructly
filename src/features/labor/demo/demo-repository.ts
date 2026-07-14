import type { LaborRepository, DateRange } from "../repository";
import type {
  AttendanceCell,
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
} from "../types";
import { computeWage } from "../wage";
import {
  DEMO_CONTRACTORS,
  DEMO_LABORERS,
  demoAttendance,
  type AttendanceRecord,
  type ContractorRecord,
  type LaborerRecord,
} from "./seed";

const K = {
  contractors: "constructly.demo.contractors.v1",
  laborers: "constructly.demo.laborers.v1",
  attendance: "constructly.demo.attendance.v1",
  projects: "constructly.demo.projects.v1",
};

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function read<T>(key: string, seed: () => T[]): T[] {
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T[];
  } catch {
    /* ignore */
  }
  // Clone so we never hand out (and later mutate) the shared seed constants.
  const seeded = structuredClone(seed());
  write(key, seeded);
  return seeded;
}

function write<T>(key: string, rows: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

const loadContractors = () => read<ContractorRecord>(K.contractors, () => DEMO_CONTRACTORS);
const loadLaborers = () => read<LaborerRecord>(K.laborers, () => DEMO_LABORERS);
const loadAttendance = () => read<AttendanceRecord>(K.attendance, () => demoAttendance());

function projectMeta(): Map<string, { name: string; code: string }> {
  const map = new Map<string, { name: string; code: string }>();
  if (typeof window === "undefined") return map;
  try {
    const rows = JSON.parse(window.localStorage.getItem(K.projects) ?? "[]") as {
      id: string;
      name: string;
      code: string;
    }[];
    rows.forEach((p) => map.set(p.id, { name: p.name, code: p.code }));
  } catch {
    /* ignore */
  }
  return map;
}

function toLaborer(r: LaborerRecord, contractors: ContractorRecord[]): Laborer {
  return {
    ...r,
    contractorName: r.contractorId
      ? (contractors.find((c) => c.id === r.contractorId)?.name ?? null)
      : null,
  };
}

function buildSheet(
  projectId: string,
  date: string,
  laborers: LaborerRecord[],
  contractors: ContractorRecord[],
  attendance: AttendanceRecord[],
): AttendanceSheet {
  const forProject = attendance.filter((a) => a.projectId === projectId);
  const crewIds = new Set(forProject.map((a) => a.laborerId));
  const todayIds = new Set(forProject.filter((a) => a.date === date).map((a) => a.laborerId));

  const crew = laborers
    .filter((l) => crewIds.has(l.id) && (l.status === "ACTIVE" || todayIds.has(l.id)))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const cells: AttendanceCell[] = crew.map((l) => {
    const rec = forProject.find((a) => a.laborerId === l.id && a.date === date);
    return {
      laborerId: l.id,
      fullName: l.fullName,
      trade: l.trade,
      dailyWagePaise: l.dailyWagePaise,
      contractorId: l.contractorId,
      contractorName: l.contractorId
        ? (contractors.find((c) => c.id === l.contractorId)?.name ?? null)
        : null,
      status: rec?.status ?? null,
      otHours: rec?.otHours ?? 0,
      wagePayablePaise: rec?.wagePayablePaise ?? 0,
      syncState: "synced",
    };
  });

  const summary = {
    present: cells.filter((c) => c.status === "PRESENT").length,
    half: cells.filter((c) => c.status === "HALF_DAY").length,
    absent: cells.filter((c) => c.status === "ABSENT").length,
    unmarked: cells.filter((c) => c.status == null).length,
    crew: cells.length,
    totalWagePaise: cells.reduce((s, c) => s + c.wagePayablePaise, 0),
  };

  return { projectId, date, cells, summary };
}

function upsert(
  attendance: AttendanceRecord[],
  laborers: LaborerRecord[],
  projectId: string,
  laborerId: string,
  date: string,
  status: AttendanceStatus,
  otHours: number,
): AttendanceRecord[] {
  const laborer = laborers.find((l) => l.id === laborerId);
  if (!laborer) return attendance;
  const { wageRatePaise, wagePayablePaise } = computeWage(laborer.dailyWagePaise, status, otHours);
  const next = attendance.filter(
    (a) => !(a.projectId === projectId && a.laborerId === laborerId && a.date === date),
  );
  next.push({
    id: uid(),
    projectId,
    laborerId,
    date,
    status,
    otHours,
    wageRatePaise,
    wagePayablePaise,
    recordedByName: "Aarav Mehta",
    clientUuid: uid(),
    updatedAt: new Date().toISOString(),
  });
  return next;
}

export const demoLaborRepository: LaborRepository = {
  async listLaborers(filters: LaborFilters = {}) {
    const contractors = loadContractors();
    let rows = loadLaborers();
    if (filters.status && filters.status !== "ALL")
      rows = rows.filter((l) => l.status === filters.status);
    else if (!filters.status) rows = rows; // default all
    if (filters.trade && filters.trade !== "ALL")
      rows = rows.filter((l) => l.trade === filters.trade);
    if (filters.contractorId && filters.contractorId !== "ALL")
      rows = rows.filter((l) =>
        filters.contractorId === "NONE"
          ? l.contractorId == null
          : l.contractorId === filters.contractorId,
      );
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter(
        (l) => l.fullName.toLowerCase().includes(q) || l.trade.toLowerCase().includes(q),
      );
    }
    return rows
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((r) => toLaborer(r, contractors));
  },

  async createLaborer(input: CreateLaborerInput) {
    const rows = loadLaborers();
    const rec: LaborerRecord = {
      id: uid(),
      fullName: input.fullName,
      phone: input.phone ?? null,
      trade: input.trade,
      dailyWagePaise: input.dailyWagePaise,
      contractorId: input.contractorId ?? null,
      status: "ACTIVE",
      notes: input.notes ?? null,
    };
    rows.push(rec);
    write(K.laborers, rows);
    return toLaborer(rec, loadContractors());
  },

  async updateLaborer(id, patch: UpdateLaborerInput) {
    const rows = loadLaborers();
    const rec = rows.find((l) => l.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    Object.assign(rec, {
      ...patch,
      contractorId: patch.contractorId !== undefined ? patch.contractorId || null : rec.contractorId,
    });
    write(K.laborers, rows);
    return toLaborer(rec, loadContractors());
  },

  async setLaborerStatus(id, status: LaborerStatus) {
    return this.updateLaborer(id, { status });
  },

  async bulkSetLaborerStatus(ids, status) {
    const rows = loadLaborers();
    rows.forEach((l) => {
      if (ids.includes(l.id)) l.status = status;
    });
    write(K.laborers, rows);
  },

  async findDuplicateLaborers(fullName, phone) {
    const name = fullName.trim().toLowerCase();
    const rows = loadLaborers();
    return rows
      .filter(
        (l) =>
          l.fullName.trim().toLowerCase() === name ||
          (!!phone && !!l.phone && l.phone === phone),
      )
      .map<DuplicateWarning>((l) => ({
        laborerId: l.id,
        fullName: l.fullName,
        reason: l.fullName.trim().toLowerCase() === name ? "name" : "phone",
      }));
  },

  async listTrades() {
    return [...new Set(loadLaborers().map((l) => l.trade))].sort();
  },

  async listContractors() {
    const contractors = loadContractors();
    const laborers = loadLaborers();
    const attendance = loadAttendance();
    return contractors.map<Contractor>((c) => {
      const crew = laborers.filter((l) => l.contractorId === c.id);
      const crewIds = new Set(crew.map((l) => l.id));
      const cost = attendance
        .filter((a) => crewIds.has(a.laborerId))
        .reduce((s, a) => s + a.wagePayablePaise, 0);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        status: c.status,
        laborerCount: crew.length,
        laborCostPaise: cost,
      };
    });
  },

  async createContractor(input: CreateContractorInput) {
    const rows = loadContractors();
    const rec: ContractorRecord = {
      id: uid(),
      name: input.name,
      phone: input.phone ?? null,
      status: "ACTIVE",
    };
    rows.push(rec);
    write(K.contractors, rows);
    return { ...rec, laborerCount: 0, laborCostPaise: 0 };
  },

  async setContractorStatus(id, status: ContractorStatus) {
    const rows = loadContractors();
    const rec = rows.find((c) => c.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    rec.status = status;
    write(K.contractors, rows);
    return { ...rec, laborerCount: 0, laborCostPaise: 0 };
  },

  async getSheet(projectId, date) {
    return buildSheet(projectId, date, loadLaborers(), loadContractors(), loadAttendance());
  },

  async setAttendance(projectId, laborerId, date, status, otHours) {
    const laborers = loadLaborers();
    let attendance = loadAttendance();
    if (status == null) {
      attendance = attendance.filter(
        (a) => !(a.projectId === projectId && a.laborerId === laborerId && a.date === date),
      );
    } else {
      attendance = upsert(attendance, laborers, projectId, laborerId, date, status, otHours);
    }
    write(K.attendance, attendance);
    return buildSheet(projectId, date, laborers, loadContractors(), attendance);
  },

  async markAllPresent(projectId, date) {
    const laborers = loadLaborers();
    let attendance = loadAttendance();
    const sheet = buildSheet(projectId, date, laborers, loadContractors(), attendance);
    for (const cell of sheet.cells) {
      attendance = upsert(attendance, laborers, projectId, cell.laborerId, date, "PRESENT", cell.otHours);
    }
    write(K.attendance, attendance);
    return buildSheet(projectId, date, laborers, loadContractors(), attendance);
  },

  async copyYesterday(projectId, date) {
    const laborers = loadLaborers();
    let attendance = loadAttendance();
    const prevDates = attendance
      .filter((a) => a.projectId === projectId && a.date < date)
      .map((a) => a.date)
      .sort();
    const prev = prevDates.at(-1);
    if (!prev) return buildSheet(projectId, date, laborers, loadContractors(), attendance);
    const source = attendance.filter((a) => a.projectId === projectId && a.date === prev);
    for (const rec of source) {
      attendance = upsert(attendance, laborers, projectId, rec.laborerId, date, rec.status, rec.otHours);
    }
    write(K.attendance, attendance);
    return buildSheet(projectId, date, laborers, loadContractors(), attendance);
  },

  async addToCrew(projectId, laborerIds, date) {
    const laborers = loadLaborers();
    let attendance = loadAttendance();
    for (const id of laborerIds) {
      attendance = upsert(attendance, laborers, projectId, id, date, "PRESENT", 0);
    }
    write(K.attendance, attendance);
    return buildSheet(projectId, date, laborers, loadContractors(), attendance);
  },

  async crossProjectPresence(laborerId, date, excludeProjectId) {
    const meta = projectMeta();
    return loadAttendance()
      .filter(
        (a) =>
          a.laborerId === laborerId &&
          a.date === date &&
          a.projectId !== excludeProjectId &&
          (a.status === "PRESENT" || a.status === "HALF_DAY"),
      )
      .map((a) => meta.get(a.projectId)?.name ?? "another project");
  },

  async laborCostByProject(range: DateRange) {
    const meta = projectMeta();
    const inRange = loadAttendance().filter((a) => a.date >= range.from && a.date <= range.to);
    const groups = new Map<string, ProjectLaborCost>();
    for (const a of inRange) {
      const m = meta.get(a.projectId);
      const g = groups.get(a.projectId) ?? {
        projectId: a.projectId,
        projectName: m?.name ?? "Unknown",
        code: m?.code ?? "",
        totalPaise: 0,
        workerCount: 0,
        manDays: 0,
      };
      g.totalPaise += a.wagePayablePaise;
      if (a.status !== "ABSENT") g.manDays += a.status === "HALF_DAY" ? 0.5 : 1;
      groups.set(a.projectId, g);
    }
    // distinct workers per project
    for (const [pid, g] of groups) {
      g.workerCount = new Set(
        inRange.filter((a) => a.projectId === pid).map((a) => a.laborerId),
      ).size;
    }
    return [...groups.values()].sort((a, b) => b.totalPaise - a.totalPaise);
  },

  async laborCostByContractor(range: DateRange) {
    const laborers = loadLaborers();
    const contractors = loadContractors();
    const inRange = loadAttendance().filter((a) => a.date >= range.from && a.date <= range.to);
    const groups = new Map<string, ContractorLaborCost>();
    for (const a of inRange) {
      const laborer = laborers.find((l) => l.id === a.laborerId);
      const cid = laborer?.contractorId ?? "DIRECT";
      const name =
        cid === "DIRECT"
          ? "Direct labor"
          : (contractors.find((c) => c.id === cid)?.name ?? "Unknown");
      const g = groups.get(cid) ?? {
        contractorId: cid === "DIRECT" ? null : cid,
        name,
        totalPaise: 0,
        workerCount: 0,
      };
      g.totalPaise += a.wagePayablePaise;
      groups.set(cid, g);
    }
    for (const [cid, g] of groups) {
      g.workerCount = new Set(
        inRange
          .filter((a) => {
            const l = laborers.find((x) => x.id === a.laborerId);
            return (l?.contractorId ?? "DIRECT") === cid;
          })
          .map((a) => a.laborerId),
      ).size;
    }
    return [...groups.values()].sort((a, b) => b.totalPaise - a.totalPaise);
  },
};
