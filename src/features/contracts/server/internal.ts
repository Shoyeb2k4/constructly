/**
 * Shared internals for the agreement server actions.
 *
 * Deliberately NOT a `"use server"` module: these are helpers, not RPC
 * endpoints, and exporting them from an action file would publish every one as a
 * callable server action.
 *
 * Authorization contract every caller follows, in this order:
 *   1. `requirePermission("contracts.*")` — before any database work.
 *   2. `assertProjectAccess` / `assertContractorAccess` for client-supplied FKs.
 *   3. `projectScope(user)` inside every WHERE, so a permission alone never
 *      reaches a project the caller can't see.
 * A client-supplied companyId is never trusted anywhere.
 */

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma";
import { hasPermission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { reconcileAgreement } from "../reconcile";
import {
  cumulativeEarnedThroughPaise,
  milestoneCurrentCoverageState,
  milestoneFinancialStateAtCompletion,
} from "../milestones";
import { reconcileAsOf } from "../reconcile";
import type {
  AgreementSnapshot,
  Amendment,
  Contract,
  ContractPayment,
  Milestone,
  RateRevision,
  ScopeItem,
} from "../types";

/** Date → YYYY-MM-DD. */
export const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Project access: the assigned PM, or anyone with the broad projects.view_all. */
export async function assertProjectAccess(user: SessionUser, projectId: string) {
  const p = await prisma.project.findFirst({
    where: {
      id: projectId,
      companyId: user.company.id,
      deletedAt: null,
      ...(hasPermission(user, "projects.view_all") ? {} : { pmId: user.id }),
    },
    select: { id: true },
  });
  if (!p) throw new Error("FORBIDDEN");
}

/** Tenant guard for a client-supplied contractorId — never trust a foreign FK. */
export async function assertContractorAccess(user: SessionUser, contractorId: string) {
  const c = await prisma.contractor.findFirst({
    where: { id: contractorId, companyId: user.company.id },
    select: { id: true },
  });
  if (!c) throw new Error("FORBIDDEN");
}

/**
 * WHERE fragment scoping agreements to the projects a user may access. Also
 * excludes soft-deleted projects — an agreement on a deleted project should not
 * surface in any list, even for an Owner.
 */
export function projectScope(user: SessionUser) {
  return hasPermission(user, "projects.view_all")
    ? { project: { deletedAt: null } }
    : { project: { pmId: user.id, deletedAt: null } };
}

/** Every commercial mutation writes one of these, inside the same transaction. */
export async function logContract(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  action: string,
  entityType: "contractor_contract" | "contractor_contract_payment",
  entityId: string,
  summary: string,
  meta?: Prisma.InputJsonValue,
) {
  await tx.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action,
      entityType,
      entityId,
      summary,
      meta: meta ?? undefined,
    },
  });
}

/* ── Snapshot assembly ──────────────────────────────────────────────────── */

/**
 * The include shape that hydrates everything `reconcileAgreement` needs in one
 * read. Note the two attendance groups: SETTLED rows are the agreement's
 * attendance credit (settlement is the canonical recognition of labour money),
 * and unsettled rows ride along only as an informational figure.
 */
export const agreementInclude = {
  contractor: { select: { name: true } },
  project: { select: { name: true } },
  amendments: {
    where: { deletedAt: null },
    orderBy: { sequence: "asc" as const },
    include: {
      requestedBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
    },
  },
  milestones: {
    where: { deletedAt: null },
    orderBy: { sequence: "asc" as const },
    include: { completedBy: { select: { fullName: true } } },
  },
  payments: {
    orderBy: { date: "desc" as const },
    include: {
      milestone: { select: { title: true } },
      createdBy: { select: { fullName: true } },
    },
  },
  attendance: {
    select: { id: true, date: true, estimatedCostPaise: true, settlementId: true },
  },
} satisfies Prisma.ContractorContractInclude;

export type AgreementRow = Prisma.ContractorContractGetPayload<{
  include: typeof agreementInclude;
}>;

/**
 * Build the pure engine input from a hydrated row. All BigInt → number and
 * Decimal → number conversion happens here; neither type survives the RSC
 * boundary, and a missed conversion throws at runtime rather than compile time.
 */
export function toSnapshot(row: AgreementRow): AgreementSnapshot {
  const settled = row.attendance.filter((a) => a.settlementId != null);
  const unsettled = row.attendance.filter((a) => a.settlementId == null);

  return {
    agreementId: row.id,
    status: row.status,
    originalAmountPaise: Number(row.originalAmountPaise),
    amendments: row.amendments.map((a) => ({
      id: a.id,
      status: a.status,
      deltaPaise: Number(a.deltaPaise),
      effectiveDate: iso(a.effectiveDate),
    })),
    milestones: row.milestones.map((m) => ({
      id: m.id,
      sequence: m.sequence,
      title: m.title,
      valuePaise: Number(m.valuePaise),
      status: m.status,
      completedAt: m.completedAt?.toISOString() ?? null,
    })),
    attendanceCredits: settled.map((a) => ({
      id: a.id,
      date: iso(a.date),
      amountPaise: a.estimatedCostPaise,
    })),
    payments: row.payments.map((p) => ({
      id: p.id,
      date: iso(p.date),
      amountPaise: Number(p.amountPaise),
      type: p.type,
      reversedAt: p.deletedAt?.toISOString() ?? null,
    })),
    unsettledAttendancePaise: unsettled.reduce((acc, a) => acc + a.estimatedCostPaise, 0),
  };
}

export function toContract(row: AgreementRow): Contract {
  return {
    id: row.id,
    contractorId: row.contractorId,
    contractorName: row.contractor.name,
    projectId: row.projectId,
    projectName: row.project.name,
    title: row.title,
    reference: row.reference,
    scope: row.scope,
    // Prisma Decimal is not serializable across the RSC boundary.
    quantity: row.quantity == null ? null : row.quantity.toNumber(),
    unit: row.unit,
    originalAmountPaise: Number(row.originalAmountPaise),
    currentAmountPaise: Number(row.currentAmountPaise),
    startDate: row.startDate ? iso(row.startDate) : null,
    expectedCompletionDate: row.expectedCompletionDate ? iso(row.expectedCompletionDate) : null,
    status: row.status,
    notes: row.notes,
    completedAt: row.completedAt?.toISOString() ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledReason: row.cancelledReason,
    createdAt: row.createdAt.toISOString(),
    reconciliation: reconcileAgreement(toSnapshot(row)),
  };
}

export function toMilestones(row: AgreementRow): Milestone[] {
  const snapshot = toSnapshot(row);
  return row.milestones.map((m) => {
    const entry = snapshot.milestones.find((e) => e.id === m.id)!;
    const at =
      m.status === "COMPLETED" && m.completedAt
        ? reconcileAsOf(snapshot, iso(m.completedAt))
        : null;
    return {
      id: m.id,
      contractId: m.contractId,
      sequence: m.sequence,
      title: m.title,
      description: m.description,
      valuePaise: Number(m.valuePaise),
      plannedDate: m.plannedDate ? iso(m.plannedDate) : null,
      status: m.status,
      completedAt: m.completedAt?.toISOString() ?? null,
      completedByName: m.completedBy?.fullName ?? null,
      cancelledAt: m.cancelledAt?.toISOString() ?? null,
      cancelledReason: m.cancelledReason,
      notes: m.notes,
      createdAt: m.createdAt.toISOString(),
      financialStateAtCompletion: milestoneFinancialStateAtCompletion(snapshot, entry),
      currentCoverageState: milestoneCurrentCoverageState(snapshot, entry),
      cumulativeEarnedPaise: at?.earnedValuePaise ?? null,
      cumulativeCreditedPaise: at?.totalCreditedPaise ?? null,
      cumulativeEarnedThresholdPaise: cumulativeEarnedThroughPaise(snapshot.milestones, entry),
    };
  });
}

export function toPayments(row: AgreementRow): ContractPayment[] {
  return row.payments.map((p) => ({
    id: p.id,
    contractId: p.contractId,
    contractorId: p.contractorId,
    projectId: p.projectId,
    amountPaise: Number(p.amountPaise),
    type: p.type,
    paymentMode: p.paymentMode,
    referenceNumber: p.referenceNumber,
    date: iso(p.date),
    notes: p.notes,
    milestoneId: p.milestoneId,
    milestoneTitle: p.milestone?.title ?? null,
    reversedAt: p.deletedAt?.toISOString() ?? null,
    reversalReason: p.reversalReason,
    createdByName: p.createdBy?.fullName ?? null,
    createdAt: p.createdAt.toISOString(),
  }));
}

export function toAmendments(row: AgreementRow): Amendment[] {
  return row.amendments.map((a) => ({
    id: a.id,
    contractId: a.contractId,
    sequence: a.sequence,
    type: a.type,
    previousAmountPaise: Number(a.previousAmountPaise),
    revisedAmountPaise: Number(a.revisedAmountPaise),
    deltaPaise: Number(a.deltaPaise),
    reason: a.reason,
    effectiveDate: iso(a.effectiveDate),
    status: a.status,
    requestedByName: a.requestedBy?.fullName ?? null,
    approvedByName: a.approvedBy?.fullName ?? null,
    approvedAt: a.approvedAt?.toISOString() ?? null,
    rejectedReason: a.rejectedReason,
    createdAt: a.createdAt.toISOString(),
  }));
}

export const scopeItemInclude = {
  subcategory: {
    select: { name: true, categoryId: true, category: { select: { name: true } } },
  },
} satisfies Prisma.ContractScopeItemInclude;

export type ScopeItemRow = Prisma.ContractScopeItemGetPayload<{
  include: typeof scopeItemInclude;
}>;

export function toScopeItem(row: ScopeItemRow): ScopeItem {
  return {
    id: row.id,
    contractId: row.contractId,
    labourSubcategoryId: row.labourSubcategoryId,
    subcategoryName: row.subcategory.name,
    categoryId: row.subcategory.categoryId,
    categoryName: row.subcategory.category.name,
    currentRatePaise: row.currentRatePaise,
    rateUnit: row.rateUnit,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toRateRevision(row: {
  id: string;
  scopeItemId: string;
  ratePaise: number;
  rateUnit: string;
  effectiveFrom: Date;
  reason: string | null;
  createdAt: Date;
  createdBy?: { fullName: string } | null;
}): RateRevision {
  return {
    id: row.id,
    scopeItemId: row.scopeItemId,
    ratePaise: row.ratePaise,
    rateUnit: row.rateUnit,
    effectiveFrom: iso(row.effectiveFrom),
    reason: row.reason,
    createdByName: row.createdBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Load an agreement the caller is allowed to touch, or throw NOT_FOUND.
 * Centralised so no action can accidentally omit the company or project scope.
 */
export async function loadAgreement(
  user: SessionUser,
  contractId: string,
): Promise<AgreementRow> {
  const row = await prisma.contractorContract.findFirst({
    where: { id: contractId, companyId: user.company.id, deletedAt: null, ...projectScope(user) },
    include: agreementInclude,
  });
  if (!row) throw new Error("NOT_FOUND");
  return row;
}
