"use server";

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma";
import { requireUser } from "@/lib/auth/current-user";
import type { SessionUser } from "@/lib/auth/types";
import { advanceBalancePaise, computeSettlement, validateAdjustment } from "../calc";
import {
  createContractorSchema,
  updateContractorSchema,
  recordAdvanceSchema,
  createSettlementSchema,
} from "../schema";
import type {
  Contractor,
  ContractorFilters,
  ContractorLedger,
  ContractorLedgerEntry,
  ContractorSettlement,
  ContractorCostRow,
  CreateContractorInput,
  CreateSettlementInput,
  OutstandingAdvanceRow,
  RecordAdvanceInput,
  SettlementPreview,
  UpdateContractorInput,
} from "../types";
import type { SettlementFilters, SettlementPreviewInput } from "../repository";

// ── helpers ───────────────────────────────────────────────────────────
function assertOwner(user: SessionUser) {
  if (user.role !== "OWNER") throw new Error("FORBIDDEN");
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

type ContractorRow = {
  id: string;
  name: string;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE";
  openingAdvancePaise: number;
  createdAt: Date;
};

function toContractor(c: ContractorRow, balance: number): Contractor {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    status: c.status,
    openingAdvancePaise: c.openingAdvancePaise,
    advanceBalancePaise: balance,
    createdAt: c.createdAt.toISOString(),
  };
}

type LedgerRow = {
  id: string;
  contractorId: string;
  date: Date;
  type: ContractorLedgerEntry["type"];
  amountPaise: number;
  advanceBalanceAfterPaise: number;
  notes: string | null;
  settlementId: string | null;
  createdAt: Date;
};

function toLedgerEntry(e: LedgerRow, projectName: string | null): ContractorLedgerEntry {
  return {
    id: e.id,
    contractorId: e.contractorId,
    date: iso(e.date),
    type: e.type,
    amountPaise: e.amountPaise,
    advanceBalanceAfterPaise: e.advanceBalanceAfterPaise,
    notes: e.notes,
    settlementId: e.settlementId,
    projectName,
    createdAt: e.createdAt.toISOString(),
  };
}

async function outstandingAdvanceFor(companyId: string, contractorId: string): Promise<number> {
  const entries = await prisma.contractorLedgerEntry.findMany({
    where: { companyId, contractorId },
    select: { type: true, amountPaise: true },
  });
  return advanceBalancePaise(entries);
}

/** Σ estimated labour cost for a contractor on a project across the period. */
async function labourBillPaise(
  companyId: string,
  contractorId: string,
  projectId: string,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const agg = await prisma.labourAttendance.aggregate({
    where: {
      companyId,
      contractorId,
      projectId,
      date: { gte: new Date(periodStart), lte: new Date(periodEnd) },
    },
    _sum: { estimatedCostPaise: true },
  });
  return agg._sum.estimatedCostPaise ?? 0;
}

async function logActivity(
  user: SessionUser,
  action: string,
  entityId: string,
  summary: string,
  meta?: Prisma.InputJsonValue,
) {
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action,
      entityType: "contractor",
      entityId,
      summary,
      meta: meta ?? undefined,
    },
  });
}

// ── contractors ───────────────────────────────────────────────────────
export async function listContractors(filters: ContractorFilters = {}): Promise<Contractor[]> {
  const user = await requireUser();
  const rows = await prisma.contractor.findMany({
    where: {
      companyId: user.company.id,
      ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" } },
              { phone: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });
  // One query for every ledger movement in the company, folded per contractor.
  const entries = await prisma.contractorLedgerEntry.findMany({
    where: { companyId: user.company.id },
    select: { contractorId: true, type: true, amountPaise: true },
  });
  const balByContractor = new Map<string, { type: ContractorLedgerEntry["type"]; amountPaise: number }[]>();
  for (const e of entries) {
    const arr = balByContractor.get(e.contractorId) ?? [];
    arr.push({ type: e.type, amountPaise: e.amountPaise });
    balByContractor.set(e.contractorId, arr);
  }
  return rows.map((c) => toContractor(c, advanceBalancePaise(balByContractor.get(c.id) ?? [])));
}

export async function getContractor(id: string): Promise<Contractor | null> {
  const user = await requireUser();
  const c = await prisma.contractor.findFirst({ where: { id, companyId: user.company.id } });
  if (!c) return null;
  return toContractor(c, await outstandingAdvanceFor(user.company.id, id));
}

export async function createContractor(input: CreateContractorInput): Promise<Contractor> {
  const user = await requireUser();
  assertOwner(user);
  const data = createContractorSchema.parse(input);
  const opening = data.openingAdvancePaise ?? 0;
  const c = await prisma.contractor.create({
    data: {
      companyId: user.company.id,
      name: data.name,
      phone: data.phone ?? null,
      openingAdvancePaise: opening,
    },
  });
  if (opening > 0) {
    await prisma.contractorLedgerEntry.create({
      data: {
        companyId: user.company.id,
        contractorId: c.id,
        date: new Date(),
        type: "OPENING_ADVANCE",
        amountPaise: opening,
        advanceBalanceAfterPaise: opening,
        notes: "Opening advance",
        createdById: user.id,
      },
    });
  }
  await logActivity(user, "contractor.created", c.id, `Added contractor ${c.name}`);
  return toContractor(c, opening);
}

export async function updateContractor(
  id: string,
  patch: UpdateContractorInput,
): Promise<Contractor> {
  const user = await requireUser();
  assertOwner(user);
  const data = updateContractorSchema.parse(patch);
  const c = await prisma.contractor.update({
    where: { id, companyId: user.company.id },
    data: { ...data, phone: data.phone === undefined ? undefined : data.phone ?? null },
  });
  await logActivity(user, "contractor.updated", c.id, `Updated contractor ${c.name}`, {
    fields: Object.keys(data),
  });
  return toContractor(c, await outstandingAdvanceFor(user.company.id, id));
}

// ── advances ──────────────────────────────────────────────────────────
export async function recordAdvance(input: RecordAdvanceInput): Promise<ContractorLedgerEntry> {
  const user = await requireUser();
  assertOwner(user);
  const data = recordAdvanceSchema.parse(input);
  const c = await prisma.contractor.findFirst({
    where: { id: data.contractorId, companyId: user.company.id },
    select: { id: true, name: true },
  });
  if (!c) throw new Error("NOT_FOUND");
  const balance = (await outstandingAdvanceFor(user.company.id, data.contractorId)) + data.amountPaise;
  const entry = await prisma.contractorLedgerEntry.create({
    data: {
      companyId: user.company.id,
      contractorId: data.contractorId,
      date: new Date(data.date),
      type: "ADVANCE",
      amountPaise: data.amountPaise,
      advanceBalanceAfterPaise: balance,
      notes: data.notes ?? null,
      createdById: user.id,
    },
  });
  await logActivity(user, "contractor.advance", c.id, `Advance to ${c.name}`, {
    amountPaise: data.amountPaise,
  });
  return toLedgerEntry(entry, null);
}

// ── ledger ────────────────────────────────────────────────────────────
export async function getLedger(contractorId: string): Promise<ContractorLedger> {
  const user = await requireUser();
  const c = await prisma.contractor.findFirst({
    where: { id: contractorId, companyId: user.company.id },
  });
  if (!c) throw new Error("NOT_FOUND");
  const rows = await prisma.contractorLedgerEntry.findMany({
    where: { companyId: user.company.id, contractorId },
    orderBy: { createdAt: "asc" },
    include: { settlement: { select: { project: { select: { name: true } } } } },
  });
  const entries = rows.map((e) => toLedgerEntry(e, e.settlement?.project?.name ?? null));
  const balance = advanceBalancePaise(rows.map((e) => ({ type: e.type, amountPaise: e.amountPaise })));
  return { contractor: toContractor(c, balance), entries };
}

// ── settlements ───────────────────────────────────────────────────────
export async function previewSettlement(
  input: SettlementPreviewInput,
): Promise<SettlementPreview> {
  const user = await requireUser();
  const bill = await labourBillPaise(
    user.company.id,
    input.contractorId,
    input.projectId,
    input.periodStart,
    input.periodEnd,
  );
  const outstanding = await outstandingAdvanceFor(user.company.id, input.contractorId);
  const math = computeSettlement(bill, input.advanceAdjustmentPaise, outstanding);
  return {
    labourBillPaise: bill,
    outstandingAdvancePaise: outstanding,
    maxAdjustmentPaise: Math.max(0, Math.min(outstanding, bill)),
    advanceAdjustmentPaise: math.advanceAdjustmentPaise,
    netPaymentPaise: math.netPaymentPaise,
    advanceBalanceAfterPaise: math.advanceBalanceAfterPaise,
  };
}

export async function createSettlement(
  input: CreateSettlementInput,
): Promise<ContractorSettlement> {
  const user = await requireUser();
  assertOwner(user);
  const data = createSettlementSchema.parse(input);
  const contractor = await prisma.contractor.findFirst({
    where: { id: data.contractorId, companyId: user.company.id },
    select: { id: true, name: true },
  });
  if (!contractor) throw new Error("NOT_FOUND");
  const project = await prisma.project.findFirst({
    where: { id: data.projectId, companyId: user.company.id },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("NOT_FOUND");

  const bill = await labourBillPaise(
    user.company.id,
    data.contractorId,
    data.projectId,
    data.periodStart,
    data.periodEnd,
  );
  const outstanding = await outstandingAdvanceFor(user.company.id, data.contractorId);
  const err = validateAdjustment(data.advanceAdjustmentPaise, outstanding, bill);
  if (err) throw new Error(err);
  const math = computeSettlement(bill, data.advanceAdjustmentPaise, outstanding);

  const settlement = await prisma.$transaction(async (tx) => {
    const s = await tx.contractorSettlement.create({
      data: {
        companyId: user.company.id,
        contractorId: data.contractorId,
        projectId: data.projectId,
        periodStart: new Date(data.periodStart),
        periodEnd: new Date(data.periodEnd),
        labourBillPaise: bill,
        advanceAdjustmentPaise: math.advanceAdjustmentPaise,
        netPaymentPaise: math.netPaymentPaise,
        advanceBalanceAfterPaise: math.advanceBalanceAfterPaise,
        notes: data.notes ?? null,
        createdById: user.id,
      },
    });
    const date = new Date(data.periodEnd);
    const base = {
      companyId: user.company.id,
      contractorId: data.contractorId,
      settlementId: s.id,
      date,
      createdById: user.id,
    };
    let bal = outstanding;
    await tx.contractorLedgerEntry.create({
      data: { ...base, type: "LABOUR_BILL", amountPaise: bill, advanceBalanceAfterPaise: bal },
    });
    if (math.advanceAdjustmentPaise > 0) {
      bal -= math.advanceAdjustmentPaise;
      await tx.contractorLedgerEntry.create({
        data: {
          ...base,
          type: "ADJUSTMENT",
          amountPaise: math.advanceAdjustmentPaise,
          advanceBalanceAfterPaise: bal,
        },
      });
    }
    await tx.contractorLedgerEntry.create({
      data: {
        ...base,
        type: "PAYMENT",
        amountPaise: math.netPaymentPaise,
        advanceBalanceAfterPaise: bal,
      },
    });
    return s;
  });

  await logActivity(
    user,
    "contractor.settlement",
    contractor.id,
    `Settlement for ${contractor.name} (${project.name})`,
    { netPaymentPaise: math.netPaymentPaise, labourBillPaise: bill },
  );
  return toSettlement(settlement, contractor.name, project.name);
}

type SettlementRow = {
  id: string;
  contractorId: string;
  projectId: string;
  periodStart: Date;
  periodEnd: Date;
  labourBillPaise: number;
  advanceAdjustmentPaise: number;
  netPaymentPaise: number;
  advanceBalanceAfterPaise: number;
  notes: string | null;
  createdAt: Date;
};

function toSettlement(
  s: SettlementRow,
  contractorName: string,
  projectName: string,
): ContractorSettlement {
  return {
    id: s.id,
    contractorId: s.contractorId,
    contractorName,
    projectId: s.projectId,
    projectName,
    periodStart: iso(s.periodStart),
    periodEnd: iso(s.periodEnd),
    labourBillPaise: s.labourBillPaise,
    advanceAdjustmentPaise: s.advanceAdjustmentPaise,
    netPaymentPaise: s.netPaymentPaise,
    advanceBalanceAfterPaise: s.advanceBalanceAfterPaise,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
  };
}

export async function listSettlements(
  filters: SettlementFilters = {},
): Promise<ContractorSettlement[]> {
  const user = await requireUser();
  const rows = await prisma.contractorSettlement.findMany({
    where: {
      companyId: user.company.id,
      ...(filters.contractorId ? { contractorId: filters.contractorId } : {}),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      contractor: { select: { name: true } },
      project: { select: { name: true } },
    },
  });
  return rows.map((s) => toSettlement(s, s.contractor.name, s.project.name));
}

// ── reports ───────────────────────────────────────────────────────────
export async function outstandingAdvances(): Promise<OutstandingAdvanceRow[]> {
  const contractors = await listContractors();
  return contractors
    .filter((c) => c.advanceBalancePaise > 0)
    .map((c) => ({
      contractorId: c.id,
      name: c.name,
      phone: c.phone,
      advanceBalancePaise: c.advanceBalancePaise,
    }))
    .sort((a, b) => b.advanceBalancePaise - a.advanceBalancePaise);
}

export async function contractorCostSummary(): Promise<ContractorCostRow[]> {
  const user = await requireUser();
  const contractors = await listContractors();
  const grouped = await prisma.contractorSettlement.groupBy({
    by: ["contractorId"],
    where: { companyId: user.company.id },
    _sum: { labourBillPaise: true, netPaymentPaise: true, advanceAdjustmentPaise: true },
    _count: { _all: true },
  });
  const byId = new Map(grouped.map((g) => [g.contractorId, g]));
  return contractors.map((c) => {
    const g = byId.get(c.id);
    return {
      contractorId: c.id,
      name: c.name,
      totalBillPaise: g?._sum.labourBillPaise ?? 0,
      totalPaidPaise: g?._sum.netPaymentPaise ?? 0,
      totalAdjustedPaise: g?._sum.advanceAdjustmentPaise ?? 0,
      advanceBalancePaise: c.advanceBalancePaise,
      settlementCount: g?._count._all ?? 0,
    };
  });
}
