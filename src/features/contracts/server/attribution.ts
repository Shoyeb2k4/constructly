"use server";

/**
 * Governed correction of settled attendance attribution.
 *
 * Settled labour carrying no agreement is assigned to one, and can be assigned
 * back. Exactly one column moves — `labour_attendance.contract_id` — plus an
 * audit entry. The settlement, its frozen breakdown, every ledger entry, the
 * cash and the rate snapshots are all left alone, because none of them are
 * wrong: the money went where it went, and only the LABEL was missing.
 *
 * Refusals come back as `{ blockers }` rather than thrown codes, following the
 * convention already used for duplicate contractors and blocked project-
 * contractor removals: Next masks Server Action error messages in production, so
 * a deterministic domain decision has to travel as data to survive.
 */

import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import {
  attributionTargetBlockedReason,
  buildAttributionPreview,
  findCollisions,
  rowBlockedReason,
  type AttributionPreview,
  type AttributionRow,
} from "../attribution";
import { agreementInclude, assertProjectAccess, iso, toSnapshot } from "./internal";
import type { AttributionApplied, AttributionBlocked } from "../types";

/* ── Shared loading ─────────────────────────────────────────────────────── */

/** The target agreement, proved to belong to this contractor on this project. */
async function loadTarget(user: SessionUser, contractId: string, contractorId: string) {
  const row = await prisma.contractorContract.findFirst({
    where: { id: contractId, companyId: user.company.id, contractorId, deletedAt: null },
    include: agreementInclude,
  });
  return row;
}

/**
 * The rows the caller named, hydrated with everything eligibility needs —
 * including whether each row's settlement has been reversed, which is the one
 * fact the attendance row itself cannot answer.
 */
async function loadRows(
  user: SessionUser,
  ids: string[],
  contractorId: string,
  projectId: string,
): Promise<AttributionRow[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.labourAttendance.findMany({
    where: { id: { in: ids }, companyId: user.company.id, contractorId, projectId },
    select: {
      id: true,
      date: true,
      labourSubcategoryId: true,
      quantityPresent: true,
      dailyRatePaiseSnapshot: true,
      estimatedCostPaise: true,
      contractId: true,
      settlementId: true,
      subcategory: { select: { name: true } },
      settlement: { select: { reversedAt: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    date: iso(r.date),
    labourSubcategoryId: r.labourSubcategoryId,
    labourTypeName: r.subcategory.name,
    quantityPresent: r.quantityPresent,
    dailyRatePaiseSnapshot: r.dailyRatePaiseSnapshot,
    estimatedCostPaise: r.estimatedCostPaise,
    contractId: r.contractId,
    settlementId: r.settlementId,
    settlementReversed: r.settlement?.reversedAt != null,
  }));
}

/** Attendance the TARGET already holds — the collision surface. */
async function targetIdentities(user: SessionUser, contractId: string) {
  const rows = await prisma.labourAttendance.findMany({
    where: { companyId: user.company.id, contractId },
    select: { date: true, labourSubcategoryId: true },
  });
  return rows.map((r) => ({ date: iso(r.date), labourSubcategoryId: r.labourSubcategoryId }));
}

/** Settled-unattributed total on this project, for the before/after figure. */
async function unattributedOnProject(user: SessionUser, contractorId: string, projectId: string) {
  const rows = await prisma.labourAttendance.findMany({
    where: {
      companyId: user.company.id,
      contractorId,
      projectId,
      contractId: null,
      settlementId: { not: null },
    },
    select: { estimatedCostPaise: true },
  });
  return rows.reduce((t, r) => t + r.estimatedCostPaise, 0);
}

/* ── The settled + unattributed rows a user can choose from ─────────────── */

export interface UnattributedRowDto {
  id: string;
  date: string;
  labourTypeName: string;
  quantityPresent: number;
  dailyRatePaiseSnapshot: number | null;
  estimatedCostPaise: number;
  settlementId: string;
  settlementPeriod: string;
}

export async function listAttributableLabour(
  contractorId: string,
  projectId: string,
): Promise<UnattributedRowDto[]> {
  const user = await requirePermission("contracts.view");
  await assertProjectAccess(user, projectId);

  const rows = await prisma.labourAttendance.findMany({
    where: {
      companyId: user.company.id,
      contractorId,
      projectId,
      contractId: null,
      settlementId: { not: null },
      // A reversed settlement's rows are freed back to unsettled, so this is
      // belt-and-braces — but it keeps the list honest if one is ever left over.
      settlement: { reversedAt: null },
    },
    select: {
      id: true,
      date: true,
      quantityPresent: true,
      dailyRatePaiseSnapshot: true,
      estimatedCostPaise: true,
      settlementId: true,
      subcategory: { select: { name: true } },
      settlement: { select: { periodStart: true, periodEnd: true } },
    },
    orderBy: [{ date: "asc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    date: iso(r.date),
    labourTypeName: r.subcategory.name,
    quantityPresent: r.quantityPresent,
    dailyRatePaiseSnapshot: r.dailyRatePaiseSnapshot,
    estimatedCostPaise: r.estimatedCostPaise,
    settlementId: r.settlementId!,
    settlementPeriod: r.settlement
      ? `${iso(r.settlement.periodStart)} – ${iso(r.settlement.periodEnd)}`
      : "",
  }));
}

/* ── Preview ────────────────────────────────────────────────────────────── */

export async function previewAttribution(input: {
  contractorId: string;
  projectId: string;
  contractId: string;
  attendanceIds: string[];
}): Promise<AttributionPreview | { blockers: string[] }> {
  const user = await requirePermission("contractors.attribute_history");
  await assertProjectAccess(user, input.projectId);

  const target = await loadTarget(user, input.contractId, input.contractorId);
  if (!target || target.projectId !== input.projectId) return { blockers: ["INVALID_TARGET"] };

  const [selected, identities, unattributedBeforePaise] = await Promise.all([
    loadRows(user, input.attendanceIds, input.contractorId, input.projectId),
    targetIdentities(user, input.contractId),
    unattributedOnProject(user, input.contractorId, input.projectId),
  ]);

  // A named row the query did not return belongs to someone else, somewhere
  // else — the WHERE already proved company, contractor and project.
  if (selected.length !== input.attendanceIds.length) return { blockers: ["STALE_SELECTION"] };

  return buildAttributionPreview({
    snapshot: toSnapshot(target),
    target: {
      contractId: target.id,
      title: target.title,
      projectId: target.projectId,
      projectName: target.project.name,
      status: target.status,
    },
    selected,
    unattributedBeforePaise,
    collisions: findCollisions(selected, identities),
  });
}

/* ── Apply ──────────────────────────────────────────────────────────────── */

export async function attributeSettledLabour(input: {
  contractorId: string;
  projectId: string;
  contractId: string;
  attendanceIds: string[];
  reason: string;
}): Promise<AttributionApplied | AttributionBlocked> {
  const user = await requirePermission("contractors.attribute_history");
  const reason = input.reason.trim();
  if (!reason) return { blockers: ["REASON_REQUIRED"] };
  if (input.attendanceIds.length === 0) return { blockers: ["NOTHING_SELECTED"] };
  await assertProjectAccess(user, input.projectId);

  const target = await loadTarget(user, input.contractId, input.contractorId);
  if (!target || target.projectId !== input.projectId) return { blockers: ["INVALID_TARGET"] };

  const creditBeforePaise = toSnapshot(target).attendanceCredits.reduce(
    (t, c) => t + c.amountPaise,
    0,
  );

  return prisma.$transaction(async (tx) => {
    // LOCK the rows before reading their state. Without this two users can both
    // pass the eligibility check and both write, or a concurrent settlement
    // reversal can free rows out from under a correction that already validated
    // them. Same pattern as createSettlement and setMilestoneStatus.
    await tx.$queryRaw`
      SELECT id FROM labour_attendance
      WHERE id = ANY(${input.attendanceIds}::uuid[])
        AND company_id = ${user.company.id}::uuid
      FOR UPDATE`;

    // Everything is re-derived under the lock. The preview is advisory; this is
    // the state that decides.
    const [selected, identities, freshTargetStatus] = await Promise.all([
      loadRowsTx(tx, user, input.attendanceIds, input.contractorId, input.projectId),
      targetIdentitiesTx(tx, user, input.contractId),
      tx.contractorContract.findFirst({
        where: { id: input.contractId, companyId: user.company.id, deletedAt: null },
        select: { status: true },
      }),
    ]);

    if (!freshTargetStatus) return { blockers: ["INVALID_TARGET"] };
    if (selected.length !== input.attendanceIds.length) return { blockers: ["STALE_SELECTION"] };

    const blockers: string[] = [];
    const targetBlocked = attributionTargetBlockedReason(freshTargetStatus.status);
    if (targetBlocked) blockers.push(targetBlocked);
    for (const r of selected) {
      const why = rowBlockedReason(r);
      if (why && !blockers.includes(why)) blockers.push(why);
    }
    const collisions = findCollisions(selected, identities);
    if (collisions.length > 0) blockers.push("IDENTITY_COLLISION");
    // ALL OR NOTHING. A half-applied selection would leave the user unable to
    // tell what happened, and the audit entry would describe work not done.
    if (blockers.length > 0) return { blockers, collisions };

    const totalPaise = selected.reduce((t, r) => t + r.estimatedCostPaise, 0);
    const settlementIds = [...new Set(selected.map((r) => r.settlementId!))];

    await tx.labourAttendance.updateMany({
      where: { id: { in: input.attendanceIds }, companyId: user.company.id },
      // ONE column. Quantity, rate snapshot, cost and settlement id are all
      // untouched — the money is not wrong, only its label was.
      data: { contractId: input.contractId },
    });

    // The audit entry IS the correction record: `attendanceIds` plus
    // `fromContractId` make the change fully reversible from the log alone,
    // which is what makes a dedicated correction table unnecessary.
    const logged = await tx.activityLog.create({
      data: {
        companyId: user.company.id,
        actorId: user.id,
        action: "contractor.attendance_attributed",
        entityType: "contractor",
        entityId: input.contractorId,
        summary:
          `Attributed ${selected.length} settled attendance record` +
          `${selected.length === 1 ? "" : "s"} to "${target.title}"`,
        meta: {
          projectId: input.projectId,
          projectName: target.project.name,
          contractorId: input.contractorId,
          attendanceIds: input.attendanceIds,
          settlementIds,
          fromContractId: null,
          toContractId: input.contractId,
          toContractTitle: target.title,
          rowCount: selected.length,
          totalPaise,
          creditBeforePaise,
          creditAfterPaise: creditBeforePaise + totalPaise,
          reason,
        },
      },
      select: { id: true },
    });

    return {
      correctionId: logged.id,
      rowCount: selected.length,
      totalPaise,
      contractId: input.contractId,
      contractTitle: target.title,
    };
  });
}

/* ── Reverse ────────────────────────────────────────────────────────────── */

export async function reverseAttribution(input: {
  correctionId: string;
  reason: string;
}): Promise<AttributionApplied | AttributionBlocked> {
  const user = await requirePermission("contractors.attribute_history");
  const reason = input.reason.trim();
  if (!reason) return { blockers: ["REASON_REQUIRED"] };

  const original = await prisma.activityLog.findFirst({
    where: {
      id: input.correctionId,
      companyId: user.company.id,
      action: "contractor.attendance_attributed",
    },
    select: { id: true, meta: true, entityId: true },
  });
  if (!original) return { blockers: ["NOT_FOUND"] };

  const meta = (original.meta ?? {}) as {
    attendanceIds?: string[];
    projectId?: string;
    toContractId?: string;
    toContractTitle?: string;
    totalPaise?: number;
  };
  const attendanceIds = meta.attendanceIds ?? [];
  if (!meta.projectId || !meta.toContractId || attendanceIds.length === 0) {
    return { blockers: ["NOT_FOUND"] };
  }
  await assertProjectAccess(user, meta.projectId);

  // Already reversed? The reversal entry cites the correction it undid.
  const priorReversal = await prisma.activityLog.findFirst({
    where: {
      companyId: user.company.id,
      action: "contractor.attendance_attribution_reversed",
      meta: { path: ["correctionId"], equals: input.correctionId },
    },
    select: { id: true },
  });
  if (priorReversal) return { blockers: ["ALREADY_REVERSED"] };

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM labour_attendance
      WHERE id = ANY(${attendanceIds}::uuid[])
        AND company_id = ${user.company.id}::uuid
      FOR UPDATE`;

    const rows = await tx.labourAttendance.findMany({
      where: { id: { in: attendanceIds }, companyId: user.company.id },
      select: {
        id: true,
        contractId: true,
        settlementId: true,
        estimatedCostPaise: true,
        settlement: { select: { reversedAt: true } },
      },
    });

    // Refuse rather than guess. If the world moved on — a row was freed by a
    // settlement reversal, or is no longer on the agreement this correction put
    // it on — restoring only the rows that still match would leave a state
    // nobody asked for and an audit trail that describes something else.
    if (rows.length !== attendanceIds.length) return { blockers: ["STALE_SELECTION"] };
    const stale = rows.some(
      (r) =>
        r.contractId !== meta.toContractId ||
        r.settlementId == null ||
        r.settlement?.reversedAt != null,
    );
    if (stale) return { blockers: ["STALE_SELECTION"] };

    const totalPaise = rows.reduce((t, r) => t + r.estimatedCostPaise, 0);

    await tx.labourAttendance.updateMany({
      where: { id: { in: attendanceIds }, companyId: user.company.id },
      data: { contractId: null },
    });

    const logged = await tx.activityLog.create({
      data: {
        companyId: user.company.id,
        actorId: user.id,
        action: "contractor.attendance_attribution_reversed",
        entityType: "contractor",
        entityId: original.entityId,
        summary:
          `Reversed the attribution of ${rows.length} settled attendance record` +
          `${rows.length === 1 ? "" : "s"} from "${meta.toContractTitle ?? "an agreement"}"`,
        meta: {
          correctionId: input.correctionId,
          projectId: meta.projectId,
          attendanceIds,
          fromContractId: meta.toContractId,
          fromContractTitle: meta.toContractTitle ?? null,
          toContractId: null,
          rowCount: rows.length,
          totalPaise,
          reason,
        },
      },
      select: { id: true },
    });

    return {
      correctionId: logged.id,
      rowCount: rows.length,
      totalPaise,
      contractId: null,
      contractTitle: meta.toContractTitle ?? null,
    };
  });
}

/* ── Transaction-scoped copies of the loaders ───────────────────────────── */
// Identical queries, run on the transaction client so they see the locked rows.

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function loadRowsTx(
  tx: Tx,
  user: SessionUser,
  ids: string[],
  contractorId: string,
  projectId: string,
): Promise<AttributionRow[]> {
  const rows = await tx.labourAttendance.findMany({
    where: { id: { in: ids }, companyId: user.company.id, contractorId, projectId },
    select: {
      id: true,
      date: true,
      labourSubcategoryId: true,
      quantityPresent: true,
      dailyRatePaiseSnapshot: true,
      estimatedCostPaise: true,
      contractId: true,
      settlementId: true,
      subcategory: { select: { name: true } },
      settlement: { select: { reversedAt: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    date: iso(r.date),
    labourSubcategoryId: r.labourSubcategoryId,
    labourTypeName: r.subcategory.name,
    quantityPresent: r.quantityPresent,
    dailyRatePaiseSnapshot: r.dailyRatePaiseSnapshot,
    estimatedCostPaise: r.estimatedCostPaise,
    contractId: r.contractId,
    settlementId: r.settlementId,
    settlementReversed: r.settlement?.reversedAt != null,
  }));
}

async function targetIdentitiesTx(tx: Tx, user: SessionUser, contractId: string) {
  const rows = await tx.labourAttendance.findMany({
    where: { companyId: user.company.id, contractId },
    select: { date: true, labourSubcategoryId: true },
  });
  return rows.map((r) => ({ date: iso(r.date), labourSubcategoryId: r.labourSubcategoryId }));
}
