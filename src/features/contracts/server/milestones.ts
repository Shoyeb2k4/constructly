"use server";

/**
 * Milestone lifecycle — the earned-value side of reconciliation.
 *
 * A milestone is an earned-value checkpoint, NOT a payment bucket. Completing it
 * recognises its value as earned; payments stay cumulative at agreement level
 * and are never allocated to a particular milestone as the accounting basis.
 *
 * The load-bearing rule here is the EARNED-VALUE CEILING: cumulative completed
 * value may never exceed the authorised contract value. Milestones may
 * over-cover during setup (that's a warning), but recognition is blocked —
 * raise an amendment first.
 */

import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/permissions";
import {
  completedValuePaise,
  validateMilestoneCompletion,
  validateMilestoneTransition,
} from "../milestones";
import {
  createMilestoneSchema,
  setMilestoneStatusSchema,
  updateMilestoneSchema,
} from "../schema";
import type {
  CreateMilestoneInput,
  Milestone,
  MilestoneStatus,
  UpdateMilestoneInput,
} from "../types";
import { loadAgreement, logContract, toMilestones, toSnapshot } from "./internal";
import { reconcileAgreement } from "../reconcile";

export async function listMilestones(contractId: string): Promise<Milestone[]> {
  const user = await requirePermission("contracts.view");
  return toMilestones(await loadAgreement(user, contractId));
}

export async function createMilestone(input: CreateMilestoneInput): Promise<Milestone[]> {
  const user = await requirePermission("contracts.edit");
  const data = createMilestoneSchema.parse(input);
  const contract = await loadAgreement(user, data.contractId);

  await prisma.$transaction(async (tx) => {
    const nextSequence =
      data.sequence ??
      (await tx.contractMilestone.count({ where: { contractId: data.contractId, deletedAt: null } }));

    const row = await tx.contractMilestone.create({
      data: {
        companyId: user.company.id,
        projectId: contract.projectId,
        contractId: data.contractId,
        sequence: nextSequence,
        title: data.title,
        description: data.description ?? null,
        valuePaise: BigInt(data.valuePaise),
        plannedDate: data.plannedDate ? new Date(data.plannedDate) : null,
        notes: data.notes ?? null,
        createdById: user.id,
      },
    });
    await logContract(
      tx,
      user,
      "contract.milestone_created",
      "contractor_contract",
      data.contractId,
      `Added milestone "${data.title}" to "${contract.title}"`,
      { milestoneId: row.id, valuePaise: data.valuePaise },
    );
  });

  return toMilestones(await loadAgreement(user, data.contractId));
}

/**
 * Create several milestones at once — the "6 slabs × ₹10,00,000" path. Values
 * need not be equal; the caller supplies each one.
 */
export async function createMilestonesBulk(
  contractId: string,
  inputs: CreateMilestoneInput[],
): Promise<Milestone[]> {
  const user = await requirePermission("contracts.edit");
  const contract = await loadAgreement(user, contractId);
  const parsed = inputs.map((i) => createMilestoneSchema.parse({ ...i, contractId }));
  if (parsed.length === 0) return toMilestones(contract);

  await prisma.$transaction(async (tx) => {
    const base = await tx.contractMilestone.count({
      where: { contractId, deletedAt: null },
    });
    await tx.contractMilestone.createMany({
      data: parsed.map((d, i) => ({
        companyId: user.company.id,
        projectId: contract.projectId,
        contractId,
        sequence: d.sequence ?? base + i,
        title: d.title,
        description: d.description ?? null,
        valuePaise: BigInt(d.valuePaise),
        plannedDate: d.plannedDate ? new Date(d.plannedDate) : null,
        notes: d.notes ?? null,
        createdById: user.id,
      })),
    });
    await logContract(
      tx,
      user,
      "contract.milestone_created",
      "contractor_contract",
      contractId,
      `Added ${parsed.length} milestones to "${contract.title}"`,
      { count: parsed.length, totalValuePaise: parsed.reduce((a, d) => a + d.valuePaise, 0) },
    );
  });

  return toMilestones(await loadAgreement(user, contractId));
}

export async function updateMilestone(
  id: string,
  patch: UpdateMilestoneInput,
): Promise<Milestone[]> {
  const user = await requirePermission("contracts.edit");
  const data = updateMilestoneSchema.parse(patch);

  const existing = await prisma.contractMilestone.findFirst({
    where: { id, companyId: user.company.id, deletedAt: null },
    select: { id: true, contractId: true, title: true, valuePaise: true, status: true },
  });
  if (!existing) throw new Error("NOT_FOUND");
  const contract = await loadAgreement(user, existing.contractId);

  // Editing the value of an ALREADY-completed milestone changes recognised
  // earned value, so it must respect the same ceiling as completing one.
  if (data.valuePaise !== undefined && existing.status === "COMPLETED") {
    const snapshot = toSnapshot(contract);
    const others = completedValuePaise(snapshot.milestones.filter((m) => m.id !== id));
    const blocked = validateMilestoneCompletion({
      alreadyCompletedValuePaise: others,
      thisMilestoneValuePaise: data.valuePaise,
      currentContractValuePaise: reconcileAgreement(snapshot).currentContractValuePaise,
    });
    if (blocked) throw new Error(`EARNED_VALUE_EXCEEDS_CONTRACT: ${blocked}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.contractMilestone.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.valuePaise !== undefined ? { valuePaise: BigInt(data.valuePaise) } : {}),
        ...(data.plannedDate !== undefined
          ? { plannedDate: data.plannedDate ? new Date(data.plannedDate) : null }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });
    await logContract(
      tx,
      user,
      "contract.milestone_updated",
      "contractor_contract",
      existing.contractId,
      `Updated milestone "${existing.title}"`,
      {
        milestoneId: id,
        ...(data.valuePaise !== undefined
          ? { fromValuePaise: Number(existing.valuePaise), toValuePaise: data.valuePaise }
          : {}),
      },
    );
  });

  return toMilestones(await loadAgreement(user, existing.contractId));
}

export async function reorderMilestones(contractId: string, orderedIds: string[]): Promise<Milestone[]> {
  const user = await requirePermission("contracts.edit");
  await loadAgreement(user, contractId);

  const owned = await prisma.contractMilestone.findMany({
    where: { contractId, companyId: user.company.id, deletedAt: null },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((m) => m.id));
  if (orderedIds.some((id) => !ownedIds.has(id))) throw new Error("INVALID_MILESTONE");

  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.contractMilestone.update({ where: { id }, data: { sequence: i } }),
    ),
  );
  return toMilestones(await loadAgreement(user, contractId));
}

/**
 * Change a milestone's PHYSICAL status. Completing it is financial recognition,
 * so it re-reads the agreement inside the transaction and enforces the
 * earned-value ceiling against committed state.
 */
export async function setMilestoneStatus(
  id: string,
  status: MilestoneStatus,
  opts: { reason?: string | null } = {},
): Promise<Milestone[]> {
  const user = await requirePermission("contracts.complete");
  const data = setMilestoneStatusSchema.parse({ status, reason: opts.reason ?? null });

  const existing = await prisma.contractMilestone.findFirst({
    where: { id, companyId: user.company.id, deletedAt: null },
    select: { id: true, contractId: true, title: true, status: true, valuePaise: true },
  });
  if (!existing) throw new Error("NOT_FOUND");
  await loadAgreement(user, existing.contractId);

  if (data.status === "CANCELLED" && !data.reason) throw new Error("CANCEL_REASON_REQUIRED");

  const linkedPaise = await prisma.contractorContractPayment.aggregate({
    where: { milestoneId: id, deletedAt: null },
    _sum: { amountPaise: true },
  });

  const blockedTransition = validateMilestoneTransition({
    from: existing.status,
    to: data.status,
    linkedNonReversedPaymentPaise: Number(linkedPaise._sum.amountPaise ?? 0),
  });
  if (blockedTransition) {
    throw new Error(
      data.status === "CANCELLED" && Number(linkedPaise._sum.amountPaise ?? 0) > 0
        ? `MILESTONE_HAS_PAYMENTS: ${blockedTransition}`
        : `INVALID_STATUS_TRANSITION: ${blockedTransition}`,
    );
  }

  await prisma.$transaction(async (tx) => {
    if (data.status === "COMPLETED") {
      const fresh = await tx.contractorContract.findFirstOrThrow({
        where: { id: existing.contractId, companyId: user.company.id },
        include: {
          milestones: { where: { deletedAt: null } },
        },
      });
      const alreadyCompleted = fresh.milestones
        .filter((m) => m.id !== id && m.status === "COMPLETED")
        .reduce((acc, m) => acc + Number(m.valuePaise), 0);

      const blocked = validateMilestoneCompletion({
        alreadyCompletedValuePaise: alreadyCompleted,
        thisMilestoneValuePaise: Number(existing.valuePaise),
        currentContractValuePaise: Number(fresh.currentAmountPaise),
      });
      if (blocked) throw new Error(`EARNED_VALUE_EXCEEDS_CONTRACT: ${blocked}`);
    }

    await tx.contractMilestone.update({
      where: { id },
      data: {
        status: data.status,
        completedAt: data.status === "COMPLETED" ? new Date() : null,
        completedById: data.status === "COMPLETED" ? user.id : null,
        cancelledAt: data.status === "CANCELLED" ? new Date() : null,
        cancelledReason: data.status === "CANCELLED" ? data.reason : null,
      },
    });

    await logContract(
      tx,
      user,
      data.status === "COMPLETED" ? "contract.milestone_completed" : "contract.milestone_status_changed",
      "contractor_contract",
      existing.contractId,
      `Milestone "${existing.title}": ${existing.status} → ${data.status}`,
      {
        milestoneId: id,
        from: existing.status,
        to: data.status,
        valuePaise: Number(existing.valuePaise),
        ...(data.reason ? { reason: data.reason } : {}),
      },
    );
  });

  return toMilestones(await loadAgreement(user, existing.contractId));
}

/**
 * Hard-remove a milestone that was never started and carries no payments.
 * Anything with history must be CANCELLED instead, so earned-value history stays
 * intact.
 */
export async function deleteMilestone(id: string): Promise<Milestone[]> {
  const user = await requirePermission("contracts.edit");
  const existing = await prisma.contractMilestone.findFirst({
    where: { id, companyId: user.company.id, deletedAt: null },
    select: { id: true, contractId: true, title: true, status: true },
  });
  if (!existing) throw new Error("NOT_FOUND");
  await loadAgreement(user, existing.contractId);

  if (existing.status !== "NOT_STARTED") throw new Error("MILESTONE_HAS_HISTORY");
  const linked = await prisma.contractorContractPayment.count({
    where: { milestoneId: id, deletedAt: null },
  });
  if (linked > 0) throw new Error("MILESTONE_HAS_PAYMENTS");

  await prisma.$transaction(async (tx) => {
    await tx.contractMilestone.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await logContract(
      tx,
      user,
      "contract.milestone_deleted",
      "contractor_contract",
      existing.contractId,
      `Deleted unused milestone "${existing.title}"`,
      { milestoneId: id },
    );
  });

  return toMilestones(await loadAgreement(user, existing.contractId));
}
