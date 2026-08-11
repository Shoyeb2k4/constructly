"use server";

import { prisma } from "@/lib/db/prisma";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { rowTotals, sheetTotals, summarize } from "../calc";
import { isAttributionEligible } from "./assignment-eligibility";
import type {
  AttendanceFilters,
  AttendanceRecordItem,
  AttendanceSheet,
  CategoryWithSubs,
  CreateCategoryInput,
  CreateSubcategoryInput,
  LabourCategory,
  LabourSubcategory,
  LabourSummary,
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

const toCategory = (c: { id: string; name: string; color: string | null; displayOrder: number }): LabourCategory => ({
  id: c.id, name: c.name, color: c.color, displayOrder: c.displayOrder,
});
const toSubcategory = (s: { id: string; categoryId: string; name: string; dailyRatePaise: number | null; displayOrder: number }): LabourSubcategory => ({
  id: s.id, categoryId: s.categoryId, name: s.name, dailyRatePaise: s.dailyRatePaise, displayOrder: s.displayOrder,
});

/* ── Hierarchy ───────────────────────────────────────────────────────── */

export async function listCategories(): Promise<CategoryWithSubs[]> {
  const user = await requirePermission("labour.view");
  const rows = await prisma.labourCategory.findMany({
    where: { companyId: user.company.id },
    orderBy: { displayOrder: "asc" },
    include: { subcategories: { orderBy: { displayOrder: "asc" } } },
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
  // project_contractor_assignments. Both must be preserved: attendance is
  // labour history; assignments are config that must only ever change through
  // the audited setContractorAssignments path (which logs
  // project.contractors_updated). So a category is deletable ONLY when it has
  // neither attendance nor assignments.
  //
  // Race safety: run the check + delete in one transaction and lock the parent
  // rows FOR UPDATE. A concurrent assignment insert takes FOR KEY SHARE on the
  // category row (blocked by our lock on it); a concurrent attendance insert
  // takes FOR KEY SHARE on a subcategory row (blocked by our lock on the
  // subcategories). So nothing can slip in between the check and the delete.
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
    const assignments = await tx.projectContractorAssignment.count({
      where: { companyId: user.company.id, labourCategoryId: id },
    });
    if (assignments > 0) throw new Error("CATEGORY_HAS_ASSIGNMENTS");

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
  // Tenant guard: the parent category must belong to the caller's company.
  const category = await prisma.labourCategory.findFirst({
    where: { id: input.categoryId, companyId: user.company.id },
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
  // History guard (same rationale as deleteCategory): a subcategory with
  // recorded attendance cannot be physically deleted (that cascade-deletes its
  // attendance history). Assignments reference the CATEGORY, not the
  // subcategory, so there's no assignment guard here. Race-safe via a FOR UPDATE
  // lock on the subcategory row (concurrent attendance inserts block).
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
    await tx.labourSubcategory.delete({ where: { id, companyId: user.company.id } });
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

async function buildSheet(companyId: string, projectId: string, date: string): Promise<AttendanceSheet> {
  const [categories, todays] = await Promise.all([
    prisma.labourCategory.findMany({
      where: { companyId },
      orderBy: { displayOrder: "asc" },
      include: { subcategories: { orderBy: { displayOrder: "asc" } } },
    }),
    prisma.labourAttendance.findMany({ where: { companyId, projectId, date: new Date(date) } }),
  ]);
  const groups = categories.map((c) => {
    const rows = c.subcategories.map((s) => {
      const rec = todays.find((a) => a.labourSubcategoryId === s.id);
      return {
        subcategoryId: s.id,
        name: s.name,
        dailyRatePaise: rec ? rec.dailyRatePaiseSnapshot : s.dailyRatePaise,
        quantity: rec?.quantityPresent ?? 0,
        notes: rec?.notes ?? null,
        contractorId: rec?.contractorId ?? null,
      };
    });
    return { categoryId: c.id, name: c.name, color: c.color, rows, ...rowTotals(rows) };
  });
  const contractorId = todays.find((a) => a.contractorId)?.contractorId ?? null;
  return { projectId, date, groups, contractorId, ...sheetTotals(groups) };
}

export async function getSheet(projectId: string, date: string): Promise<AttendanceSheet> {
  const user = await requirePermission("attendance.view");
  await assertProjectAccess(user, projectId);
  return buildSheet(user.company.id, projectId, date);
}

export async function setQuantity(
  projectId: string,
  date: string,
  subcategoryId: string,
  quantity: number,
  notes?: string | null,
  contractorId?: string | null,
): Promise<AttendanceSheet> {
  const user = await requirePermission("attendance.mark");
  await assertProjectAccess(user, projectId);
  // Locked periods can only be modified with the elevated attendance.edit
  // permission. (isPeriodLocked is a stub today — see its note.)
  if (await isPeriodLocked(user.company.id, projectId, date)) {
    await requirePermission("attendance.edit");
  }
  const key = { projectId, date: new Date(date), labourSubcategoryId: subcategoryId };
  if (quantity <= 0) {
    // Deleting a row: attribution is moot, so no eligibility check (avoids
    // rejecting a legitimate clear that happens to carry a contractorId).
    await prisma.labourAttendance.deleteMany({ where: { ...key, companyId: user.company.id } });
  } else {
    // Eligibility (exact): a contractor may only be attributed to a project for
    // the SUBCATEGORY'S CATEGORY — resolved server-side, never trusted from the
    // client (blocks Civil-only "Pappu" being written against "Tiles"). Null is
    // always allowed; historical rows are never revalidated (read paths don't
    // call this). The UI only offers a category's assigned contractors — this is
    // the server backstop against a stale/manipulated client.
    if (
      contractorId != null &&
      !(await isAttributionEligible(user.company.id, projectId, contractorId, subcategoryId))
    ) {
      throw new Error("CONTRACTOR_NOT_ASSIGNED");
    }
    // Snapshot the rate on FIRST recording; edits keep it (ADR-0022).
    const existing = await prisma.labourAttendance.findUnique({
      where: { projectId_date_labourSubcategoryId: key },
      select: { dailyRatePaiseSnapshot: true },
    });
    const snapshot = existing
      ? existing.dailyRatePaiseSnapshot
      : (
          await prisma.labourSubcategory.findFirstOrThrow({
            where: { id: subcategoryId, companyId: user.company.id },
            select: { dailyRatePaise: true },
          })
        ).dailyRatePaise;
    // Round: half-day quantities can produce fractional paise.
    const estimatedCostPaise = Math.round((snapshot ?? 0) * quantity);
    await prisma.labourAttendance.upsert({
      where: { projectId_date_labourSubcategoryId: key },
      create: {
        companyId: user.company.id,
        ...key,
        quantityPresent: quantity,
        dailyRatePaiseSnapshot: snapshot,
        estimatedCostPaise,
        notes: notes ?? null,
        contractorId: contractorId ?? null,
        clientUuid: crypto.randomUUID(),
        clientSeq: BigInt(Date.now()),
      },
      update: {
        quantityPresent: quantity,
        estimatedCostPaise,
        ...(notes !== undefined ? { notes } : {}),
        ...(contractorId !== undefined ? { contractorId } : {}),
      },
    });
  }
  return buildSheet(user.company.id, projectId, date);
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
    for (const rec of source) {
      await setQuantity(projectId, date, rec.labourSubcategoryId, rec.quantityPresent, rec.notes);
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
