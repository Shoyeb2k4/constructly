"use server";

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import {
  advanceBalancePaise,
  allocateAdvanceDrawdown,
  buildSettlementBreakdown,
  computeSettlement,
  maxAdjustmentPaise,
  outstandingPerAdvance,
  unusableAdvances,
  validateAdjustment,
  type BillComposition,
  type ScopedLedgerEntry,
} from "../calc";
import { paiseFromBigInt, paiseFromNullableBigInt } from "@/lib/money";
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

/**
 * Contractor financial reads are PROJECT-SCOPED. `contractors.view` means "the
 * commercial position of this contractor on projects I can access", NOT "every
 * project this contractor has ever worked on". `contractors.view_all` is what
 * unlocks cross-project figures and company-wide (unattributed) advances.
 */
function canSeeAllProjects(user: SessionUser): boolean {
  return hasPermission(user, "contractors.view_all") || hasPermission(user, "projects.view_all");
}

/** WHERE fragment limiting project-scoped rows to what the caller may see. */
function settlementScope(user: SessionUser) {
  return canSeeAllProjects(user) ? {} : { project: { pmId: user.id } };
}

/**
 * Ledger visibility. Scoped entries follow project access; company-wide
 * (unattributed) advances are only visible with contractors.view_all, because
 * they are not attributable to any project the caller might be limited to.
 */
function ledgerScope(user: SessionUser) {
  if (canSeeAllProjects(user)) return {};
  return { OR: [{ project: { pmId: user.id } }] };
}

/** Project access for a contractor write/read targeting one project. */
async function assertProjectAccess(user: SessionUser, projectId: string) {
  const p = await prisma.project.findFirst({
    where: {
      id: projectId,
      companyId: user.company.id,
      deletedAt: null,
      ...(canSeeAllProjects(user) ? {} : { pmId: user.id }),
    },
    select: { id: true },
  });
  if (!p) throw new Error("FORBIDDEN");
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

type ContractorRow = {
  id: string;
  name: string;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE";
  openingAdvancePaise: bigint;
  createdAt: Date;
};

function toContractor(c: ContractorRow, balance: number): Contractor {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    status: c.status,
    openingAdvancePaise: paiseFromBigInt(c.openingAdvancePaise, "contractor.openingAdvancePaise"),
    advanceBalancePaise: balance,
    createdAt: c.createdAt.toISOString(),
  };
}

type LedgerRow = {
  id: string;
  contractorId: string;
  date: Date;
  type: ContractorLedgerEntry["type"];
  amountPaise: bigint;
  advanceBalanceAfterPaise: bigint;
  notes: string | null;
  settlementId: string | null;
  projectId?: string | null;
  contractId?: string | null;
  drawsFromEntryId?: string | null;
  reversesEntryId?: string | null;
  fundsContractId?: string | null;
  createdAt: Date;
};

function toLedgerEntry(
  e: LedgerRow,
  projectName: string | null,
  contractTitle: string | null = null,
): ContractorLedgerEntry {
  return {
    id: e.id,
    contractorId: e.contractorId,
    date: iso(e.date),
    type: e.type,
    amountPaise: paiseFromBigInt(e.amountPaise, "ledger.amountPaise"),
    // HISTORICAL footprint, as written. Never today's balance — that is always
    // the fold over the entries (advanceBalancePaise).
    advanceBalanceAfterPaise: paiseFromBigInt(
      e.advanceBalanceAfterPaise,
      "ledger.advanceBalanceAfterPaise",
    ),
    notes: e.notes,
    settlementId: e.settlementId,
    projectId: e.projectId ?? null,
    contractId: e.contractId ?? null,
    contractTitle,
    drawsFromEntryId: e.drawsFromEntryId ?? null,
    reversesEntryId: e.reversesEntryId ?? null,
    fundsContractId: e.fundsContractId ?? null,
    projectName,
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * The CURRENT advance balance — always the fold over the ledger, never a stored
 * `advanceBalanceAfterPaise` snapshot. Reversals append later entries, so those
 * snapshots are deliberately historical and would be wrong here.
 */
async function outstandingAdvanceFor(companyId: string, contractorId: string): Promise<number> {
  const entries = await prisma.contractorLedgerEntry.findMany({
    where: { companyId, contractorId },
    select: { type: true, amountPaise: true },
  });
  return advanceBalancePaise(
    entries.map((e) => ({
      type: e.type,
      amountPaise: paiseFromBigInt(e.amountPaise, "ledger.amountPaise"),
    })),
  );
}

/** Ledger rows in the shape the pure scope/allocation helpers expect. */
async function scopedLedgerFor(
  companyId: string,
  contractorId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<ScopedLedgerEntry[]> {
  const rows = await tx.contractorLedgerEntry.findMany({
    where: { companyId, contractorId },
    select: {
      id: true,
      type: true,
      amountPaise: true,
      projectId: true,
      contractId: true,
      drawsFromEntryId: true,
      reversesEntryId: true,
      date: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    amountPaise: paiseFromBigInt(r.amountPaise, "ledger.amountPaise"),
    projectId: r.projectId,
    contractId: r.contractId,
    drawsFromEntryId: r.drawsFromEntryId,
    reversesEntryId: r.reversesEntryId,
    date: iso(r.date),
  }));
}

/**
 * An agreement referenced by a ledger entry must belong to the SAME company,
 * contractor and project as that entry. The database enforces this with a
 * composite FK; this is the in-transaction check that produces a readable error
 * instead of a constraint violation.
 */
async function assertAgreementScope(
  tx: Prisma.TransactionClient,
  args: { companyId: string; contractorId: string; projectId: string; contractId: string },
): Promise<void> {
  const found = await tx.contractorContract.findFirst({
    where: {
      id: args.contractId,
      companyId: args.companyId,
      contractorId: args.contractorId,
      projectId: args.projectId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!found) throw new Error("INVALID_AGREEMENT_SCOPE");
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

/**
 * What a settlement's labour CONSISTS of, grouped by the agreement each row
 * belongs to (`null` = the unattributed bucket).
 *
 * Before Phase 6 nothing writes `contractId`, so this is a single
 * `{ null: entireBill }` bucket; afterwards it becomes specific. Allocation
 * behaves identically in both cases — a band simply stops matching.
 */
async function billComposition(
  companyId: string,
  contractorId: string,
  projectId: string,
  periodStart: string,
  periodEnd: string,
  bill: number,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<BillComposition> {
  const grouped = await tx.labourAttendance.groupBy({
    by: ["contractId"],
    where: {
      companyId,
      contractorId,
      projectId,
      date: { gte: new Date(periodStart), lte: new Date(periodEnd) },
    },
    _sum: { estimatedCostPaise: true },
  });
  const composition: BillComposition = new Map(
    grouped.map((g) => [g.contractId, g._sum.estimatedCostPaise ?? 0]),
  );
  // A period with no attendance still settles (bill 0); give it an empty bucket
  // so the breakdown stays well-defined.
  if (composition.size === 0 && bill === 0) composition.set(null, 0);
  return composition;
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
  const user = await requirePermission("contractors.view");
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
    arr.push({ type: e.type, amountPaise: paiseFromBigInt(e.amountPaise, "ledger.amountPaise") });
    balByContractor.set(e.contractorId, arr);
  }
  return rows.map((c) => toContractor(c, advanceBalancePaise(balByContractor.get(c.id) ?? [])));
}

export async function getContractor(id: string): Promise<Contractor | null> {
  const user = await requirePermission("contractors.view");
  const c = await prisma.contractor.findFirst({ where: { id, companyId: user.company.id } });
  if (!c) return null;
  return toContractor(c, await outstandingAdvanceFor(user.company.id, id));
}

export async function createContractor(input: CreateContractorInput): Promise<Contractor> {
  const user = await requirePermission("contractors.create");
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
  const user = await requirePermission("contractors.edit");
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
  const user = await requirePermission("contractors.advance");
  const data = recordAdvanceSchema.parse(input);
  const c = await prisma.contractor.findFirst({
    where: { id: data.contractorId, companyId: user.company.id },
    select: { id: true, name: true },
  });
  if (!c) throw new Error("NOT_FOUND");

  // Scope validation. An agreement-scoped advance must name a project, and that
  // agreement must belong to the SAME company + contractor + project — the DB
  // enforces this with a composite FK; this produces the readable error.
  if (data.projectId) await assertProjectAccess(user, data.projectId);

  const entry = await prisma.$transaction(async (tx) => {
    if (data.contractId) {
      await assertAgreementScope(tx, {
        companyId: user.company.id,
        contractorId: data.contractorId,
        projectId: data.projectId!,
        contractId: data.contractId,
      });
    }
    const balance =
      (await outstandingAdvanceFor(user.company.id, data.contractorId)) + data.amountPaise;
    return tx.contractorLedgerEntry.create({
      data: {
        companyId: user.company.id,
        contractorId: data.contractorId,
        date: new Date(data.date),
        type: "ADVANCE",
        amountPaise: BigInt(data.amountPaise),
        advanceBalanceAfterPaise: BigInt(balance),
        notes: data.notes ?? null,
        projectId: data.projectId ?? null,
        contractId: data.contractId ?? null,
        createdById: user.id,
      },
    });
  });

  await logActivity(user, "contractor.advance", c.id, `Labour advance to ${c.name}`, {
    amountPaise: data.amountPaise,
    projectId: data.projectId ?? null,
    contractId: data.contractId ?? null,
  });
  return toLedgerEntry(entry, null);
}

// ── ledger ────────────────────────────────────────────────────────────
export async function getLedger(contractorId: string): Promise<ContractorLedger> {
  const user = await requirePermission("contractors.view");
  const c = await prisma.contractor.findFirst({
    where: { id: contractorId, companyId: user.company.id },
  });
  if (!c) throw new Error("NOT_FOUND");
  const rows = await prisma.contractorLedgerEntry.findMany({
    // Project-scoped: without contractors.view_all a caller sees only entries on
    // projects they can access. Company-wide (unattributed) advances are hidden,
    // because they cannot be attributed to any project the caller is limited to.
    where: { companyId: user.company.id, contractorId, ...ledgerScope(user) },
    orderBy: { createdAt: "asc" },
    include: {
      settlement: { select: { project: { select: { name: true } } } },
      project: { select: { name: true } },
      contract: { select: { title: true } },
    },
  });
  const entries = rows.map((e) =>
    toLedgerEntry(
      e,
      e.settlement?.project?.name ?? e.project?.name ?? null,
      e.contract?.title ?? null,
    ),
  );
  // CURRENT balance is always the fold — never a stored snapshot.
  const balance = advanceBalancePaise(
    rows.map((e) => ({
      type: e.type,
      amountPaise: paiseFromBigInt(e.amountPaise, "ledger.amountPaise"),
    })),
  );
  return { contractor: toContractor(c, balance), entries };
}

// ── settlements ───────────────────────────────────────────────────────
export async function previewSettlement(
  input: SettlementPreviewInput,
): Promise<SettlementPreview> {
  const user = await requirePermission("contractors.settle");
  await assertProjectAccess(user, input.projectId);
  const bill = await labourBillPaise(
    user.company.id,
    input.contractorId,
    input.projectId,
    input.periodStart,
    input.periodEnd,
  );
  const outstanding = await outstandingAdvanceFor(user.company.id, input.contractorId);

  // The preview must offer only what `createSettlement` can actually source.
  // Offering the raw outstanding balance would let a user request an adjustment
  // funded by an agreement-scoped advance this period's labour has no claim on,
  // and the save would then fail with ADVANCE_NOT_ALLOCATABLE.
  const composition = await billComposition(
    user.company.id,
    input.contractorId,
    input.projectId,
    input.periodStart,
    input.periodEnd,
    bill,
  );
  const advances = outstandingPerAdvance(
    await scopedLedgerFor(user.company.id, input.contractorId),
  );
  const ceiling = maxAdjustmentPaise(outstanding, bill);
  const atCeiling = allocateAdvanceDrawdown({
    outstanding: advances,
    requestedPaise: ceiling,
    projectId: input.projectId,
    composition,
  });
  const allocatable = atCeiling.reduce((a, x) => a + x.amountPaise, 0);

  const math = computeSettlement(
    bill,
    Math.min(Math.max(0, Math.round(input.advanceAdjustmentPaise)), allocatable),
    outstanding,
  );

  // Named at the ceiling, not at the requested amount: an advance the user simply
  // chose not to draw on isn't "unusable", and shouldn't be explained away.
  const leftover = unusableAdvances({
    outstanding: advances,
    allocations: atCeiling,
    projectId: input.projectId,
    composition,
  });
  const titles = await agreementTitles(
    user.company.id,
    leftover.map((u) => u.contractId).filter((id): id is string => id != null),
  );

  return {
    labourBillPaise: bill,
    outstandingAdvancePaise: outstanding,
    maxAdjustmentPaise: allocatable,
    advanceAdjustmentPaise: math.advanceAdjustmentPaise,
    netPaymentPaise: math.netPaymentPaise,
    advanceBalanceAfterPaise: math.advanceBalanceAfterPaise,
    unusableAdvances: leftover.map((u) => ({
      ...u,
      contractTitle: u.contractId ? (titles.get(u.contractId) ?? null) : null,
    })),
  };
}

/** Agreement id → title, for naming an advance's scope in the settlement sheet. */
async function agreementTitles(
  companyId: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.contractorContract.findMany({
    where: { companyId, id: { in: [...new Set(ids)] } },
    select: { id: true, title: true },
  });
  return new Map(rows.map((r) => [r.id, r.title]));
}

export async function createSettlement(
  input: CreateSettlementInput,
): Promise<ContractorSettlement> {
  const user = await requirePermission("contractors.settle");
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
    // CONCURRENCY. Lock this period's attendance rows FOR UPDATE before checking
    // anything. Without it, two concurrent settlements can both pass the overlap
    // check and both stamp — the same labour financially owned twice. With it
    // they serialize: the loser waits, then sees settlementId set and rejects.
    //
    // Same pattern as the labour-category deletion guard (labor/server/actions.ts).
    // Two documented limits: a period with NO attendance locks nothing (two
    // concurrent empty settlements can both succeed — bill 0, no stamps, so
    // harmless), and a concurrent attendance INSERT is a phantom this cannot
    // prevent — but that row stays unstamped and is picked up by a later
    // settlement, which does not break the one-owner invariant.
    await tx.$queryRaw`
      SELECT id FROM labour_attendance
      WHERE company_id = ${user.company.id}::uuid
        AND contractor_id = ${data.contractorId}::uuid
        AND project_id = ${data.projectId}::uuid
        AND date BETWEEN ${data.periodStart}::date AND ${data.periodEnd}::date
      FOR UPDATE`;

    // OVERLAP GUARD. A settlement is the canonical financial recognition of
    // labour money, so the same attendance must never be billed by two of them.
    // Nothing here restricts periods by date range — it asks the only question
    // that matters: has any attendance in this window already been recognised?
    //
    // Rejecting rather than skipping already-settled rows is deliberate. The
    // bill sums the WHOLE period unconditionally, so quietly settling "just the
    // unsettled part" would still bill money that has already been paid. Partial
    // -period semantics aren't supported anywhere in this flow, so a period that
    // overlaps a settled one is a mistake, not an instruction.
    //
    // Inside the transaction, and before any write, so a rejected attempt leaves
    // no settlement and no ledger entries behind.
    const alreadySettled = await tx.labourAttendance.findMany({
      where: {
        companyId: user.company.id,
        contractorId: data.contractorId,
        projectId: data.projectId,
        date: { gte: new Date(data.periodStart), lte: new Date(data.periodEnd) },
        settlementId: { not: null },
      },
      select: { date: true, settlementId: true },
      orderBy: { date: "asc" },
    });

    if (alreadySettled.length > 0) {
      const dates = [...new Set(alreadySettled.map((r) => iso(r.date)))];
      const settlements = [...new Set(alreadySettled.map((r) => r.settlementId))];
      const shown = dates.slice(0, 5).join(", ");
      const more = dates.length > 5 ? ` and ${dates.length - 5} more` : "";
      throw new Error(
        `SETTLEMENT_PERIOD_OVERLAPS: ${alreadySettled.length} attendance ` +
          `record${alreadySettled.length === 1 ? "" : "s"} in ${data.periodStart} – ` +
          `${data.periodEnd} ${alreadySettled.length === 1 ? "has" : "have"} already been ` +
          `settled (${shown}${more}). ` +
          `Choose a period that starts after the last settled date, or reverse ` +
          `settlement ${settlements[0]} first.`,
      );
    }

    // COMPOSITION — read inside the transaction, after the lock, so it reflects
    // exactly the rows this settlement is about to stamp.
    const composition = await billComposition(
      user.company.id,
      data.contractorId,
      data.projectId,
      data.periodStart,
      data.periodEnd,
      bill,
      tx,
    );

    // ALLOCATION — which advances are consumed, and which bucket each funds.
    // Strict-to-broad: an agreement-scoped advance never leaves its own bucket.
    const ledger = await scopedLedgerFor(user.company.id, data.contractorId, tx);
    const allocations = allocateAdvanceDrawdown({
      outstanding: outstandingPerAdvance(ledger),
      requestedPaise: math.advanceAdjustmentPaise,
      projectId: data.projectId,
      composition,
    });

    const allocated = allocations.reduce((a, x) => a + x.amountPaise, 0);
    if (allocated !== math.advanceAdjustmentPaise) {
      // The requested adjustment could not be sourced from advances this
      // settlement is allowed to consume — e.g. the only outstanding advance is
      // scoped to an agreement whose labour isn't part of this period.
      throw new Error(
        `ADVANCE_NOT_ALLOCATABLE: only ${allocated} of the requested ` +
          `${math.advanceAdjustmentPaise} paise could be drawn from advances ` +
          `eligible for this period's labour.`,
      );
    }

    const s = await tx.contractorSettlement.create({
      data: {
        companyId: user.company.id,
        contractorId: data.contractorId,
        projectId: data.projectId,
        periodStart: new Date(data.periodStart),
        periodEnd: new Date(data.periodEnd),
        labourBillPaise: BigInt(bill),
        advanceAdjustmentPaise: BigInt(math.advanceAdjustmentPaise),
        netPaymentPaise: BigInt(math.netPaymentPaise),
        advanceBalanceAfterPaise: BigInt(math.advanceBalanceAfterPaise),
        notes: data.notes ?? null,
        createdById: user.id,
      },
    });

    // BREAKDOWN — the immutable record of what this settlement knew. Reversal
    // reads this, never today's attendance attribution, because historical
    // attribution can legitimately change contractId later and a settlement
    // attributed after the fact would otherwise reverse the cash to the wrong
    // agreement.
    const buckets = buildSettlementBreakdown(composition, allocations);
    const sum = (k: "labourBillPaise" | "advanceAdjustmentPaise" | "netPaymentPaise") =>
      buckets.reduce((a, b) => a + b[k], 0);
    if (
      sum("labourBillPaise") !== bill ||
      sum("advanceAdjustmentPaise") !== math.advanceAdjustmentPaise ||
      sum("netPaymentPaise") !== math.netPaymentPaise
    ) {
      throw new Error("SETTLEMENT_BREAKDOWN_MISMATCH");
    }
    for (const b of buckets) {
      if (b.contractId) {
        await assertAgreementScope(tx, {
          companyId: user.company.id,
          contractorId: data.contractorId,
          projectId: data.projectId,
          contractId: b.contractId,
        });
      }
      await tx.contractorSettlementBreakdown.create({
        data: {
          companyId: user.company.id,
          projectId: data.projectId,
          settlementId: s.id,
          contractId: b.contractId,
          labourBillPaise: BigInt(b.labourBillPaise),
          advanceAdjustmentPaise: BigInt(b.advanceAdjustmentPaise),
          netPaymentPaise: BigInt(b.netPaymentPaise),
        },
      });
    }

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
      data: {
        ...base,
        type: "LABOUR_BILL",
        amountPaise: BigInt(bill),
        advanceBalanceAfterPaise: BigInt(bal),
      },
    });
    // One ADJUSTMENT per allocation, carrying BOTH the scope of the advance
    // consumed and the bucket it funded — they differ whenever a project or
    // legacy advance pays for an agreement's share.
    for (const a of allocations) {
      bal -= a.amountPaise;
      await tx.contractorLedgerEntry.create({
        data: {
          ...base,
          type: "ADJUSTMENT",
          amountPaise: BigInt(a.amountPaise),
          advanceBalanceAfterPaise: BigInt(bal),
          projectId: a.projectId,
          contractId: a.contractId,
          drawsFromEntryId: a.entryId,
          fundsContractId: a.fundsContractId,
        },
      });
    }
    await tx.contractorLedgerEntry.create({
      data: {
        ...base,
        type: "PAYMENT",
        amountPaise: BigInt(math.netPaymentPaise),
        advanceBalanceAfterPaise: BigInt(bal),
      },
    });

    // Stamp the attendance this settlement financially RECOGNISED.
    //
    // The settlement is the canonical record of attendance money, and this stamp
    // is what lets an agreement count settled labour as credit without ever
    // double-counting it. Two deliberate details:
    //
    //  • Only UNSTAMPED rows are claimed. A second, overlapping settlement still
    //    re-bills the same period (a pre-existing behaviour left untouched here)
    //    but cannot credit an agreement twice, because the rows already belong
    //    to the first settlement.
    //  • The bill itself is unchanged — labourBillPaise still sums every row in
    //    the period — so the figure users see on the settlement screen does not
    //    move.
    //
    // Once stamped, a row is financially immutable: setQuantity and the sync
    // handler refuse to edit or clear it (ATTENDANCE_SETTLED), so recognised
    // value can never drift away from the settlement that recognised it.
    await tx.labourAttendance.updateMany({
      where: {
        companyId: user.company.id,
        contractorId: data.contractorId,
        projectId: data.projectId,
        date: { gte: new Date(data.periodStart), lte: new Date(data.periodEnd) },
        settlementId: null,
      },
      data: { settlementId: s.id },
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

/**
 * Reverse a settlement — the governed correction path for settled attendance.
 *
 * Settled rows are financially immutable, so a mistyped headcount would
 * otherwise be permanent. Reversal un-recognises the labour and frees the rows,
 * while preserving every record: the settlement, its ledger entries and its
 * breakdown all survive, struck through rather than deleted.
 *
 * THE CASH. The net payment already left the bank and is not clawed back, so it
 * becomes an UNAPPLIED ADVANCE — the contractor really is holding that money
 * against no recognised work. Restoring only the drawdown would make it vanish
 * from the accounts:
 *
 *                                    balance     cash out   recognised
 *   advance ₹2,00,000                ₹2,00,000   ₹2,00,000          ₹0
 *   settle ₹6,00,000 (adj 2L, net 4L)       ₹0   ₹6,00,000   ₹6,00,000
 *   reverse — restore only           ₹2,00,000   ₹6,00,000          ₹0  ← ₹4L lost
 *   reverse — correct                ₹6,00,000   ₹6,00,000          ₹0  ✓
 *
 * The unapplied cash is split PER BUCKET from the settlement-time breakdown, so
 * attribution that was already known is never discarded: Structure's share
 * returns as a Structure-scoped advance, not as anonymous project money that a
 * corrected, fully-attributed re-settlement could no longer consume.
 */
export async function reverseSettlement(
  settlementId: string,
  reason: string,
): Promise<ContractorSettlement> {
  const user = await requirePermission("contractors.settle_reverse");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("REVERSAL_REASON_REQUIRED");

  const existing = await prisma.contractorSettlement.findFirst({
    where: { id: settlementId, companyId: user.company.id },
    include: {
      contractor: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, pmId: true } },
    },
  });
  if (!existing) throw new Error("NOT_FOUND");
  await assertProjectAccess(user, existing.projectId);
  if (existing.reversedAt) throw new Error("SETTLEMENT_ALREADY_REVERSED");

  const reversed = await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction so two concurrent reversals cannot both
    // proceed and double-restore the advance.
    const fresh = await tx.$queryRaw<{ id: string; reversed_at: Date | null }[]>`
      SELECT id, reversed_at FROM contractor_settlements
      WHERE id = ${settlementId}::uuid AND company_id = ${user.company.id}::uuid
      FOR UPDATE`;
    if (fresh.length === 0) throw new Error("NOT_FOUND");
    if (fresh[0].reversed_at) throw new Error("SETTLEMENT_ALREADY_REVERSED");

    const date = new Date();
    const base = {
      companyId: user.company.id,
      contractorId: existing.contractorId,
      settlementId,
      date,
      createdById: user.id,
    };

    let bal = await outstandingAdvanceFor(user.company.id, existing.contractorId);

    // 1. Restore each drawdown to the advance it came from, scope intact.
    const drawdowns = await tx.contractorLedgerEntry.findMany({
      where: { companyId: user.company.id, settlementId, type: "ADJUSTMENT" },
      select: {
        id: true,
        amountPaise: true,
        projectId: true,
        contractId: true,
      },
    });
    let restoredPaise = 0;
    for (const d of drawdowns) {
      const amount = paiseFromBigInt(d.amountPaise, "ledger.amountPaise");
      if (amount <= 0) continue;
      bal += amount;
      restoredPaise += amount;
      await tx.contractorLedgerEntry.create({
        data: {
          ...base,
          type: "SETTLEMENT_REVERSAL",
          amountPaise: BigInt(amount),
          advanceBalanceAfterPaise: BigInt(bal),
          projectId: d.projectId,
          contractId: d.contractId,
          reversesEntryId: d.id,
          notes: "Drawdown restored on settlement reversal",
        },
      });
    }

    // 2. Un-apply the cash, per bucket, from the SETTLEMENT-TIME breakdown.
    const buckets = await tx.contractorSettlementBreakdown.findMany({
      where: { companyId: user.company.id, settlementId },
    });
    let unappliedPaise = 0;
    for (const b of buckets) {
      const net = paiseFromBigInt(b.netPaymentPaise, "breakdown.netPaymentPaise");
      if (net <= 0) continue;
      if (b.contractId) {
        await assertAgreementScope(tx, {
          companyId: user.company.id,
          contractorId: existing.contractorId,
          projectId: existing.projectId,
          contractId: b.contractId,
        });
      }
      bal += net;
      unappliedPaise += net;
      await tx.contractorLedgerEntry.create({
        data: {
          ...base,
          type: "SETTLEMENT_REVERSAL",
          amountPaise: BigInt(net),
          advanceBalanceAfterPaise: BigInt(bal),
          // Keeps the agreement attribution the settlement recorded.
          projectId: existing.projectId,
          contractId: b.contractId,
          reversesEntryId: null,
          notes: "Net payment unapplied on settlement reversal",
        },
      });
    }

    // The two identities the whole design rests on.
    const billPaise = paiseFromBigInt(existing.labourBillPaise, "settlement.labourBillPaise");
    const netPaise = paiseFromBigInt(existing.netPaymentPaise, "settlement.netPaymentPaise");
    if (restoredPaise + unappliedPaise !== billPaise || unappliedPaise !== netPaise) {
      throw new Error("REVERSAL_IMBALANCE");
    }

    // 3. Free the attendance — editable again, and out of agreement credit.
    const freed = await tx.labourAttendance.updateMany({
      where: { companyId: user.company.id, settlementId },
      data: { settlementId: null },
    });

    const updated = await tx.contractorSettlement.update({
      where: { id: settlementId },
      data: { reversedAt: date, reversedById: user.id, reversalReason: trimmed },
    });

    await tx.activityLog.create({
      data: {
        companyId: user.company.id,
        actorId: user.id,
        action: "contractor.settlement_reversed",
        entityType: "contractor",
        entityId: existing.contractorId,
        summary: `Reversed settlement for ${existing.contractor.name} (${existing.project.name})`,
        meta: {
          settlementId,
          reason: trimmed,
          labourBillPaise: billPaise,
          restoredPaise,
          unappliedPaise,
          attendanceRowsFreed: freed.count,
          advanceBalanceAfterPaise: bal,
        },
      },
    });
    return updated;
  });

  return toSettlement(reversed, existing.contractor.name, existing.project.name);
}

type SettlementRow = {
  id: string;
  contractorId: string;
  projectId: string;
  periodStart: Date;
  periodEnd: Date;
  labourBillPaise: bigint;
  advanceAdjustmentPaise: bigint;
  netPaymentPaise: bigint;
  advanceBalanceAfterPaise: bigint;
  notes: string | null;
  reversedAt?: Date | null;
  reversalReason?: string | null;
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
    labourBillPaise: paiseFromBigInt(s.labourBillPaise, "settlement.labourBillPaise"),
    advanceAdjustmentPaise: paiseFromBigInt(
      s.advanceAdjustmentPaise,
      "settlement.advanceAdjustmentPaise",
    ),
    netPaymentPaise: paiseFromBigInt(s.netPaymentPaise, "settlement.netPaymentPaise"),
    // HISTORICAL footprint — see the note on the ledger's equivalent column.
    advanceBalanceAfterPaise: paiseFromBigInt(
      s.advanceBalanceAfterPaise,
      "settlement.advanceBalanceAfterPaise",
    ),
    notes: s.notes,
    reversedAt: s.reversedAt?.toISOString() ?? null,
    reversalReason: s.reversalReason ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

export async function listSettlements(
  filters: SettlementFilters = {},
): Promise<ContractorSettlement[]> {
  const user = await requirePermission("contractors.view");
  const rows = await prisma.contractorSettlement.findMany({
    where: {
      companyId: user.company.id,
      // Project-scoped: without contractors.view_all a caller sees settlements
      // only for projects they can access.
      ...settlementScope(user),
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
  const user = await requirePermission("contractors.view");
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
      totalBillPaise: paiseFromNullableBigInt(g?._sum.labourBillPaise, "settlement.labourBillPaise"),
      totalPaidPaise: paiseFromNullableBigInt(g?._sum.netPaymentPaise, "settlement.netPaymentPaise"),
      totalAdjustedPaise: paiseFromNullableBigInt(
        g?._sum.advanceAdjustmentPaise,
        "settlement.advanceAdjustmentPaise",
      ),
      advanceBalancePaise: c.advanceBalancePaise,
      settlementCount: g?._count._all ?? 0,
    };
  });
}
