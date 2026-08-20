"use server";

/**
 * Governed re-scope of unused advance money.
 *
 * Writes a PAIR of ledger rows in one transaction — OUT at the source scope,
 * IN at the target — so the contractor's total advance balance cannot move and
 * no cash is involved. Nothing historical is touched: the original advance row,
 * every drawdown taken from it, and every settlement it funded are all left
 * exactly as they are. Only what the money may fund NEXT changes.
 *
 * Refusals come back as `{ blockers }` rather than thrown codes, matching the
 * convention used by duplicate contractors, blocked removals and attribution
 * correction: Next masks Server Action error messages in production, so a
 * deterministic domain decision has to travel as data to survive.
 */

import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import {
  buildRescopePreview,
  isTransferSource,
  rescopeBlockers,
  scopeKind,
  type AdvanceScope,
  type RescopePreview,
  type RescopeSourceDto,
} from "../advance-rescope";
import { scopedAdvanceBlockedReason } from "@/features/contracts/agreement-actions";
import { advanceBalancePaise, outstandingPerAdvance, type ScopedLedgerEntry } from "../calc";
import type { ContractorLedgerType } from "../types";

export interface RescopeApplied {
  transferId: string;
  amountPaise: number;
  fromLabel: string;
  toLabel: string;
}
export interface RescopeBlocked {
  blockers: string[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/* ── Shared reads ───────────────────────────────────────────────────────── */

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function ledgerFor(
  db: Tx | typeof prisma,
  companyId: string,
  contractorId: string,
): Promise<(ScopedLedgerEntry & { createdAt: Date })[]> {
  const rows = await db.contractorLedgerEntry.findMany({
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
    type: r.type as ContractorLedgerType,
    amountPaise: Number(r.amountPaise),
    projectId: r.projectId,
    contractId: r.contractId,
    drawsFromEntryId: r.drawsFromEntryId,
    reversesEntryId: r.reversesEntryId,
    date: iso(r.date),
    createdAt: r.createdAt,
  }));
}

/** Availability at one scope, summed across every advance that carries it. */
function availableAtScope(entries: ScopedLedgerEntry[], scope: AdvanceScope): number {
  return outstandingPerAdvance(entries)
    .filter(
      (a) =>
        (a.projectId ?? null) === (scope.projectId ?? null) &&
        (a.contractId ?? null) === (scope.contractId ?? null),
    )
    .reduce((t, a) => t + a.remainingPaise, 0);
}

/** How much of a source advance has been drawn by settlements vs moved away. */
function sourceBreakdown(entries: ScopedLedgerEntry[], advanceId: string) {
  let consumedPaise = 0;
  let transferredOutPaise = 0;
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const e of entries) {
    if (e.type === "ADJUSTMENT" && e.drawsFromEntryId === advanceId) consumedPaise += e.amountPaise;
    if (e.type === "SETTLEMENT_REVERSAL" && e.reversesEntryId) {
      if (byId.get(e.reversesEntryId)?.drawsFromEntryId === advanceId) {
        consumedPaise -= e.amountPaise;
      }
    }
    if (e.type === "SCOPE_TRANSFER_OUT" && e.drawsFromEntryId === advanceId) {
      transferredOutPaise += e.amountPaise;
    }
  }
  return { consumedPaise, transferredOutPaise };
}

/** Human label for a scope, using the names the ledger already shows. */
async function scopeLabel(
  db: Tx | typeof prisma,
  companyId: string,
  scope: AdvanceScope,
): Promise<string> {
  if (scope.contractId) {
    const c = await db.contractorContract.findFirst({
      where: { id: scope.contractId, companyId },
      select: { title: true, project: { select: { name: true } } },
    });
    return c ? `${c.project.name} · ${c.title}` : "an agreement";
  }
  if (scope.projectId) {
    const p = await db.project.findFirst({
      where: { id: scope.projectId, companyId },
      select: { name: true },
    });
    return p?.name ?? "a project";
  }
  return "General contractor";
}

/**
 * Target validation. Deliberately reuses `scopedAdvanceBlockedReason` — the
 * same rule Pass 8 applies when an advance is first recorded — so recording and
 * re-scoping can never disagree about which agreements may hold money.
 */
async function targetBlockers(
  db: Tx | typeof prisma,
  user: SessionUser,
  contractorId: string,
  target: AdvanceScope,
): Promise<string[]> {
  if (target.contractId) {
    if (!target.projectId) return ["TARGET_AGREEMENT_INVALID"];
    const c = await db.contractorContract.findFirst({
      where: {
        id: target.contractId,
        companyId: user.company.id,
        contractorId,
        projectId: target.projectId,
        deletedAt: null,
      },
      select: { status: true },
    });
    if (!c) return ["TARGET_AGREEMENT_INVALID"];
    const blocked = scopedAdvanceBlockedReason(c.status);
    return blocked ? [blocked === "AGREEMENT_CANCELLED" ? "TARGET_AGREEMENT_CANCELLED" : "TARGET_AGREEMENT_SETTLED"] : [];
  }
  if (target.projectId) {
    const p = await db.project.findFirst({
      where: { id: target.projectId, companyId: user.company.id, deletedAt: null },
      select: { id: true },
    });
    if (!p) return ["TARGET_PROJECT_INVALID"];
  }
  return [];
}

/* ── Preview ────────────────────────────────────────────────────────────── */

export async function previewAdvanceRescope(input: {
  contractorId: string;
  advanceId: string;
  target: AdvanceScope;
  transferPaise: number;
}): Promise<RescopePreview | RescopeBlocked> {
  const user = await requirePermission("contractors.advance_rescope");

  const entries = await ledgerFor(prisma, user.company.id, input.contractorId);
  const source = entries.find((e) => e.id === input.advanceId);
  if (!source) return { blockers: ["SOURCE_NOT_FOUND"] };
  if (!isTransferSource(source.type, source.reversesEntryId ?? null)) {
    return { blockers: ["SOURCE_NOT_TRANSFERABLE"] };
  }

  const remaining =
    outstandingPerAdvance(entries).find((a) => a.entryId === input.advanceId)?.remainingPaise ?? 0;
  const { consumedPaise, transferredOutPaise } = sourceBreakdown(entries, input.advanceId);
  const scope: AdvanceScope = { projectId: source.projectId, contractId: source.contractId };

  const sourceDto: RescopeSourceDto = {
    advanceId: source.id,
    type: source.type,
    date: source.date,
    scope,
    scopeLabel: await scopeLabel(prisma, user.company.id, scope),
    originalPaise: source.amountPaise,
    consumedPaise,
    transferredOutPaise,
    remainingPaise: remaining,
  };

  return buildRescopePreview({
    source: sourceDto,
    target: {
      scope: input.target,
      label: await scopeLabel(prisma, user.company.id, input.target),
    },
    transferPaise: input.transferPaise,
    targetAvailableBeforePaise: availableAtScope(entries, input.target),
    contractorBalancePaise: advanceBalancePaise(entries),
    extraBlockers: await targetBlockers(prisma, user, input.contractorId, input.target),
  });
}

/* ── Apply ──────────────────────────────────────────────────────────────── */

export async function rescopeAdvance(input: {
  contractorId: string;
  advanceId: string;
  target: AdvanceScope;
  transferPaise: number;
  reason: string;
}): Promise<RescopeApplied | RescopeBlocked> {
  const user = await requirePermission("contractors.advance_rescope");
  const reason = input.reason.trim();
  if (!reason) return { blockers: ["REASON_REQUIRED"] };

  const contractor = await prisma.contractor.findFirst({
    where: { id: input.contractorId, companyId: user.company.id },
    select: { id: true, name: true },
  });
  if (!contractor) return { blockers: ["SOURCE_NOT_FOUND"] };

  return prisma.$transaction(async (tx) => {
    // THE POOL LOCK. `remaining` depends on rows other than the source, so the
    // whole contractor ledger is locked and every figure re-derived from the
    // locked state. The preview is advisory; this decides.
    await lockPool(tx, user.company.id, input.contractorId);

    const entries = await ledgerFor(tx, user.company.id, input.contractorId);
    const source = entries.find((e) => e.id === input.advanceId);
    if (!source) return { blockers: ["SOURCE_NOT_FOUND"] };
    if (!isTransferSource(source.type, source.reversesEntryId ?? null)) {
      return { blockers: ["SOURCE_NOT_TRANSFERABLE"] };
    }

    const remaining =
      outstandingPerAdvance(entries).find((a) => a.entryId === input.advanceId)?.remainingPaise ?? 0;
    const from: AdvanceScope = { projectId: source.projectId, contractId: source.contractId };

    const blockers = [
      ...rescopeBlockers({
        remainingPaise: remaining,
        transferPaise: input.transferPaise,
        from,
        to: input.target,
      }),
      ...(await targetBlockers(tx, user, input.contractorId, input.target)),
    ];
    if (blockers.length > 0) return { blockers };

    const balanceBefore = advanceBalancePaise(entries);
    const fromLabel = await scopeLabel(tx, user.company.id, from);
    const toLabel = await scopeLabel(tx, user.company.id, input.target);

    // OUT: drains the source. Never carries a settlementId or fundsContractId —
    // it pays no labour and funds no bucket.
    const out = await tx.contractorLedgerEntry.create({
      data: {
        companyId: user.company.id,
        contractorId: input.contractorId,
        date: new Date(),
        type: "SCOPE_TRANSFER_OUT",
        amountPaise: BigInt(input.transferPaise),
        advanceBalanceAfterPaise: BigInt(balanceBefore - input.transferPaise),
        projectId: from.projectId,
        contractId: from.contractId,
        drawsFromEntryId: source.id,
        notes: `Re-scoped to ${toLabel}`,
        createdById: user.id,
      },
      select: { id: true },
    });

    // IN: the same money, now available at the target scope. `drawsFromEntryId`
    // points at the OUT, which is the entire lineage — this IN came from that
    // transfer, which came from that advance.
    const inEntry = await tx.contractorLedgerEntry.create({
      data: {
        companyId: user.company.id,
        contractorId: input.contractorId,
        date: new Date(),
        type: "SCOPE_TRANSFER_IN",
        amountPaise: BigInt(input.transferPaise),
        // Equal and opposite: the balance is exactly where it started.
        advanceBalanceAfterPaise: BigInt(balanceBefore),
        projectId: input.target.projectId,
        contractId: input.target.contractId,
        drawsFromEntryId: out.id,
        notes: `Re-scoped from ${fromLabel}`,
        createdById: user.id,
      },
      select: { id: true },
    });

    await tx.activityLog.create({
      data: {
        companyId: user.company.id,
        actorId: user.id,
        action: "contractor.advance_rescoped",
        entityType: "contractor",
        entityId: input.contractorId,
        summary: `Re-scoped advance funds from ${fromLabel} to ${toLabel}`,
        meta: {
          contractorId: input.contractorId,
          sourceAdvanceId: source.id,
          transferOutEntryId: out.id,
          transferInEntryId: inEntry.id,
          sourceScope: { ...from, kind: scopeKind(from), label: fromLabel },
          targetScope: { ...input.target, kind: scopeKind(input.target), label: toLabel },
          amountPaise: input.transferPaise,
          sourceRemainingBeforePaise: remaining,
          sourceRemainingAfterPaise: remaining - input.transferPaise,
          contractorBalancePaise: balanceBefore,
          reason,
        },
      },
    });

    return {
      transferId: out.id,
      amountPaise: input.transferPaise,
      fromLabel,
      toLabel,
    };
  });
}

/* ── Reverse ────────────────────────────────────────────────────────────── */

export async function reverseAdvanceRescope(input: {
  transferId: string;
  reason: string;
}): Promise<RescopeApplied | RescopeBlocked> {
  const user = await requirePermission("contractors.advance_rescope");
  const reason = input.reason.trim();
  if (!reason) return { blockers: ["REASON_REQUIRED"] };

  const outRow = await prisma.contractorLedgerEntry.findFirst({
    where: { id: input.transferId, companyId: user.company.id, type: "SCOPE_TRANSFER_OUT" },
    select: { id: true, contractorId: true, projectId: true, contractId: true, amountPaise: true },
  });
  if (!outRow) return { blockers: ["TRANSFER_NOT_FOUND"] };

  return prisma.$transaction(async (tx) => {
    await lockPool(tx, user.company.id, outRow.contractorId);

    const entries = await ledgerFor(tx, user.company.id, outRow.contractorId);
    const inRow = entries.find(
      (e) => e.type === "SCOPE_TRANSFER_IN" && e.drawsFromEntryId === outRow.id,
    );
    if (!inRow) return { blockers: ["TRANSFER_NOT_FOUND"] };

    // Already undone? The reversal drains the IN, so an existing OUT against it
    // is the record of that.
    const alreadyReversed = entries.some(
      (e) => e.type === "SCOPE_TRANSFER_OUT" && e.drawsFromEntryId === inRow.id,
    );
    if (alreadyReversed) return { blockers: ["TRANSFER_ALREADY_REVERSED"] };

    // v1 refuses a partial unwind. If a later settlement spent part of the money
    // this transfer moved, "reversing" would have to invent which part came
    // back — better to say so and let the user record a fresh re-scope for
    // whatever is genuinely still available.
    const remainingIn =
      outstandingPerAdvance(entries).find((a) => a.entryId === inRow.id)?.remainingPaise ?? 0;
    if (remainingIn !== inRow.amountPaise) return { blockers: ["TRANSFER_ALREADY_CONSUMED"] };

    const amount = inRow.amountPaise;
    const balanceBefore = advanceBalancePaise(entries);
    const backTo: AdvanceScope = { projectId: outRow.projectId, contractId: outRow.contractId };
    const fromLabel = await scopeLabel(tx, user.company.id, {
      projectId: inRow.projectId,
      contractId: inRow.contractId,
    });
    const toLabel = await scopeLabel(tx, user.company.id, backTo);

    // A compensating PAIR, not a deletion. The original transfer rows stay.
    const back = await tx.contractorLedgerEntry.create({
      data: {
        companyId: user.company.id,
        contractorId: outRow.contractorId,
        date: new Date(),
        type: "SCOPE_TRANSFER_OUT",
        amountPaise: BigInt(amount),
        advanceBalanceAfterPaise: BigInt(balanceBefore - amount),
        projectId: inRow.projectId,
        contractId: inRow.contractId,
        drawsFromEntryId: inRow.id,
        notes: `Re-scope reversed — returned to ${toLabel}`,
        createdById: user.id,
      },
      select: { id: true },
    });
    await tx.contractorLedgerEntry.create({
      data: {
        companyId: user.company.id,
        contractorId: outRow.contractorId,
        date: new Date(),
        type: "SCOPE_TRANSFER_IN",
        amountPaise: BigInt(amount),
        advanceBalanceAfterPaise: BigInt(balanceBefore),
        projectId: backTo.projectId,
        contractId: backTo.contractId,
        drawsFromEntryId: back.id,
        notes: `Re-scope reversed — returned from ${fromLabel}`,
        createdById: user.id,
      },
    });

    await tx.activityLog.create({
      data: {
        companyId: user.company.id,
        actorId: user.id,
        action: "contractor.advance_rescope_reversed",
        entityType: "contractor",
        entityId: outRow.contractorId,
        summary: `Reversed a re-scope — ${fromLabel} back to ${toLabel}`,
        meta: {
          originalTransferId: outRow.id,
          contractorId: outRow.contractorId,
          amountPaise: amount,
          fromLabel,
          toLabel,
          reason,
        },
      },
    });

    return { transferId: back.id, amountPaise: amount, fromLabel, toLabel };
  });
}

/**
 * The advance-pool lock, local to this module's transactions.
 *
 * Same rows and same intent as the settlement path's lock; see the note there
 * for the lock ORDER rule (attendance before ledger). A re-scope takes only this
 * one, so it can never be the transaction that closes a deadlock cycle.
 */
async function lockPool(tx: Tx, companyId: string, contractorId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM contractor_ledger_entries
    WHERE company_id = ${companyId}::uuid
      AND contractor_id = ${contractorId}::uuid
    FOR UPDATE`;
}
