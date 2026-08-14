"use server";

/**
 * Contract amendments — the ONLY path that changes an agreement's authorised
 * value.
 *
 * Maker–checker by design: proposing needs `contracts.edit`, approving needs
 * `contracts.amend_approve`. A user who can edit an agreement must not be able
 * to unilaterally raise what the contractor is entitled to, because raising the
 * authorised value is also the only way past the earned-value and credit
 * ceilings.
 *
 * The original value is never touched. `currentAmountPaise` moves only inside
 * `approveAmendment`'s transaction, so the stored figure and the derived
 * original + Σ approved deltas can be reconciled at any time.
 */

import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/permissions";
import { proposeAmendmentSchema, rejectAmendmentSchema } from "../schema";
import type { Amendment, ProposeAmendmentInput } from "../types";
import { loadAgreement, logContract, projectScope, toAmendments, toSnapshot } from "./internal";
import { reconcileAgreement } from "../reconcile";
import { formatPaiseSmart } from "@/lib/money";

export async function listAmendments(contractId: string): Promise<Amendment[]> {
  const user = await requirePermission("contracts.view");
  return toAmendments(await loadAgreement(user, contractId));
}

/**
 * Propose a revised value. Snapshots the authorised value it was proposed
 * against, so approval can detect that another amendment landed first.
 *
 * Two guards stop an amendment retroactively invalidating what has already
 * happened: the revised value may not drop below what is already credited, nor
 * below the earned value already recognised.
 */
export async function proposeAmendment(input: ProposeAmendmentInput): Promise<Amendment[]> {
  const user = await requirePermission("contracts.edit");
  const data = proposeAmendmentSchema.parse(input);
  const contract = await loadAgreement(user, data.contractId);
  if (contract.status === "CANCELLED") throw new Error("AGREEMENT_CANCELLED");

  const recon = reconcileAgreement(toSnapshot(contract));

  if (data.revisedAmountPaise < recon.totalCreditedPaise) {
    throw new Error(
      `REVISION_BELOW_CREDITED: The revised value can't be below the ` +
        `${formatPaiseSmart(recon.totalCreditedPaise)} already credited against this agreement.`,
    );
  }
  if (data.revisedAmountPaise < recon.earnedValuePaise) {
    throw new Error(
      `REVISION_BELOW_EARNED: The revised value can't be below the ` +
        `${formatPaiseSmart(recon.earnedValuePaise)} of work already recognised as earned.`,
    );
  }

  const previous = Number(contract.currentAmountPaise);
  if (data.revisedAmountPaise === previous) throw new Error("NO_VALUE_CHANGE");

  await prisma.$transaction(async (tx) => {
    const sequence = await tx.contractAmendment.count({
      where: { contractId: data.contractId, deletedAt: null },
    });
    const row = await tx.contractAmendment.create({
      data: {
        companyId: user.company.id,
        projectId: contract.projectId,
        contractId: data.contractId,
        sequence,
        type: data.type,
        previousAmountPaise: BigInt(previous),
        revisedAmountPaise: BigInt(data.revisedAmountPaise),
        deltaPaise: BigInt(data.revisedAmountPaise - previous),
        reason: data.reason,
        effectiveDate: new Date(data.effectiveDate),
        requestedById: user.id,
      },
    });
    await logContract(
      tx,
      user,
      "contract.amendment_created",
      "contractor_contract",
      data.contractId,
      `Proposed amendment on "${contract.title}": ` +
        `${formatPaiseSmart(previous)} → ${formatPaiseSmart(data.revisedAmountPaise)}`,
      {
        amendmentId: row.id,
        previousAmountPaise: previous,
        revisedAmountPaise: data.revisedAmountPaise,
        deltaPaise: data.revisedAmountPaise - previous,
        reason: data.reason,
      },
    );
  });

  return toAmendments(await loadAgreement(user, data.contractId));
}

/**
 * Approve an amendment and apply its delta.
 *
 * Optimistic concurrency: the authorised value is re-read inside the transaction
 * and compared against the snapshot the amendment was proposed against. If
 * another amendment was approved in between, this one is stale — applying it
 * would silently compound two deltas onto a base neither approver saw.
 */
export async function approveAmendment(id: string): Promise<Amendment[]> {
  const user = await requirePermission("contracts.amend_approve");

  const existing = await prisma.contractAmendment.findFirst({
    where: { id, companyId: user.company.id, deletedAt: null, ...projectScope(user) },
    select: {
      id: true,
      contractId: true,
      status: true,
      previousAmountPaise: true,
      revisedAmountPaise: true,
      deltaPaise: true,
    },
  });
  if (!existing) throw new Error("NOT_FOUND");
  if (existing.status !== "PROPOSED") throw new Error("AMENDMENT_NOT_PROPOSED");
  const contract = await loadAgreement(user, existing.contractId);

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.contractorContract.findFirstOrThrow({
      where: { id: existing.contractId, companyId: user.company.id },
      select: { currentAmountPaise: true, title: true },
    });
    if (Number(fresh.currentAmountPaise) !== Number(existing.previousAmountPaise)) {
      throw new Error("AMENDMENT_STALE");
    }

    await tx.contractAmendment.update({
      where: { id },
      data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
    });
    await tx.contractorContract.update({
      where: { id: existing.contractId },
      data: { currentAmountPaise: existing.revisedAmountPaise },
    });

    await logContract(
      tx,
      user,
      "contract.amendment_approved",
      "contractor_contract",
      existing.contractId,
      `Approved amendment on "${fresh.title}": ` +
        `${formatPaiseSmart(Number(existing.previousAmountPaise))} → ` +
        `${formatPaiseSmart(Number(existing.revisedAmountPaise))}`,
      {
        amendmentId: id,
        previousAmountPaise: Number(existing.previousAmountPaise),
        revisedAmountPaise: Number(existing.revisedAmountPaise),
        deltaPaise: Number(existing.deltaPaise),
      },
    );
  });

  return toAmendments(await loadAgreement(user, contract.id));
}

export async function rejectAmendment(id: string, reason: string): Promise<Amendment[]> {
  const user = await requirePermission("contracts.amend_approve");
  const data = rejectAmendmentSchema.parse({ reason });

  const existing = await prisma.contractAmendment.findFirst({
    where: { id, companyId: user.company.id, deletedAt: null, ...projectScope(user) },
    select: { id: true, contractId: true, status: true },
  });
  if (!existing) throw new Error("NOT_FOUND");
  if (existing.status !== "PROPOSED") throw new Error("AMENDMENT_NOT_PROPOSED");
  const contract = await loadAgreement(user, existing.contractId);

  await prisma.$transaction(async (tx) => {
    await tx.contractAmendment.update({
      where: { id },
      data: { status: "REJECTED", rejectedReason: data.reason, approvedById: user.id, approvedAt: new Date() },
    });
    await logContract(
      tx,
      user,
      "contract.amendment_rejected",
      "contractor_contract",
      existing.contractId,
      `Rejected amendment on "${contract.title}"`,
      { amendmentId: id, reason: data.reason },
    );
  });

  return toAmendments(await loadAgreement(user, existing.contractId));
}
