"use server";

/**
 * Contractor agreements — lifecycle and payments.
 *
 * Two ceilings are enforced here and nowhere else can bypass them:
 *
 *   Cumulative EARNED value  ≤ authorised contract value  (see ./milestones.ts)
 *   Cumulative CREDITED value ≤ authorised contract value  (recordPayment below)
 *
 * Raising either requires a proposed-and-approved amendment. There is no
 * override flag and no permission that skips the check, because the amendment
 * workflow is precisely how an increase gets a reason, an effective date and an
 * approver. Paying AHEAD of earned work stays legitimate — only the authorised
 * value binds.
 */

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma";
import { requirePermission } from "@/lib/auth/permissions";
import { reconcileAgreement, validateCreditCeiling } from "../reconcile";
import { canSettleAgreement, canTransitionAgreement } from "../milestones";
import {
  cancelContractSchema,
  createContractSchema,
  recordContractPaymentSchema,
  reverseContractPaymentSchema,
  setContractStatusSchema,
  updateContractSchema,
} from "../schema";
import type {
  AgreementDetail,
  Contract,
  ContractFilters,
  ContractStatus,
  CreateContractInput,
  RecordContractPaymentInput,
  UpdateContractInput,
} from "../types";
import {
  agreementInclude,
  assertContractorAccess,
  assertProjectAccess,
  loadAgreement,
  logContract,
  projectScope,
  toAmendments,
  toContract,
  toMilestones,
  toPayments,
  toSnapshot,
} from "./internal";
import { reconciliationTimeline } from "../reconcile";

/* ── Reads ──────────────────────────────────────────────────────────────── */

export async function listContracts(filters: ContractFilters = {}): Promise<Contract[]> {
  const user = await requirePermission("contracts.view");
  const rows = await prisma.contractorContract.findMany({
    where: {
      companyId: user.company.id,
      deletedAt: null,
      ...projectScope(user),
      ...(filters.contractorId ? { contractorId: filters.contractorId } : {}),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: agreementInclude,
  });
  return rows.map(toContract);
}

export async function getContract(id: string): Promise<AgreementDetail | null> {
  const user = await requirePermission("contracts.view");
  const row = await prisma.contractorContract.findFirst({
    where: { id, companyId: user.company.id, deletedAt: null, ...projectScope(user) },
    include: agreementInclude,
  });
  if (!row) return null;

  const scopeItems = await prisma.contractScopeItem.findMany({
    where: { contractId: id, companyId: user.company.id, deletedAt: null },
    include: {
      subcategory: {
        select: { name: true, categoryId: true, category: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    contract: toContract(row),
    scopeItems: scopeItems.map((s) => ({
      id: s.id,
      contractId: s.contractId,
      labourSubcategoryId: s.labourSubcategoryId,
      subcategoryName: s.subcategory.name,
      categoryId: s.subcategory.categoryId,
      categoryName: s.subcategory.category.name,
      currentRatePaise: s.currentRatePaise,
      rateUnit: s.rateUnit,
      notes: s.notes,
      createdAt: s.createdAt.toISOString(),
    })),
    milestones: toMilestones(row),
    payments: toPayments(row),
    amendments: toAmendments(row),
    timeline: reconciliationTimeline(toSnapshot(row)),
  };
}

/* ── Agreement lifecycle ────────────────────────────────────────────────── */

export async function createContract(input: CreateContractInput): Promise<Contract> {
  const user = await requirePermission("contracts.create");
  const data = createContractSchema.parse(input);
  await assertProjectAccess(user, data.projectId);
  await assertContractorAccess(user, data.contractorId);

  const created = await prisma.$transaction(async (tx) => {
    // Ensure the contractor↔project link exists. It carries no billing method —
    // the relationship may hold attendance-only labour, several agreements, or
    // both at once, so the method belongs to each agreement, not to the link.
    await tx.projectContractor.upsert({
      where: {
        projectId_contractorId: { projectId: data.projectId, contractorId: data.contractorId },
      },
      update: {},
      create: {
        companyId: user.company.id,
        projectId: data.projectId,
        contractorId: data.contractorId,
      },
    });

    const row = await tx.contractorContract.create({
      data: {
        companyId: user.company.id,
        contractorId: data.contractorId,
        projectId: data.projectId,
        title: data.title,
        reference: data.reference ?? null,
        scope: data.scope ?? null,
        quantity: data.quantity == null ? null : new Prisma.Decimal(data.quantity),
        unit: data.unit ?? null,
        // The agreed value seeds BOTH: original is immutable, current tracks
        // approved amendments from here on.
        originalAmountPaise: BigInt(data.contractAmountPaise),
        currentAmountPaise: BigInt(data.contractAmountPaise),
        startDate: data.startDate ? new Date(data.startDate) : null,
        expectedCompletionDate: data.expectedCompletionDate
          ? new Date(data.expectedCompletionDate)
          : null,
        notes: data.notes ?? null,
        createdById: user.id,
      },
      include: agreementInclude,
    });

    await logContract(
      tx,
      user,
      "contract.created",
      "contractor_contract",
      row.id,
      `Created agreement "${row.title}"`,
      {
        contractorId: data.contractorId,
        projectId: data.projectId,
        originalAmountPaise: data.contractAmountPaise,
      },
    );
    return row;
  });
  return toContract(created);
}

/**
 * Work-detail edits only. An amount sent here is rejected outright: without that
 * refusal there would always be a path that changes the commercial value with no
 * reason, no effective date and no approver.
 */
export async function updateContract(
  id: string,
  patch: UpdateContractInput & { contractAmountPaise?: number },
): Promise<Contract> {
  const user = await requirePermission("contracts.edit");
  if ("contractAmountPaise" in patch && patch.contractAmountPaise !== undefined) {
    throw new Error("USE_AMENDMENT");
  }
  const data = updateContractSchema.parse(patch);
  const existing = await loadAgreement(user, id);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.contractorContract.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.reference !== undefined ? { reference: data.reference } : {}),
        ...(data.scope !== undefined ? { scope: data.scope } : {}),
        ...(data.quantity !== undefined
          ? { quantity: data.quantity == null ? null : new Prisma.Decimal(data.quantity) }
          : {}),
        ...(data.unit !== undefined ? { unit: data.unit } : {}),
        ...(data.startDate !== undefined
          ? { startDate: data.startDate ? new Date(data.startDate) : null }
          : {}),
        ...(data.expectedCompletionDate !== undefined
          ? {
              expectedCompletionDate: data.expectedCompletionDate
                ? new Date(data.expectedCompletionDate)
                : null,
            }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
      include: agreementInclude,
    });
    await logContract(
      tx,
      user,
      "contract.updated",
      "contractor_contract",
      id,
      `Updated agreement "${existing.title}"`,
      { changed: Object.keys(data) },
    );
    return row;
  });
  return toContract(updated);
}

/**
 * Physical lifecycle change. SETTLED is the one status with a financial
 * precondition — nothing may still be due and every live milestone must be
 * complete — so the label can never contradict reconciliation.
 */
export async function setContractStatus(id: string, status: ContractStatus): Promise<Contract> {
  const user = await requirePermission("contracts.complete");
  const { status: next } = setContractStatusSchema.parse({ status });
  const existing = await loadAgreement(user, id);

  if (next === "CANCELLED") {
    // Cancelling is its own authority and needs a reason — use cancelContract.
    throw new Error("USE_CANCEL");
  }
  if (!canTransitionAgreement(existing.status, next)) {
    throw new Error("INVALID_STATUS_TRANSITION");
  }
  if (next === "SETTLED") {
    // Final close-out: the ENTIRE authorised agreement must be earned and
    // exactly reconciled — not merely "nothing due today".
    const snapshot = toSnapshot(existing);
    const blocked = canSettleAgreement({
      reconciliation: reconcileAgreement(snapshot),
      milestones: snapshot.milestones,
    });
    if (blocked) throw new Error(`AGREEMENT_NOT_FULLY_RECONCILED: ${blocked}`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.contractorContract.update({
      where: { id },
      data: {
        status: next,
        completedAt: next === "COMPLETED" ? new Date() : existing.completedAt,
        settledAt: next === "SETTLED" ? new Date() : existing.settledAt,
      },
      include: agreementInclude,
    });
    await logContract(
      tx,
      user,
      "contract.status_changed",
      "contractor_contract",
      id,
      `Agreement "${existing.title}": ${existing.status} → ${next}`,
      { from: existing.status, to: next },
    );
    return row;
  });
  return toContract(updated);
}

/**
 * Cancel an agreement, preserving every payment, milestone and attendance row.
 * Earned value freezes and reconciliation stays readable — this is the path for
 * an agreement with real history, as opposed to `deleteContract`.
 */
export async function cancelContract(id: string, reason: string): Promise<Contract> {
  const user = await requirePermission("contracts.cancel");
  const data = cancelContractSchema.parse({ reason });
  const existing = await loadAgreement(user, id);
  if (existing.status === "CANCELLED") throw new Error("ALREADY_CANCELLED");

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.contractorContract.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: user.id,
        cancelledReason: data.reason,
      },
      include: agreementInclude,
    });
    await logContract(
      tx,
      user,
      "contract.cancelled",
      "contractor_contract",
      id,
      `Cancelled agreement "${existing.title}"`,
      { reason: data.reason, previousStatus: existing.status },
    );
    return row;
  });
  return toContract(updated);
}

/**
 * Soft-delete, reserved for an agreement created by mistake and never used.
 *
 * Any financial history at all blocks it: money moved, work was recognised,
 * labour was attributed, or the value was formally revised. The caller is
 * directed to CANCEL instead, which preserves all of it.
 */
export async function deleteContract(id: string): Promise<void> {
  const user = await requirePermission("contracts.delete");
  const existing = await loadAgreement(user, id);

  const [payments, completedMilestones, attendance, approvedAmendments] = await Promise.all([
    prisma.contractorContractPayment.count({ where: { contractId: id, deletedAt: null } }),
    prisma.contractMilestone.count({
      where: { contractId: id, deletedAt: null, status: "COMPLETED" },
    }),
    prisma.labourAttendance.count({ where: { contractId: id } }),
    prisma.contractAmendment.count({
      where: { contractId: id, deletedAt: null, status: "APPROVED" },
    }),
  ]);

  if (payments > 0 || completedMilestones > 0 || attendance > 0 || approvedAmendments > 0) {
    throw new Error("HAS_FINANCIAL_HISTORY");
  }

  await prisma.$transaction(async (tx) => {
    await tx.contractorContract.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await logContract(
      tx,
      user,
      "contract.deleted",
      "contractor_contract",
      id,
      `Deleted unused agreement "${existing.title}"`,
    );
  });
}

/* ── Payments ───────────────────────────────────────────────────────────── */

export async function recordContractPayment(
  input: RecordContractPaymentInput,
): Promise<AgreementDetail> {
  const user = await requirePermission("contracts.pay");
  const data = recordContractPaymentSchema.parse(input);
  const contract = await loadAgreement(user, data.contractId);

  if (contract.status === "CANCELLED") throw new Error("AGREEMENT_CANCELLED");

  // Idempotency: a repeated submit with the same client key returns the original
  // rather than creating a second payment. Deliberately NOT filtered on
  // deletedAt — a reversed payment's key must still dedupe a replay, or a retry
  // would resurrect money that was explicitly reversed.
  const findByClientUuid = () =>
    data.clientUuid
      ? prisma.contractorContractPayment.findFirst({
          where: {
            clientUuid: data.clientUuid,
            contractId: data.contractId,
            companyId: user.company.id,
          },
          select: { id: true },
        })
      : Promise.resolve(null);

  if (await findByClientUuid()) return (await getContract(data.contractId))!;

  if (data.milestoneId) {
    const m = await prisma.contractMilestone.findFirst({
      where: {
        id: data.milestoneId,
        contractId: data.contractId,
        companyId: user.company.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!m) throw new Error("MILESTONE_NOT_FOUND");
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: the ceiling must be checked against
      // committed state, never against the snapshot the client rendered from.
      const fresh = await tx.contractorContract.findFirstOrThrow({
        where: { id: data.contractId, companyId: user.company.id },
        include: agreementInclude,
      });
      const recon = reconcileAgreement(toSnapshot(fresh));

      const blocked = validateCreditCeiling({
        additionalCreditPaise: data.amountPaise,
        totalCreditedPaise: recon.totalCreditedPaise,
        currentContractValuePaise: recon.currentContractValuePaise,
      });
      if (blocked) throw new Error(`CREDIT_EXCEEDS_CONTRACT_VALUE: ${blocked}`);

      const payment = await tx.contractorContractPayment.create({
        data: {
          companyId: user.company.id,
          contractId: data.contractId,
          // Taken from the agreement, never from the client.
          contractorId: fresh.contractorId,
          projectId: fresh.projectId,
          amountPaise: BigInt(data.amountPaise),
          type: data.type,
          paymentMode: data.paymentMode,
          referenceNumber: data.referenceNumber ?? null,
          date: new Date(data.date),
          notes: data.notes ?? null,
          milestoneId: data.milestoneId ?? null,
          clientUuid: data.clientUuid ?? null,
          createdById: user.id,
        },
      });

      await logContract(
        tx,
        user,
        "contract.payment_recorded",
        "contractor_contract_payment",
        payment.id,
        `Recorded payment against "${fresh.title}"`,
        {
          contractId: data.contractId,
          amountPaise: data.amountPaise,
          type: data.type,
          creditedBeforePaise: recon.totalCreditedPaise,
          currentContractValuePaise: recon.currentContractValuePaise,
        },
      );
    });
  } catch (err) {
    // Lost the race on the partial-unique idempotency index: the other request
    // already recorded this exact payment, so return its result.
    if (
      data.clientUuid &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      if (await findByClientUuid()) return (await getContract(data.contractId))!;
    }
    throw err;
  }

  return (await getContract(data.contractId))!;
}

/**
 * Reverse a payment. Never a physical delete: the row, its reason and its audit
 * entry survive forever, and the money simply stops counting towards every
 * total from this point on.
 */
export async function reverseContractPayment(id: string, reason: string): Promise<void> {
  const user = await requirePermission("contracts.pay_delete");
  const data = reverseContractPaymentSchema.parse({ reason });

  const row = await prisma.contractorContractPayment.findFirst({
    where: { id, companyId: user.company.id, deletedAt: null },
    include: { contract: { select: { title: true, deletedAt: true } }, project: { select: { pmId: true } } },
  });
  if (!row) throw new Error("NOT_FOUND");
  await assertProjectAccess(user, row.projectId);

  await prisma.$transaction(async (tx) => {
    await tx.contractorContractPayment.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: user.id, reversalReason: data.reason },
    });
    await logContract(
      tx,
      user,
      "contract.payment_reversed",
      "contractor_contract_payment",
      id,
      `Reversed payment on "${row.contract.title}"`,
      { amountPaise: Number(row.amountPaise), reason: data.reason, contractId: row.contractId },
    );
  });
}
