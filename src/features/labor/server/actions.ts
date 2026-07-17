"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/current-user";
import type { SessionUser } from "@/lib/auth/types";
import { rowTotals, sheetTotals, summarize } from "../calc";
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

async function assertProjectAccess(user: SessionUser, projectId: string) {
  const p = await prisma.project.findFirst({
    where: {
      id: projectId,
      companyId: user.company.id,
      deletedAt: null,
      ...(user.role !== "OWNER" ? { pmId: user.id } : {}),
    },
    select: { id: true },
  });
  if (!p) throw new Error("FORBIDDEN");
}

const toCategory = (c: { id: string; name: string; color: string | null; displayOrder: number }): LabourCategory => ({
  id: c.id, name: c.name, color: c.color, displayOrder: c.displayOrder,
});
const toSubcategory = (s: { id: string; categoryId: string; name: string; dailyRatePaise: number | null; displayOrder: number }): LabourSubcategory => ({
  id: s.id, categoryId: s.categoryId, name: s.name, dailyRatePaise: s.dailyRatePaise, displayOrder: s.displayOrder,
});

/* ── Hierarchy ───────────────────────────────────────────────────────── */

export async function listCategories(): Promise<CategoryWithSubs[]> {
  const user = await requireUser();
  const rows = await prisma.labourCategory.findMany({
    where: { companyId: user.company.id },
    orderBy: { displayOrder: "asc" },
    include: { subcategories: { orderBy: { displayOrder: "asc" } } },
  });
  return rows.map((c) => ({ ...toCategory(c), subcategories: c.subcategories.map(toSubcategory) }));
}

export async function createCategory(input: CreateCategoryInput): Promise<LabourCategory> {
  const user = await requireUser();
  const count = await prisma.labourCategory.count({ where: { companyId: user.company.id } });
  const c = await prisma.labourCategory.create({
    data: { companyId: user.company.id, name: input.name, color: input.color ?? null, displayOrder: count },
  });
  return toCategory(c);
}

export async function updateCategory(id: string, patch: UpdateCategoryInput): Promise<LabourCategory> {
  const user = await requireUser();
  const c = await prisma.labourCategory.update({
    where: { id, companyId: user.company.id },
    data: { name: patch.name, ...(patch.color !== undefined ? { color: patch.color ?? null } : {}) },
  });
  return toCategory(c);
}

export async function deleteCategory(id: string): Promise<void> {
  const user = await requireUser();
  await prisma.labourCategory.delete({ where: { id, companyId: user.company.id } });
}

export async function reorderCategories(orderedIds: string[]): Promise<void> {
  const user = await requireUser();
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.labourCategory.update({ where: { id, companyId: user.company.id }, data: { displayOrder: i } }),
    ),
  );
}

export async function createSubcategory(input: CreateSubcategoryInput): Promise<LabourSubcategory> {
  const user = await requireUser();
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
  const user = await requireUser();
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
  const user = await requireUser();
  await prisma.labourSubcategory.delete({ where: { id, companyId: user.company.id } });
}

export async function reorderSubcategories(categoryId: string, orderedIds: string[]): Promise<void> {
  const user = await requireUser();
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
      };
    });
    return { categoryId: c.id, name: c.name, color: c.color, rows, ...rowTotals(rows) };
  });
  return { projectId, date, groups, ...sheetTotals(groups) };
}

export async function getSheet(projectId: string, date: string): Promise<AttendanceSheet> {
  const user = await requireUser();
  await assertProjectAccess(user, projectId);
  return buildSheet(user.company.id, projectId, date);
}

export async function setQuantity(
  projectId: string,
  date: string,
  subcategoryId: string,
  quantity: number,
  notes?: string | null,
): Promise<AttendanceSheet> {
  const user = await requireUser();
  await assertProjectAccess(user, projectId);
  const key = { projectId, date: new Date(date), labourSubcategoryId: subcategoryId };
  if (quantity <= 0) {
    await prisma.labourAttendance.deleteMany({ where: { ...key, companyId: user.company.id } });
  } else {
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
    const estimatedCostPaise = (snapshot ?? 0) * quantity;
    await prisma.labourAttendance.upsert({
      where: { projectId_date_labourSubcategoryId: key },
      create: {
        companyId: user.company.id,
        ...key,
        quantityPresent: quantity,
        dailyRatePaiseSnapshot: snapshot,
        estimatedCostPaise,
        notes: notes ?? null,
        clientUuid: crypto.randomUUID(),
        clientSeq: BigInt(Date.now()),
      },
      update: { quantityPresent: quantity, estimatedCostPaise, ...(notes !== undefined ? { notes } : {}) },
    });
  }
  return buildSheet(user.company.id, projectId, date);
}

export async function copyPreviousDay(projectId: string, date: string): Promise<AttendanceSheet> {
  const user = await requireUser();
  await assertProjectAccess(user, projectId);
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
      ...(user.role !== "OWNER" ? { project: { pmId: user.id } } : {}),
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
  const user = await requireUser();
  return fetchItems(user, filters);
}

export async function summary(filters: AttendanceFilters): Promise<LabourSummary> {
  const user = await requireUser();
  return summarize(await fetchItems(user, filters));
}
