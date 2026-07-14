"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/current-user";
import type { SessionUser } from "@/lib/auth/types";
import { computeWage } from "../wage";
import type { DateRange } from "../repository";
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
} from "../types";
import { Prisma } from "@/generated/prisma";

/** Attendance is only editable on projects the caller can access. */
async function assertProjectAccess(user: SessionUser, projectId: string) {
  const p = await prisma.project.findFirst({
    where: {
      id: projectId,
      companyId: user.company.id,
      deletedAt: null,
      ...(user.role !== "OWNER" ? { pmId: user.id } : {}),
    },
    select: { id: true },
  });
  if (!p) throw new Error("FORBIDDEN");
}

const laborerSelect = {
  id: true,
  fullName: true,
  phone: true,
  trade: true,
  dailyWagePaise: true,
  contractorId: true,
  status: true,
  notes: true,
  contractor: { select: { name: true } },
} satisfies Prisma.LaborerSelect;

function toLaborer(r: Prisma.LaborerGetPayload<{ select: typeof laborerSelect }>): Laborer {
  return {
    id: r.id,
    fullName: r.fullName,
    phone: r.phone,
    trade: r.trade,
    dailyWagePaise: r.dailyWagePaise,
    contractorId: r.contractorId,
    contractorName: r.contractor?.name ?? null,
    status: r.status,
    notes: r.notes,
  };
}

export async function listLaborers(filters: LaborFilters = {}): Promise<Laborer[]> {
  const user = await requireUser();
  const rows = await prisma.laborer.findMany({
    where: {
      companyId: user.company.id,
      ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
      ...(filters.trade && filters.trade !== "ALL" ? { trade: filters.trade } : {}),
      ...(filters.contractorId && filters.contractorId !== "ALL"
        ? filters.contractorId === "NONE"
          ? { contractorId: null }
          : { contractorId: filters.contractorId }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { fullName: { contains: filters.search, mode: "insensitive" } },
              { trade: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: laborerSelect,
    orderBy: { fullName: "asc" },
  });
  return rows.map(toLaborer);
}

export async function createLaborer(input: CreateLaborerInput): Promise<Laborer> {
  const user = await requireUser();
  const r = await prisma.laborer.create({
    data: {
      companyId: user.company.id,
      fullName: input.fullName,
      phone: input.phone ?? null,
      trade: input.trade,
      dailyWagePaise: input.dailyWagePaise,
      contractorId: input.contractorId ?? null,
      notes: input.notes ?? null,
    },
    select: laborerSelect,
  });
  return toLaborer(r);
}

export async function updateLaborer(id: string, patch: UpdateLaborerInput): Promise<Laborer> {
  const user = await requireUser();
  const r = await prisma.laborer.update({
    where: { id, companyId: user.company.id },
    data: {
      fullName: patch.fullName,
      phone: patch.phone,
      trade: patch.trade,
      dailyWagePaise: patch.dailyWagePaise,
      contractorId: patch.contractorId,
      notes: patch.notes,
      status: patch.status,
    },
    select: laborerSelect,
  });
  return toLaborer(r);
}

export async function setLaborerStatus(id: string, status: LaborerStatus): Promise<Laborer> {
  return updateLaborer(id, { status });
}

export async function bulkSetLaborerStatus(ids: string[], status: LaborerStatus): Promise<void> {
  const user = await requireUser();
  await prisma.laborer.updateMany({
    where: { id: { in: ids }, companyId: user.company.id },
    data: { status },
  });
}

export async function findDuplicateLaborers(
  fullName: string,
  phone?: string | null,
): Promise<DuplicateWarning[]> {
  const user = await requireUser();
  const rows = await prisma.laborer.findMany({
    where: {
      companyId: user.company.id,
      OR: [
        { fullName: { equals: fullName.trim(), mode: "insensitive" } },
        ...(phone ? [{ phone }] : []),
      ],
    },
    select: { id: true, fullName: true, phone: true },
  });
  return rows.map((r) => ({
    laborerId: r.id,
    fullName: r.fullName,
    reason: r.fullName.trim().toLowerCase() === fullName.trim().toLowerCase() ? "name" : "phone",
  }));
}

export async function listTrades(): Promise<string[]> {
  const user = await requireUser();
  const rows = await prisma.laborer.findMany({
    where: { companyId: user.company.id },
    select: { trade: true },
    distinct: ["trade"],
    orderBy: { trade: "asc" },
  });
  return rows.map((r) => r.trade);
}

export async function listContractors(): Promise<Contractor[]> {
  const user = await requireUser();
  const contractors = await prisma.contractor.findMany({
    where: { companyId: user.company.id },
    orderBy: { name: "asc" },
    include: { laborers: { select: { id: true } } },
  });
  const costs = await prisma.attendance.groupBy({
    by: ["laborerId"],
    where: { companyId: user.company.id },
    _sum: { wagePayablePaise: true },
  });
  const costByLaborer = new Map(costs.map((c) => [c.laborerId, c._sum.wagePayablePaise ?? 0]));
  return contractors.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    status: c.status,
    laborerCount: c.laborers.length,
    laborCostPaise: c.laborers.reduce((s, l) => s + (costByLaborer.get(l.id) ?? 0), 0),
  }));
}

export async function createContractor(input: CreateContractorInput): Promise<Contractor> {
  const user = await requireUser();
  const c = await prisma.contractor.create({
    data: { companyId: user.company.id, name: input.name, phone: input.phone ?? null },
  });
  return { id: c.id, name: c.name, phone: c.phone, status: c.status, laborerCount: 0, laborCostPaise: 0 };
}

export async function setContractorStatus(
  id: string,
  status: ContractorStatus,
): Promise<Contractor> {
  const user = await requireUser();
  const c = await prisma.contractor.update({
    where: { id, companyId: user.company.id },
    data: { status },
  });
  return { id: c.id, name: c.name, phone: c.phone, status: c.status, laborerCount: 0, laborCostPaise: 0 };
}

async function buildSheet(companyId: string, projectId: string, date: string): Promise<AttendanceSheet> {
  const crew = await prisma.attendance.findMany({
    where: { companyId, projectId },
    distinct: ["laborerId"],
    select: { laborerId: true },
  });
  const crewIds = crew.map((c) => c.laborerId);
  const laborers = await prisma.laborer.findMany({
    where: { companyId, id: { in: crewIds } },
    select: laborerSelect,
    orderBy: { fullName: "asc" },
  });
  const records = await prisma.attendance.findMany({
    where: { companyId, projectId, date: new Date(date) },
  });
  const byLaborer = new Map(records.map((r) => [r.laborerId, r]));

  const cells = laborers
    .filter((l) => l.status === "ACTIVE" || byLaborer.has(l.id))
    .map((l) => {
      const rec = byLaborer.get(l.id);
      return {
        laborerId: l.id,
        fullName: l.fullName,
        trade: l.trade,
        dailyWagePaise: l.dailyWagePaise,
        contractorId: l.contractorId,
        contractorName: l.contractor?.name ?? null,
        status: (rec?.status ?? null) as AttendanceStatus | null,
        otHours: rec ? Number(rec.otHours) : 0,
        wagePayablePaise: rec?.wagePayablePaise ?? 0,
        syncState: "synced" as const,
      };
    });

  return {
    projectId,
    date,
    cells,
    summary: {
      present: cells.filter((c) => c.status === "PRESENT").length,
      half: cells.filter((c) => c.status === "HALF_DAY").length,
      absent: cells.filter((c) => c.status === "ABSENT").length,
      unmarked: cells.filter((c) => c.status == null).length,
      crew: cells.length,
      totalWagePaise: cells.reduce((s, c) => s + c.wagePayablePaise, 0),
    },
  };
}

export async function getSheet(projectId: string, date: string): Promise<AttendanceSheet> {
  const user = await requireUser();
  await assertProjectAccess(user, projectId);
  return buildSheet(user.company.id, projectId, date);
}

async function upsertAttendance(
  user: SessionUser,
  projectId: string,
  laborerId: string,
  date: string,
  status: AttendanceStatus,
  otHours: number,
) {
  const laborer = await prisma.laborer.findFirstOrThrow({
    where: { id: laborerId, companyId: user.company.id },
    select: { dailyWagePaise: true },
  });
  const { wageRatePaise, wagePayablePaise } = computeWage(laborer.dailyWagePaise, status, otHours);
  await prisma.attendance.upsert({
    where: { projectId_laborerId_date: { projectId, laborerId, date: new Date(date) } },
    create: {
      companyId: user.company.id,
      projectId,
      laborerId,
      date: new Date(date),
      status,
      otHours,
      wageRatePaise,
      wagePayablePaise,
      recordedById: user.id,
      clientUuid: crypto.randomUUID(),
      clientSeq: BigInt(Date.now()),
    },
    update: { status, otHours, wageRatePaise, wagePayablePaise, recordedById: user.id },
  });
}

export async function setAttendance(
  projectId: string,
  laborerId: string,
  date: string,
  status: AttendanceStatus | null,
  otHours: number,
): Promise<AttendanceSheet> {
  const user = await requireUser();
  await assertProjectAccess(user, projectId);
  if (status == null) {
    await prisma.attendance.deleteMany({
      where: { projectId, laborerId, date: new Date(date), companyId: user.company.id },
    });
  } else {
    await upsertAttendance(user, projectId, laborerId, date, status, otHours);
  }
  return buildSheet(user.company.id, projectId, date);
}

export async function markAllPresent(projectId: string, date: string): Promise<AttendanceSheet> {
  const user = await requireUser();
  await assertProjectAccess(user, projectId);
  const sheet = await buildSheet(user.company.id, projectId, date);
  for (const cell of sheet.cells) {
    await upsertAttendance(user, projectId, cell.laborerId, date, "PRESENT", cell.otHours);
  }
  return buildSheet(user.company.id, projectId, date);
}

export async function copyYesterday(projectId: string, date: string): Promise<AttendanceSheet> {
  const user = await requireUser();
  await assertProjectAccess(user, projectId);
  const prev = await prisma.attendance.findFirst({
    where: { companyId: user.company.id, projectId, date: { lt: new Date(date) } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (prev) {
    const source = await prisma.attendance.findMany({
      where: { companyId: user.company.id, projectId, date: prev.date },
    });
    for (const rec of source) {
      await upsertAttendance(user, projectId, rec.laborerId, date, rec.status, Number(rec.otHours));
    }
  }
  return buildSheet(user.company.id, projectId, date);
}

export async function addToCrew(
  projectId: string,
  laborerIds: string[],
  date: string,
): Promise<AttendanceSheet> {
  const user = await requireUser();
  await assertProjectAccess(user, projectId);
  for (const id of laborerIds) {
    await upsertAttendance(user, projectId, id, date, "PRESENT", 0);
  }
  return buildSheet(user.company.id, projectId, date);
}

export async function crossProjectPresence(
  laborerId: string,
  date: string,
  excludeProjectId: string,
): Promise<string[]> {
  const user = await requireUser();
  const rows = await prisma.attendance.findMany({
    where: {
      companyId: user.company.id,
      laborerId,
      date: new Date(date),
      projectId: { not: excludeProjectId },
      status: { in: ["PRESENT", "HALF_DAY"] },
    },
    include: { project: { select: { name: true } } },
  });
  return rows.map((r) => r.project.name);
}

export async function laborCostByProject(range: DateRange): Promise<ProjectLaborCost[]> {
  const user = await requireUser();
  const rows = await prisma.attendance.findMany({
    where: {
      companyId: user.company.id,
      date: { gte: new Date(range.from), lte: new Date(range.to) },
    },
    include: { project: { select: { name: true, code: true } } },
  });
  const groups = new Map<string, ProjectLaborCost & { workers: Set<string> }>();
  for (const a of rows) {
    const g =
      groups.get(a.projectId) ??
      {
        projectId: a.projectId,
        projectName: a.project.name,
        code: a.project.code,
        totalPaise: 0,
        workerCount: 0,
        manDays: 0,
        workers: new Set<string>(),
      };
    g.totalPaise += a.wagePayablePaise;
    if (a.status !== "ABSENT") g.manDays += a.status === "HALF_DAY" ? 0.5 : 1;
    g.workers.add(a.laborerId);
    groups.set(a.projectId, g);
  }
  return [...groups.values()]
    .map(({ workers, ...g }) => ({ ...g, workerCount: workers.size }))
    .sort((a, b) => b.totalPaise - a.totalPaise);
}

export async function laborCostByContractor(range: DateRange): Promise<ContractorLaborCost[]> {
  const user = await requireUser();
  const rows = await prisma.attendance.findMany({
    where: {
      companyId: user.company.id,
      date: { gte: new Date(range.from), lte: new Date(range.to) },
    },
    include: { laborer: { select: { contractorId: true, contractor: { select: { name: true } } } } },
  });
  const groups = new Map<string, ContractorLaborCost & { workers: Set<string> }>();
  for (const a of rows) {
    const cid = a.laborer.contractorId ?? "DIRECT";
    const name = cid === "DIRECT" ? "Direct labor" : (a.laborer.contractor?.name ?? "Unknown");
    const g =
      groups.get(cid) ??
      {
        contractorId: cid === "DIRECT" ? null : cid,
        name,
        totalPaise: 0,
        workerCount: 0,
        workers: new Set<string>(),
      };
    g.totalPaise += a.wagePayablePaise;
    g.workers.add(a.laborerId);
    groups.set(cid, g);
  }
  return [...groups.values()]
    .map(({ workers, ...g }) => ({ ...g, workerCount: workers.size }))
    .sort((a, b) => b.totalPaise - a.totalPaise);
}
