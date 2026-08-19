"use server";

import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db/prisma";
import { requirePermission, requireOwner, hasPermission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { rowTotals, sheetTotals, summarize } from "../calc";
import {
  isAgreementAttributionEligible,
  isAttributionEligible,
  resolveAttendanceRate,
} from "./assignment-eligibility";
import { newBusinessBlockedReason } from "@/features/contractors/lifecycle";
import type { ContractorStatus } from "@/features/contractors/types";
import type {
  AttendanceFilters,
  AttendanceRecordItem,
  AttendanceSheet,
  CategoryWithSubs,
  CreateCategoryInput,
  CreateSubcategoryInput,
  ForceDeleteImpact,
  ForceDeleteKind,
  LabourCategory,
  LabourSubcategory,
  LabourSummary,
  SetQuantityInput,
  SheetGroup,
  SheetRow,
  UpdateCategoryInput,
  UpdateSubcategoryInput,
} from "../types";

/** Ownership scope: projects.view_all reaches any project, otherwise the caller
 *  must be the assigned PM. (Behaviour-identical to the old owner-or-assigned
 *  rule.) */
async function assertProjectAccess(user: SessionUser, projectId: string) {
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

/**
 * Whether an attendance period (project + date) is locked. Locking storage/UI is
 * a future feature; this stub returns false today, so behaviour is unchanged.
 * When locking ships, a locked period will require attendance.edit to modify
 * (see setQuantity) — the enforcement path is already wired.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- params document the intended signature for the future lock feature
async function isPeriodLocked(companyId: string, projectId: string, date: string): Promise<boolean> {
  return false;
}

/**
 * Refuse to touch attendance that a settlement has already recognised.
 *
 * A settlement is the canonical financial record of labour money: its bill was
 * computed from these rows, and where the contractor holds an agreement those
 * same rows are its Attendance Credit. Letting the underlying quantity change
 * afterwards would silently move the credited figure away from the settled one.
 *
 * This is narrower and stricter than the (unimplemented) period lock: it applies
 * to individual settled rows, and no permission overrides it. The escape hatch
 * is a governed settlement reversal.
 */
async function assertNotSettled(companyId: string, key: AttendanceKey): Promise<void> {
  const settled = await prisma.labourAttendance.findFirst({
    where: { ...key, companyId, settlementId: { not: null } },
    select: { id: true },
  });
  if (settled) throw new Error("ATTENDANCE_SETTLED");
}

/**
 * Refuse NEW attendance for an ARCHIVED contractor, while leaving a row that
 * already exists correctable.
 *
 * Recording attendance is new operational work — the single largest way a
 * contractor accrues a liability — so it stops at archive along with new
 * agreements, advances and project assignments. Without this, archiving was
 * self-contradicting in the worst possible direction: labour could still be
 * booked against a contractor the company had finished with.
 *
 * The line is drawn at "does a row already exist at this exact five-field
 * identity?", not at the date:
 *
 *   • No row yet → this is NEW work. Refused.
 *   • Row exists → this is a CORRECTION of something recorded while the
 *     contractor was still active. Allowed — freezing it would let a wrong
 *     headcount recorded on the 17th become permanent, and then get settled at
 *     the wrong value. Settled rows are already immutable via assertNotSettled,
 *     which runs first, so only unsettled rows are correctable here.
 *   • Clearing a row (quantity ≤ 0) never reaches this guard: removing a
 *     mistaken entry is a correction too.
 *
 * Drawing it here rather than at an `archivedAt` date is deliberate: `status` is
 * the whole lifecycle model (see contractors/lifecycle.ts), and restoring the
 * contractor is the intended, one-click way to re-enable attendance.
 */
async function assertContractorAcceptsAttendance(
  companyId: string,
  key: AttendanceKey,
): Promise<void> {
  if (key.contractorId == null) return; // unattributed rows have no lifecycle
  const existing = await prisma.labourAttendance.findFirst({
    where: { ...key, companyId },
    select: { id: true },
  });
  if (existing) return;
  const contractor = await prisma.contractor.findFirst({
    where: { id: key.contractorId, companyId },
    select: { name: true, status: true },
  });
  // A missing contractor is the attribution checks' business, not this one's.
  if (!contractor) return;
  const blocked = newBusinessBlockedReason(
    contractor.status as ContractorStatus,
    "RECORD_ATTENDANCE",
    contractor.name,
  );
  if (blocked) throw new Error(`CONTRACTOR_ARCHIVED: ${blocked}`);
}

/**
 * The full identity of one attendance row. FIVE fields, always — a WHERE that
 * omits `contractId` would clear or overwrite a different agreement's row for
 * the same contractor, date and labour type.
 */
type AttendanceKey = {
  projectId: string;
  date: Date;
  labourSubcategoryId: string;
  contractorId: string | null;
  contractId: string | null;
};

const attendanceKey = (
  projectId: string,
  date: string,
  labourSubcategoryId: string,
  contractorId: string | null,
  contractId: string | null,
): AttendanceKey => ({
  projectId,
  date: new Date(date),
  labourSubcategoryId,
  contractorId,
  contractId,
});

const toCategory = (c: { id: string; name: string; color: string | null; displayOrder: number }): LabourCategory => ({
  id: c.id, name: c.name, color: c.color, displayOrder: c.displayOrder,
});
const toSubcategory = (s: { id: string; categoryId: string; name: string; dailyRatePaise: number | null; displayOrder: number }): LabourSubcategory => ({
  id: s.id, categoryId: s.categoryId, name: s.name, dailyRatePaise: s.dailyRatePaise, displayOrder: s.displayOrder,
});

/* ── Hierarchy ───────────────────────────────────────────────────────── */

export async function listCategories(): Promise<CategoryWithSubs[]> {
  const user = await requirePermission("labour.view");
  // Active master data only: force-deleted groups/types are soft-deleted
  // (deletedAt set) and hidden here, but KEPT in the DB so historical attendance
  // still resolves their names.
  const rows = await prisma.labourCategory.findMany({
    where: { companyId: user.company.id, deletedAt: null },
    orderBy: { displayOrder: "asc" },
    include: {
      subcategories: { where: { deletedAt: null }, orderBy: { displayOrder: "asc" } },
    },
  });
  return rows.map((c) => ({ ...toCategory(c), subcategories: c.subcategories.map(toSubcategory) }));
}

export async function createCategory(input: CreateCategoryInput): Promise<LabourCategory> {
  const user = await requirePermission("labour.create");
  const count = await prisma.labourCategory.count({ where: { companyId: user.company.id } });
  const c = await prisma.labourCategory.create({
    data: { companyId: user.company.id, name: input.name, color: input.color ?? null, displayOrder: count },
  });
  return toCategory(c);
}

export async function updateCategory(id: string, patch: UpdateCategoryInput): Promise<LabourCategory> {
  const user = await requirePermission("labour.edit");
  const c = await prisma.labourCategory.update({
    where: { id, companyId: user.company.id },
    data: { name: patch.name, ...(patch.color !== undefined ? { color: patch.color ?? null } : {}) },
  });
  return toCategory(c);
}

export async function deleteCategory(id: string): Promise<void> {
  const user = await requirePermission("labour.archive");
  // Physical deletion cascade-deletes subcategories → attendance AND
  // project_contractor_labour_rates. Both must be preserved: attendance is
  // labour history; labour rates are project config that must only ever change
  // through the audited setProjectContractors path (which logs
  // project.contractors_updated). So a category is deletable ONLY when none of
  // its subcategories has attendance or a configured project-contractor rate.
  //
  // Race safety: run the check + delete in one transaction and lock the parent
  // rows FOR UPDATE. A concurrent rate insert takes FOR KEY SHARE on a
  // subcategory row (blocked by our lock on the subcategories); a concurrent
  // attendance insert likewise. So nothing can slip in between check and delete.
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM labour_categories
      WHERE id = ${id}::uuid AND company_id = ${user.company.id}::uuid
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("NOT_FOUND");
    // Lock existing subcategories so concurrent attendance inserts block.
    await tx.$queryRaw`
      SELECT id FROM labour_subcategories
      WHERE category_id = ${id}::uuid AND company_id = ${user.company.id}::uuid
      FOR UPDATE`;

    const attendance = await tx.labourAttendance.count({
      where: { companyId: user.company.id, subcategory: { categoryId: id } },
    });
    if (attendance > 0) throw new Error("CATEGORY_HAS_ATTENDANCE");
    const labourRates = await tx.projectContractorLabourRate.count({
      where: { companyId: user.company.id, subcategory: { categoryId: id } },
    });
    if (labourRates > 0) throw new Error("CATEGORY_HAS_ASSIGNMENTS");

    await tx.labourCategory.delete({ where: { id, companyId: user.company.id } });
  });
}

export async function reorderCategories(orderedIds: string[]): Promise<void> {
  const user = await requirePermission("labour.edit");
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.labourCategory.update({ where: { id, companyId: user.company.id }, data: { displayOrder: i } }),
    ),
  );
}

export async function createSubcategory(input: CreateSubcategoryInput): Promise<LabourSubcategory> {
  const user = await requirePermission("labour.create");
  // Tenant guard: the parent category must belong to the caller's company and
  // be active (can't add a labour type to a deactivated group).
  const category = await prisma.labourCategory.findFirst({
    where: { id: input.categoryId, companyId: user.company.id, deletedAt: null },
    select: { id: true },
  });
  if (!category) throw new Error("NOT_FOUND");
  const count = await prisma.labourSubcategory.count({
    where: { companyId: user.company.id, categoryId: input.categoryId },
  });
  const s = await prisma.labourSubcategory.create({
    data: {
      companyId: user.company.id,
      categoryId: input.categoryId,
      name: input.name,
      dailyRatePaise: input.dailyRatePaise ?? null,
      displayOrder: count,
    },
  });
  return toSubcategory(s);
}

export async function updateSubcategory(id: string, patch: UpdateSubcategoryInput): Promise<LabourSubcategory> {
  const user = await requirePermission("labour.edit");
  const s = await prisma.labourSubcategory.update({
    where: { id, companyId: user.company.id },
    data: {
      name: patch.name,
      ...(patch.dailyRatePaise !== undefined ? { dailyRatePaise: patch.dailyRatePaise ?? null } : {}),
      ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
    },
  });
  return toSubcategory(s);
}

export async function deleteSubcategory(id: string): Promise<void> {
  const user = await requirePermission("labour.archive");
  // History + config guard (same rationale as deleteCategory): a subcategory
  // with recorded attendance cannot be deleted (that cascade-deletes attendance
  // history); nor can one with a configured project-contractor rate (config that
  // must change via setProjectContractors). Race-safe via a FOR UPDATE lock on
  // the subcategory row (concurrent attendance/rate inserts block).
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM labour_subcategories
      WHERE id = ${id}::uuid AND company_id = ${user.company.id}::uuid
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("NOT_FOUND");
    const attendance = await tx.labourAttendance.count({
      where: { companyId: user.company.id, labourSubcategoryId: id },
    });
    if (attendance > 0) throw new Error("SUBCATEGORY_HAS_ATTENDANCE");
    const labourRates = await tx.projectContractorLabourRate.count({
      where: { companyId: user.company.id, labourSubcategoryId: id },
    });
    if (labourRates > 0) throw new Error("SUBCATEGORY_HAS_ASSIGNMENTS");
    await tx.labourSubcategory.delete({ where: { id, companyId: user.company.id } });
  });
}

/* ── Owner Force Delete ──────────────────────────────────────────────────
 * The Owner's ultimate-authority path: remove a referenced labour group/type
 * from master data WITHOUT destroying attendance or financial history. The
 * master row is SOFT-deleted (deletedAt set) — hidden everywhere but kept so
 * historical attendance still resolves its name (rate + cost were already
 * snapshotted). Only pure-config rows (ProjectContractorLabourRate,
 * ProjectContractorAssignment) are truly deleted; attendance keeps its rate
 * snapshot (its provenance FK is ON DELETE SET NULL). Owner-only + typed-DELETE
 * confirmation, and every run writes an ActivityLog audit entry.
 */

/** Compute the removed-vs-preserved impact for a Force Delete (read helper,
 *  usable with the request `prisma` client or a transaction `tx`). */
async function computeImpact(
  db: Prisma.TransactionClient,
  companyId: string,
  kind: ForceDeleteKind,
  id: string,
  name: string,
): Promise<ForceDeleteImpact> {
  // The set of labour-type ids in scope (the single type, or all under a group).
  const subIds =
    kind === "subcategory"
      ? [id]
      : (
          await db.labourSubcategory.findMany({
            where: { companyId, categoryId: id, deletedAt: null },
            select: { id: true },
          })
        ).map((s) => s.id);

  const [projectContractorRates, projectContractorAssignments, attendancePreserved] =
    await Promise.all([
      subIds.length
        ? db.projectContractorLabourRate.count({
            where: { companyId, labourSubcategoryId: { in: subIds } },
          })
        : Promise.resolve(0),
      kind === "category"
        ? db.projectContractorAssignment.count({ where: { companyId, labourCategoryId: id } })
        : Promise.resolve(0),
      subIds.length
        ? db.labourAttendance.count({ where: { companyId, labourSubcategoryId: { in: subIds } } })
        : Promise.resolve(0),
    ]);

  // Projects whose current config is being removed (rates + category assignments).
  const [rateProjects, assignmentProjects] = await Promise.all([
    subIds.length
      ? db.projectContractorLabourRate.findMany({
          where: { companyId, labourSubcategoryId: { in: subIds } },
          select: { projectContractor: { select: { projectId: true } } },
        })
      : Promise.resolve([] as { projectContractor: { projectId: string } }[]),
    kind === "category"
      ? db.projectContractorAssignment.findMany({
          where: { companyId, labourCategoryId: id },
          select: { projectId: true },
        })
      : Promise.resolve([] as { projectId: string }[]),
  ]);
  const affectedProjectIds = new Set<string>([
    ...rateProjects.map((r) => r.projectContractor.projectId),
    ...assignmentProjects.map((a) => a.projectId),
  ]);

  // Settlements on projects where this labour was actually recorded (all
  // preserved — settlements never reference the taxonomy). Honest reassurance.
  const attendanceProjects = subIds.length
    ? await db.labourAttendance.findMany({
        where: { companyId, labourSubcategoryId: { in: subIds } },
        select: { projectId: true },
        distinct: ["projectId"],
      })
    : [];
  const settlementsPreserved = attendanceProjects.length
    ? await db.contractorSettlement.count({
        where: { companyId, projectId: { in: attendanceProjects.map((p) => p.projectId) } },
      })
    : 0;

  return {
    kind,
    id,
    name,
    labourGroups: kind === "category" ? 1 : 0,
    labourTypes: subIds.length,
    projectContractorRates,
    projectContractorAssignments,
    attendancePreserved,
    settlementsPreserved,
    projectsAffected: affectedProjectIds.size,
  };
}

/** Owner-only impact preview shown before a Force Delete is confirmed. */
export async function forceDeletePreview(
  kind: ForceDeleteKind,
  id: string,
): Promise<ForceDeleteImpact> {
  const user = await requireOwner();
  const where = { id, companyId: user.company.id, deletedAt: null };
  const row =
    kind === "category"
      ? await prisma.labourCategory.findFirst({ where, select: { name: true } })
      : await prisma.labourSubcategory.findFirst({ where, select: { name: true } });
  if (!row) throw new Error("NOT_FOUND");
  return prisma.$transaction((tx) => computeImpact(tx, user.company.id, kind, id, row.name));
}

export async function forceDeleteCategory(id: string, ack: string): Promise<void> {
  const user = await requireOwner();
  if (ack !== "DELETE") throw new Error("CONFIRMATION_REQUIRED");
  await prisma.$transaction(async (tx) => {
    // Lock the group + its types so concurrent attendance/rate inserts block.
    const locked = await tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name FROM labour_categories
      WHERE id = ${id}::uuid AND company_id = ${user.company.id}::uuid AND deleted_at IS NULL
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("NOT_FOUND");
    const name = locked[0].name;
    await tx.$queryRaw`
      SELECT id FROM labour_subcategories
      WHERE category_id = ${id}::uuid AND company_id = ${user.company.id}::uuid
      FOR UPDATE`;

    const impact = await computeImpact(tx, user.company.id, "category", id, name);
    const subs = await tx.labourSubcategory.findMany({
      where: { companyId: user.company.id, categoryId: id },
      select: { id: true },
    });
    const allSubIds = subs.map((s) => s.id);

    // Hard-delete pure config (attendance.projectContractorLabourRateId → SET NULL).
    if (allSubIds.length) {
      await tx.projectContractorLabourRate.deleteMany({
        where: { companyId: user.company.id, labourSubcategoryId: { in: allSubIds } },
      });
    }
    await tx.projectContractorAssignment.deleteMany({
      where: { companyId: user.company.id, labourCategoryId: id },
    });

    // Soft-delete master: the group + all its (active) types. History survives.
    const now = new Date();
    await tx.labourSubcategory.updateMany({
      where: { companyId: user.company.id, categoryId: id, deletedAt: null },
      data: { deletedAt: now, deletedById: user.id },
    });
    await tx.labourCategory.update({
      where: { id, companyId: user.company.id },
      data: { deletedAt: now, deletedById: user.id },
    });

    await tx.activityLog.create({
      data: {
        companyId: user.company.id,
        actorId: user.id,
        action: "labour_category.force_deleted",
        entityType: "labour_category",
        entityId: id,
        summary: `force-deleted labour group "${name}"`,
        meta: { ...impact, affectedSubcategoryIds: allSubIds } as Prisma.InputJsonValue,
      },
    });
  });
}

export async function forceDeleteSubcategory(id: string, ack: string): Promise<void> {
  const user = await requireOwner();
  if (ack !== "DELETE") throw new Error("CONFIRMATION_REQUIRED");
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name FROM labour_subcategories
      WHERE id = ${id}::uuid AND company_id = ${user.company.id}::uuid AND deleted_at IS NULL
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("NOT_FOUND");
    const name = locked[0].name;

    const impact = await computeImpact(tx, user.company.id, "subcategory", id, name);

    // Hard-delete this type's rate config; attendance keeps its snapshot.
    await tx.projectContractorLabourRate.deleteMany({
      where: { companyId: user.company.id, labourSubcategoryId: id },
    });
    await tx.labourSubcategory.update({
      where: { id, companyId: user.company.id },
      data: { deletedAt: new Date(), deletedById: user.id },
    });

    await tx.activityLog.create({
      data: {
        companyId: user.company.id,
        actorId: user.id,
        action: "labour_subcategory.force_deleted",
        entityType: "labour_subcategory",
        entityId: id,
        summary: `force-deleted labour type "${name}"`,
        meta: impact as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

export async function reorderSubcategories(categoryId: string, orderedIds: string[]): Promise<void> {
  const user = await requirePermission("labour.edit");
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.labourSubcategory.update({
        where: { id, companyId: user.company.id, categoryId },
        data: { displayOrder: i },
      }),
    ),
  );
}

/* ── Attendance ──────────────────────────────────────────────────────── */

/**
 * The daily sheet: Project → Contractor → Agreement → Labour Type → Rate.
 *
 * A contractor with agreements gets one section per agreement, offering exactly
 * the labour types that agreement's scope covers at the rate in force ON THIS
 * DATE. A contractor with none keeps the pre-existing attendance-only path,
 * driven by their project labour rates — unchanged, and still the whole story
 * for every company that never adopts agreements.
 */
async function buildSheet(companyId: string, projectId: string, date: string): Promise<AttendanceSheet> {
  const on = new Date(date);
  const [projectContractors, agreements, todays] = await Promise.all([
    prisma.projectContractor.findMany({
      where: { companyId, projectId },
      include: {
        contractor: { select: { name: true, status: true } },
        labourRates: {
          include: {
            subcategory: {
              select: { name: true, categoryId: true, displayOrder: true, category: { select: { name: true } } },
            },
          },
          orderBy: { subcategory: { displayOrder: "asc" } },
        },
      },
      orderBy: { contractor: { name: "asc" } },
    }),
    // Every open agreement on this project, with its scope and the rate history
    // needed to resolve each item as at `date`. One read, not one per row.
    prisma.contractorContract.findMany({
      where: {
        companyId,
        projectId,
        deletedAt: null,
        status: { in: ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"] },
        scopeItems: { some: { deletedAt: null } },
      },
      select: {
        id: true,
        contractorId: true,
        title: true,
        reference: true,
        status: true,
        scopeItems: {
          where: { deletedAt: null },
          select: {
            labourSubcategoryId: true,
            subcategory: {
              select: { name: true, categoryId: true, displayOrder: true, category: { select: { name: true } } },
            },
            revisions: {
              where: { effectiveFrom: { lte: on } },
              select: { ratePaise: true },
              orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
              take: 1,
            },
          },
          orderBy: { subcategory: { displayOrder: "asc" } },
        },
      },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.labourAttendance.findMany({
      where: { companyId, projectId, date: on },
      include: {
        subcategory: { select: { name: true, categoryId: true, category: { select: { name: true } } } },
        contractor: { select: { name: true } },
        contract: { select: { title: true } },
      },
    }),
  ]);

  // Recorded rows, indexed on the FULL identity — contractor, labour type AND
  // agreement. Keying on any subset would show one agreement's headcount under
  // another's row.
  const attKey = (contractorId: string | null, subId: string, contractId: string | null) =>
    `${contractorId ?? ""}|${subId}|${contractId ?? ""}`;
  const byKey = new Map(
    todays.map((a) => [attKey(a.contractorId, a.labourSubcategoryId, a.contractId), a]),
  );
  const consumed = new Set<string>();

  const agreementsByContractor = new Map<string, typeof agreements>();
  for (const a of agreements) {
    const list = agreementsByContractor.get(a.contractorId) ?? [];
    list.push(a);
    agreementsByContractor.set(a.contractorId, list);
  }

  const groups: SheetGroup[] = projectContractors.map((pc) => {
    const mine = agreementsByContractor.get(pc.contractorId) ?? [];
    const rows: SheetRow[] = [];
    // An archived contractor is offered NO blank rows: the server would refuse
    // the write, so showing an inviting empty box is a trap. Rows that already
    // hold a record still appear — history must not vanish because a contractor
    // was archived, and an unsettled row may still need correcting.
    const archived = pc.contractor.status === "INACTIVE";

    for (const ag of mine) {
      for (const item of ag.scopeItems) {
        const k = attKey(pc.contractorId, item.labourSubcategoryId, ag.id);
        const rec = byKey.get(k);
        if (rec) consumed.add(k);
        if (!rec && archived) continue;
        rows.push({
          subcategoryId: item.labourSubcategoryId,
          name: item.subcategory.name,
          categoryId: item.subcategory.categoryId,
          categoryName: item.subcategory.category.name,
          contractId: ag.id,
          agreementTitle: ag.title,
          // Already recorded → its own snapshot, immutable. Not yet → the
          // agreement rate in force on THIS date, not today's.
          dailyRatePaise: rec ? rec.dailyRatePaiseSnapshot : (item.revisions[0]?.ratePaise ?? null),
          quantity: rec?.quantityPresent ?? 0,
          notes: rec?.notes ?? null,
        });
      }
    }

    // The attendance-only path. Offered as blank rows only when this contractor
    // has NO agreements — once they do, that labour has a commercial home and a
    // parallel unattributed row would just be a way to record it twice.
    // Existing unattributed rows still surface below, so history stays editable.
    if (mine.length === 0) {
      for (const lr of pc.labourRates) {
        const k = attKey(pc.contractorId, lr.labourSubcategoryId, null);
        const rec = byKey.get(k);
        if (rec) consumed.add(k);
        if (!rec && archived) continue;
        rows.push({
          subcategoryId: lr.labourSubcategoryId,
          name: lr.subcategory.name,
          categoryId: lr.subcategory.categoryId,
          categoryName: lr.subcategory.category.name,
          contractId: null,
          agreementTitle: null,
          dailyRatePaise: rec ? rec.dailyRatePaiseSnapshot : lr.ratePaise,
          quantity: rec?.quantityPresent ?? 0,
          notes: rec?.notes ?? null,
        });
      }
    }

    return {
      contractorId: pc.contractorId,
      contractorName: pc.contractor.name,
      contractRatePaise: pc.contractRatePaise,
      contractRateUnit: pc.contractRateUnit,
      configured: true,
      archived,
      agreements: mine.map((a) => ({
        contractId: a.id,
        title: a.title,
        reference: a.reference,
        status: a.status,
      })),
      // Two or more and the user must say which; the system never picks.
      requiresAgreementChoice: mine.length > 1,
      rows,
      ...rowTotals(rows),
    };
  });

  // Leftover recorded rows not covered above: a contractor/type/agreement
  // de-configured after recording, or legacy unattributed rows (contractorId
  // null). Grouped so history stays visible & clearable, but marked
  // configured:false so they read as "no longer configured".
  const orphans = new Map<string, { contractorId: string | null; name: string; rows: SheetRow[] }>();
  for (const a of todays) {
    const k = attKey(a.contractorId, a.labourSubcategoryId, a.contractId);
    if (consumed.has(k)) continue;
    const gk = a.contractorId ?? "";
    const g = orphans.get(gk) ?? {
      contractorId: a.contractorId,
      name: a.contractor?.name ?? "Unattributed",
      rows: [],
    };
    g.rows.push({
      subcategoryId: a.labourSubcategoryId,
      name: a.subcategory.name,
      categoryId: a.subcategory.categoryId,
      categoryName: a.subcategory.category.name,
      contractId: a.contractId,
      agreementTitle: a.contract?.title ?? null,
      dailyRatePaise: a.dailyRatePaiseSnapshot,
      quantity: a.quantityPresent,
      notes: a.notes,
    });
    orphans.set(gk, g);
  }
  for (const g of orphans.values()) {
    groups.push({
      contractorId: g.contractorId,
      contractorName: g.name,
      contractRatePaise: null,
      contractRateUnit: null,
      configured: false,
      archived: false,
      agreements: [],
      requiresAgreementChoice: false,
      rows: g.rows,
      ...rowTotals(g.rows),
    });
  }

  return { projectId, date, groups, ...sheetTotals(groups) };
}

/**
 * Insert-or-update one attendance row, snapshotting the effective rate on FIRST
 * record and preserving it on edits (ADR-0022). Rate resolves from
 * project+contractor+subcategory, falling back to the subcategory's global rate.
 * Find-then-write handles both the contractor path and the rare null-contractor
 * (legacy/unattributed) path uniformly; the DB unique index is the race backstop.
 */
async function writeAttendanceRow(
  companyId: string,
  key: AttendanceKey,
  date: string,
  quantity: number,
  notes: string | null | undefined,
): Promise<void> {
  // The WHERE is the full five-field identity, so a second agreement's row for
  // the same contractor/date/labour type is a different row, not this one.
  const existing = await prisma.labourAttendance.findFirst({
    where: { ...key, companyId },
    select: {
      id: true,
      dailyRatePaiseSnapshot: true,
      projectContractorLabourRateId: true,
      contractScopeRateRevisionId: true,
    },
  });

  let snapshot: number | null;
  let rateId: string | null;
  let scopeRevisionId: string | null;
  if (existing) {
    // ADR-0022: the snapshot is history. A later rate revision never rewrites it.
    snapshot = existing.dailyRatePaiseSnapshot;
    rateId = existing.projectContractorLabourRateId;
    scopeRevisionId = existing.contractScopeRateRevisionId;
  } else {
    const resolved = await resolveAttendanceRate(
      companyId,
      key.projectId,
      key.contractorId,
      key.labourSubcategoryId,
      key.contractId,
      date,
    );
    snapshot = resolved.ratePaise;
    rateId = resolved.projectContractorLabourRateId;
    scopeRevisionId = resolved.contractScopeRateRevisionId;
  }
  // Round: half-day quantities can produce fractional paise.
  const estimatedCostPaise = Math.round((snapshot ?? 0) * quantity);

  if (existing) {
    await prisma.labourAttendance.update({
      where: { id: existing.id },
      data: { quantityPresent: quantity, estimatedCostPaise, ...(notes !== undefined ? { notes } : {}) },
    });
  } else {
    await prisma.labourAttendance.create({
      data: {
        companyId,
        projectId: key.projectId,
        date: key.date,
        labourSubcategoryId: key.labourSubcategoryId,
        contractorId: key.contractorId,
        contractId: key.contractId,
        quantityPresent: quantity,
        dailyRatePaiseSnapshot: snapshot,
        projectContractorLabourRateId: rateId,
        contractScopeRateRevisionId: scopeRevisionId,
        estimatedCostPaise,
        notes: notes ?? null,
        clientUuid: crypto.randomUUID(),
        clientSeq: BigInt(Date.now()),
      },
    });
  }
}

export async function getSheet(projectId: string, date: string): Promise<AttendanceSheet> {
  const user = await requirePermission("attendance.view");
  await assertProjectAccess(user, projectId);
  return buildSheet(user.company.id, projectId, date);
}

export async function setQuantity(input: SetQuantityInput): Promise<AttendanceSheet> {
  const { projectId, date, subcategoryId, quantity, notes } = input;
  const user = await requirePermission("attendance.mark");
  await assertProjectAccess(user, projectId);
  // Locked periods can only be modified with the elevated attendance.edit
  // permission. (isPeriodLocked is a stub today — see its note.)
  if (await isPeriodLocked(user.company.id, projectId, date)) {
    await requirePermission("attendance.edit");
  }
  const cid = input.contractorId ?? null;
  // An agreement without a contractor is meaningless — an agreement IS a
  // contractor's work package — so a stray contractId on an unattributed row is
  // dropped rather than stored as an orphan attribution.
  const agreementId = cid != null ? (input.contractId ?? null) : null;
  const key = attendanceKey(projectId, date, subcategoryId, cid, agreementId);

  // Settled labour is financially IMMUTABLE. Once a settlement has recognised a
  // row, that money has been billed and (where the contractor holds an
  // agreement) credited against it. Editing the row afterwards would leave the
  // settlement saying ₹6,00,000 while reconciliation said something else, which
  // is exactly the drift the settlement-owns-attendance rule exists to prevent.
  //
  // Unconditional — no permission bypasses it. Corrections go through a
  // settlement reversal, not a quiet edit. Re-attribution is refused for the
  // same reason: moving a settled row to another agreement would move recognised
  // credit away from the settlement that recognised it.
  await assertNotSettled(user.company.id, key);
  if (agreementId != null) await assertNotSettledElsewhere(user.company.id, key);
  // An archived contractor takes on no NEW attendance. Runs after the settled
  // guards (a settled row is immutable whatever the lifecycle says) and only for
  // a write, since clearing a row is a correction.
  if (quantity > 0) await assertContractorAcceptsAttendance(user.company.id, key);

  if (quantity <= 0) {
    // Deleting a row: attribution is moot, so no eligibility check (avoids
    // rejecting a legitimate clear). Keyed on the FULL identity so clearing one
    // agreement's row never touches another agreement's — or another
    // contractor's — row for the same date and labour type.
    await prisma.labourAttendance.deleteMany({ where: { ...key, companyId: user.company.id } });
  } else if (agreementId != null) {
    // Agreement-linked: the agreement must belong to this contractor on this
    // project AND its scope must cover this labour type. Resolved server-side,
    // never trusted from the client.
    if (
      !(await isAgreementAttributionEligible(
        user.company.id,
        projectId,
        cid!,
        agreementId,
        subcategoryId,
      ))
    ) {
      throw new Error("AGREEMENT_SCOPE_MISMATCH");
    }
    await writeAttendanceRow(user.company.id, key, date, quantity, notes);
  } else {
    // Eligibility (subcategory-exact): a contractor may only be attributed to a
    // project for a SUBCATEGORY THEY SUPPLY (a ProjectContractorLabourRate
    // exists) — resolved server-side, never trusted from the client. Null
    // (legacy/unattributed) is always allowed. The UI only offers a project's
    // configured contractors + their labour types — this is the server backstop.
    if (
      cid != null &&
      !(await isAttributionEligible(user.company.id, projectId, cid, subcategoryId))
    ) {
      throw new Error("CONTRACTOR_NOT_ASSIGNED");
    }
    await writeAttendanceRow(user.company.id, key, date, quantity, notes);
  }
  return buildSheet(user.company.id, projectId, date);
}

/**
 * Refuse to move labour ONTO an agreement when the same contractor's labour for
 * that date and type is already settled under a different agreement (or under
 * none).
 *
 * Without this, "re-attribute" reads as a create: a new row appears under the
 * new agreement while the settled one stays put, and the same day's work is
 * counted twice. Re-attribution of settled labour is a governed operation, not
 * an attendance edit.
 */
async function assertNotSettledElsewhere(companyId: string, key: AttendanceKey): Promise<void> {
  const settled = await prisma.labourAttendance.findFirst({
    where: {
      companyId,
      projectId: key.projectId,
      date: key.date,
      labourSubcategoryId: key.labourSubcategoryId,
      contractorId: key.contractorId,
      contractId: { not: key.contractId },
      settlementId: { not: null },
    },
    select: { id: true },
  });
  if (settled) throw new Error("ATTENDANCE_SETTLED");
}

export async function copyPreviousDay(projectId: string, date: string): Promise<AttendanceSheet> {
  const user = await requirePermission("attendance.mark");
  await assertProjectAccess(user, projectId);
  if (await isPeriodLocked(user.company.id, projectId, date)) {
    await requirePermission("attendance.edit");
  }
  const prev = await prisma.labourAttendance.findFirst({
    where: { companyId: user.company.id, projectId, date: { lt: new Date(date) } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (prev) {
    const source = await prisma.labourAttendance.findMany({
      where: { companyId: user.company.id, projectId, date: prev.date },
    });
    // Yesterday may include a contractor archived since. Their rows are SKIPPED,
    // not copied and not allowed to abort the run: setQuantity would throw on
    // the first one and leave the day half-copied, punishing every other
    // contractor for one archived crew. The sheet then shows them with no rows
    // and the "no new attendance" note, which explains the absence.
    const sourceIds = [
      ...new Set(source.map((r) => r.contractorId).filter((id): id is string => id != null)),
    ];
    const archivedIds = new Set(
      sourceIds.length === 0
        ? []
        : (
            await prisma.contractor.findMany({
              where: { companyId: user.company.id, id: { in: sourceIds } },
              select: { id: true, status: true },
            })
          )
            .filter((c) => c.status === "INACTIVE")
            .map((c) => c.id),
    );
    for (const rec of source) {
      if (rec.contractorId != null && archivedIds.has(rec.contractorId)) continue;
      // Preserve the FULL attribution so each contractor's — and each
      // agreement's — rows copy forward independently (Pappu/Structure and
      // Pappu/Compound Wall stay split, as do two contractors on one type).
      // The copy is a NEW recording, so it re-resolves the rate as at `date`.
      await setQuantity({
        projectId,
        date,
        subcategoryId: rec.labourSubcategoryId,
        quantity: rec.quantityPresent,
        notes: rec.notes,
        contractorId: rec.contractorId,
        contractId: rec.contractId,
      });
    }
  }
  return buildSheet(user.company.id, projectId, date);
}

async function fetchItems(user: SessionUser, filters: AttendanceFilters): Promise<AttendanceRecordItem[]> {
  const rows = await prisma.labourAttendance.findMany({
    where: {
      companyId: user.company.id,
      // Scope: without attendance.view_all, limited to the caller's projects.
      ...(hasPermission(user, "attendance.view_all") ? {} : { project: { pmId: user.id } }),
      ...(filters.projectId && filters.projectId !== "ALL" ? { projectId: filters.projectId } : {}),
      ...(filters.from || filters.to
        ? { date: { ...(filters.from ? { gte: new Date(filters.from) } : {}), ...(filters.to ? { lte: new Date(filters.to) } : {}) } }
        : {}),
    },
    include: {
      subcategory: { include: { category: { select: { id: true, name: true, color: true } } } },
      project: { select: { name: true } },
      contractor: { select: { name: true } },
      contract: { select: { title: true } },
    },
    orderBy: { date: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectName: r.project.name,
    date: r.date.toISOString().slice(0, 10),
    categoryId: r.subcategory.category.id,
    categoryName: r.subcategory.category.name,
    color: r.subcategory.category.color,
    subcategoryId: r.labourSubcategoryId,
    subcategoryName: r.subcategory.name,
    contractorId: r.contractorId,
    contractorName: r.contractor?.name ?? null,
    contractId: r.contractId,
    agreementTitle: r.contract?.title ?? null,
    quantityPresent: r.quantityPresent,
    dailyRatePaiseSnapshot: r.dailyRatePaiseSnapshot,
    estimatedCostPaise: r.estimatedCostPaise,
    notes: r.notes,
  }));
}

export async function listAttendance(filters: AttendanceFilters): Promise<AttendanceRecordItem[]> {
  const user = await requirePermission("attendance.view");
  return fetchItems(user, filters);
}

export async function summary(filters: AttendanceFilters): Promise<LabourSummary> {
  const user = await requirePermission("attendance.view");
  return summarize(await fetchItems(user, filters));
}
