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
  ContractStatus,
  CreateMilestoneInput,
  Milestone,
  MilestoneStatus,
  UpdateMilestoneInput,
} from "../types";
import { loadAgreement, logContract, toMilestones, toSnapshot } from "./internal";
import { reconcileAgreement } from "../reconcile";

/**
 * LIFECYCLE GUARD — a milestone change must respect the agreement's own state.
 *
 * Neither `loadAgreement` nor the milestone actions previously looked at the
 * agreement's status, so earned value could be recognised on an agreement that
 * had been cancelled, and a close-out signed off as SETTLED could be silently
 * contradicted by reopening a milestone underneath it.
 *
 * CANCELLED is void: nothing about it should move again.
 * SETTLED is a close-out that was only permitted while earned === credited ===
 * authorised, so any change to earned value or planned coverage would make the
 * label a lie. Cosmetic edits (a title, a note, ordering) stay allowed.
 *
 * Mirrors the precedent already set by `recordContractPayment`, which refuses a
 * payment against a cancelled agreement for the same reason.
 */
function assertMilestoneChangeAllowed(
  agreementStatus: ContractStatus,
  opts: { affectsEarnedValue: boolean },
) {
  if (agreementStatus === "CANCELLED") throw new Error("AGREEMENT_CANCELLED");
  if (agreementStatus === "SETTLED" && opts.affectsEarnedValue) {
    throw new Error("AGREEMENT_SETTLED");
  }
}

export async function listMilestones(contractId: string): Promise<Milestone[]> {
  const user = await requirePermission("contracts.view");
  return toMilestones(await loadAgreement(user, contractId));
}

export async function createMilestone(input: CreateMilestoneInput): Promise<Milestone[]> {
  const user = await requirePermission("contracts.edit");
  const data = createMilestoneSchema.parse(input);
  const contract = await loadAgreement(user, data.contractId);
  assertMilestoneChangeAllowed(contract.status, { affectsEarnedValue: true });

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
  assertMilestoneChangeAllowed(contract.status, { affectsEarnedValue: true });
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
  assertMilestoneChangeAllowed(contract.status, {
    affectsEarnedValue: data.valuePaise !== undefined,
  });

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
    // Raising a COMPLETED milestone's value recognises more earned work, so it
    // is held behind the same agreement lock as completing one.
    if (data.valuePaise !== undefined) {
      await tx.$queryRaw`
        SELECT id FROM contractor_contracts
        WHERE id = ${existing.contractId}::uuid
          AND company_id = ${user.company.id}::uuid
        FOR UPDATE`;
    }
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
  const contract = await loadAgreement(user, contractId);
  // Ordering is presentation, not value — allowed on a settled agreement.
  assertMilestoneChangeAllowed(contract.status, { affectsEarnedValue: false });

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
  const agreement = await loadAgreement(user, existing.contractId);
  assertMilestoneChangeAllowed(agreement.status, { affectsEarnedValue: true });

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
    // CONCURRENCY. Lock the AGREEMENT row before reading any milestone, so two
    // completions on the same agreement serialize.
    //
    // Without it the ceiling is checkable but not enforceable: under READ
    // COMMITTED two transactions completing DIFFERENT milestones each read the
    // other's pre-commit state, both see the same `alreadyCompleted`, both pass
    // the ceiling, and both commit — recognising more earned value than the
    // agreement authorises. They never touch the same row, so nothing else made
    // them wait. Same pattern as createSettlement's FOR UPDATE on attendance.
    await tx.$queryRaw`
      SELECT id FROM contractor_contracts
      WHERE id = ${existing.contractId}::uuid
        AND company_id = ${user.company.id}::uuid
      FOR UPDATE`;

    // Re-read the milestone now that we hold the lock. A duplicate submission
    // that lost the race finds its work already done and returns quietly rather
    // than writing a second identical status change and a second audit entry.
    const current = await tx.contractMilestone.findFirstOrThrow({
      where: { id },
      select: { status: true, valuePaise: true },
    });
    // Already in the target state: the winner did this work. Nothing to write.
    if (current.status === data.status) return;

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
        thisMilestoneValuePaise: Number(current.valuePaise),
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
        valuePaise: Number(current.valuePaise),
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
  const agreement = await loadAgreement(user, existing.contractId);
  assertMilestoneChangeAllowed(agreement.status, { affectsEarnedValue: true });

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
