"use server";

/**
 * Read-only reconciliation surfaces.
 *
 * Every number here comes from ../reconcile — nothing is computed locally. The
 * roll-ups in particular go through `rollUpReconciliations`, which sums each
 * agreement's due and ahead independently rather than re-deriving them, so one
 * agreement's advance can never extinguish another's liability.
 */

import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/permissions";
import { reconcileAgreement, rollUpReconciliations } from "../reconcile";
import { advanceBalancePaise } from "@/features/contractors/calc";
import { paiseFromBigInt } from "@/lib/money";
import type {
  AgreementReconciliation,
  Contract,
  ContractorProfile,
  ContractPaymentHistoryRow,
  HistoryEvent,
  PortfolioReconciliation,
  ProjectAgreementsGroup,
  ProjectContractorSummaryRow,
} from "../types";
import {
  agreementInclude,
  assertProjectAccess,
  loadAgreement,
  projectScope,
  toContract,
  toPayments,
  toSnapshot,
} from "./internal";

export async function getAgreementReconciliation(
  contractId: string,
): Promise<AgreementReconciliation> {
  const user = await requirePermission("contracts.view");
  return reconcileAgreement(toSnapshot(await loadAgreement(user, contractId)));
}

/**
 * A contractor's commercial position, grouped by project.
 *
 * Note for callers rendering the lifetime header: for a user without
 * `projects.view_all` this is scoped to the projects they can see, so it is
 * their visible position rather than the contractor's true lifetime. The UI
 * should say so rather than presenting a partial figure as a total.
 */
export async function getContractorReconciliation(
  contractorId: string,
  filters: { projectId?: string } = {},
): Promise<{ perAgreement: AgreementReconciliation[]; rollup: PortfolioReconciliation }> {
  const user = await requirePermission("contracts.view");
  const rows = await prisma.contractorContract.findMany({
    where: {
      contractorId,
      companyId: user.company.id,
      deletedAt: null,
      ...projectScope(user),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
    },
    include: agreementInclude,
  });
  const perAgreement = rows.map((r) => reconcileAgreement(toSnapshot(r)));
  return { perAgreement, rollup: rollUpReconciliations(perAgreement) };
}

export async function getContractorProfile(
  contractorId: string,
): Promise<ContractorProfile | null> {
  const user = await requirePermission("contracts.view");

  const contractor = await prisma.contractor.findFirst({
    where: { id: contractorId, companyId: user.company.id },
    select: { id: true, name: true, phone: true, status: true },
  });
  if (!contractor) return null;

  const rows = await prisma.contractorContract.findMany({
    where: { contractorId, companyId: user.company.id, deletedAt: null, ...projectScope(user) },
    include: agreementInclude,
    orderBy: { createdAt: "desc" },
  });

  const contracts = rows.map(toContract);

  const byProject = new Map<string, Contract[]>();
  for (const c of contracts) {
    const list = byProject.get(c.projectId) ?? [];
    list.push(c);
    byProject.set(c.projectId, list);
  }

  const projects: ProjectAgreementsGroup[] = [...byProject.entries()].map(
    ([projectId, list]) => ({
      projectId,
      projectName: list[0].projectName,
      contracts: list,
      rollup: rollUpReconciliations(list.map((c) => c.reconciliation)),
    }),
  );

  const payments: ContractPaymentHistoryRow[] = rows
    .flatMap((row) =>
      toPayments(row).map((p) => ({
        ...p,
        projectName: row.project.name,
        contractTitle: row.title,
      })),
    )
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    contractor,
    projects,
    // Lifetime sums each agreement's due and ahead — never nets them.
    lifetime: rollUpReconciliations(contracts.map((c) => c.reconciliation)),
    payments,
  };
}

/** One row per contractor with agreements on this project. */
export async function projectContractorsCommercialSummary(
  projectId: string,
): Promise<ProjectContractorSummaryRow[]> {
  const user = await requirePermission("contracts.view");
  await assertProjectAccess(user, projectId);

  const rows = await prisma.contractorContract.findMany({
    where: { projectId, companyId: user.company.id, deletedAt: null },
    include: agreementInclude,
    orderBy: { createdAt: "desc" },
  });

  const byContractor = new Map<string, { name: string; recons: AgreementReconciliation[] }>();
  for (const row of rows) {
    const entry = byContractor.get(row.contractorId) ?? {
      name: row.contractor.name,
      recons: [],
    };
    entry.recons.push(reconcileAgreement(toSnapshot(row)));
    byContractor.set(row.contractorId, entry);
  }

  return [...byContractor.entries()]
    .map(([contractorId, { name, recons }]) => {
      const roll = rollUpReconciliations(recons);
      return {
        contractorId,
        contractorName: name,
        agreementCount: roll.agreementCount,
        contractValuePaise: roll.totalContractValuePaise,
        earnedPaise: roll.totalEarnedPaise,
        creditedPaise: roll.totalCreditedPaise,
        currentDuePaise: roll.totalCurrentDuePaise,
        advanceCreditPaise: roll.totalAdvanceCreditPaise,
      };
    })
    .sort((a, b) => a.contractorName.localeCompare(b.contractorName));
}

/**
 * The LABOUR ADVANCE position for an agreement — deliberately OUTSIDE
 * `AgreementReconciliation`.
 *
 * A labour advance pre-pays future labour and is netted off a settlement; it is
 * never agreement credit in its own right, because the agreement is credited by
 * the attendance that settlement recognises. Keeping it out of the engine's
 * input is what makes double-counting structurally impossible, so this is a
 * parallel read the UI shows beside the statement, clearly labelled.
 */
export async function getAgreementAdvancePosition(
  contractId: string,
): Promise<{ labourAdvanceOutstandingPaise: number }> {
  const user = await requirePermission("contracts.view");
  const contract = await loadAgreement(user, contractId);

  const entries = await prisma.contractorLedgerEntry.findMany({
    where: { companyId: user.company.id, contractorId: contract.contractorId, contractId },
    select: { type: true, amountPaise: true },
  });

  return {
    labourAdvanceOutstandingPaise: advanceBalancePaise(
      entries.map((e) => ({
        type: e.type,
        amountPaise: paiseFromBigInt(e.amountPaise, "ledger.amountPaise"),
      })),
    ),
  };
}

/**
 * Where a contractor's labour on a project currently sits.
 *
 * Production attendance carries no `contractId` yet, so agreement attendance
 * credit is legitimately zero and `settledUnattributedPaise` is where that money
 * actually is. The UI must show this rather than let a reader assume the
 * contractor's labour has been attributed — and reconciliation must not guess
 * which agreement it belongs to.
 */
export async function getContractorProjectAttendancePosition(
  contractorId: string,
  projectId: string,
): Promise<{
  settledAttributedPaise: number;
  settledUnattributedPaise: number;
  unsettledPaise: number;
}> {
  const user = await requirePermission("contracts.view");
  await assertProjectAccess(user, projectId);

  const rows = await prisma.labourAttendance.findMany({
    where: { companyId: user.company.id, contractorId, projectId },
    select: { estimatedCostPaise: true, settlementId: true, contractId: true },
  });

  let settledAttributedPaise = 0;
  let settledUnattributedPaise = 0;
  let unsettledPaise = 0;
  for (const r of rows) {
    if (r.settlementId == null) unsettledPaise += r.estimatedCostPaise;
    else if (r.contractId) settledAttributedPaise += r.estimatedCostPaise;
    else settledUnattributedPaise += r.estimatedCostPaise;
  }

  return { settledAttributedPaise, settledUnattributedPaise, unsettledPaise };
}

/**
 * The audited commercial history for a contractor's agreements.
 *
 * Reads ActivityLog rather than reconstructing events from current state: the
 * log records what happened and who did it, including things current state no
 * longer shows — a rejected amendment, a reversed payment, a milestone that was
 * completed and later un-completed.
 */
export async function listHistory(contractorId: string): Promise<HistoryEvent[]> {
  const user = await requirePermission("contracts.view");

  const agreements = await prisma.contractorContract.findMany({
    where: { contractorId, companyId: user.company.id, ...projectScope(user) },
    select: { id: true, title: true, project: { select: { name: true } } },
  });
  const byId = new Map(agreements.map((a) => [a.id, a]));

  const payments = await prisma.contractorContractPayment.findMany({
    where: { contractorId, companyId: user.company.id, contractId: { in: [...byId.keys()] } },
    select: { id: true, contractId: true },
  });
  const paymentToContract = new Map(payments.map((p) => [p.id, p.contractId]));

  const rows = await prisma.activityLog.findMany({
    where: {
      companyId: user.company.id,
      OR: [
        { entityType: "contractor_contract", entityId: { in: [...byId.keys()] } },
        { entityType: "contractor_contract_payment", entityId: { in: [...paymentToContract.keys()] } },
        // Settlement reversals and advances are logged against the contractor.
        { entityType: "contractor", entityId: contractorId },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { fullName: true } } },
  });

  return rows.map((r) => {
    const contractId =
      r.entityType === "contractor_contract"
        ? r.entityId
        : (paymentToContract.get(r.entityId) ?? null);
    const agreement = contractId ? byId.get(contractId) : undefined;
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    const amount = [
      meta.amountPaise,
      meta.netPaymentPaise,
      meta.valuePaise,
      meta.deltaPaise,
      meta.originalAmountPaise,
    ].find((v) => typeof v === "number");

    return {
      id: r.id,
      action: r.action,
      summary: r.summary,
      at: r.createdAt.toISOString(),
      actorName: r.actor?.fullName ?? null,
      amountPaise: typeof amount === "number" ? amount : null,
      contractId: contractId ?? null,
      contractTitle: agreement?.title ?? null,
      projectName: agreement?.project.name ?? null,
    };
  });
}
