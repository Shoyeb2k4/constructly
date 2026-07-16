"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/current-user";
import type { SessionUser } from "@/lib/auth/types";
import { sheetTotals, summarize } from "../calc";
import type {
  AttendanceFilters,
  AttendanceRecordItem,
  AttendanceSheet,
  CreateCategoryInput,
  LabourCategory,
  LabourSummary,
  UpdateCategoryInput,
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

export async function listCategories(): Promise<LabourCategory[]> {
  const user = await requireUser();
  const rows = await prisma.labourCategory.findMany({
    where: { companyId: user.company.id },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((c) => ({ id: c.id, name: c.name, color: c.color, dailyRatePaise: c.dailyRatePaise }));
}

export async function createCategory(input: CreateCategoryInput): Promise<LabourCategory> {
  const user = await requireUser();
  const c = await prisma.labourCategory.create({
    data: {
      companyId: user.company.id,
      name: input.name,
      color: input.color,
      dailyRatePaise: input.dailyRatePaise ?? null,
    },
  });
  return { id: c.id, name: c.name, color: c.color, dailyRatePaise: c.dailyRatePaise };
}

export async function updateCategory(id: string, patch: UpdateCategoryInput): Promise<LabourCategory> {
  const user = await requireUser();
  const c = await prisma.labourCategory.update({
    where: { id, companyId: user.company.id },
    data: patch,
  });
  return { id: c.id, name: c.name, color: c.color, dailyRatePaise: c.dailyRatePaise };
}

export async function deleteCategory(id: string): Promise<void> {
  const user = await requireUser();
  await prisma.labourCategory.delete({ where: { id, companyId: user.company.id } });
}

async function buildSheet(companyId: string, projectId: string, date: string): Promise<AttendanceSheet> {
  const [categories, todays] = await Promise.all([
    prisma.labourCategory.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
    prisma.labourAttendance.findMany({ where: { companyId, projectId, date: new Date(date) } }),
  ]);
  const rows = categories.map((c) => {
    const rec = todays.find((a) => a.labourCategoryId === c.id);
    return {
      categoryId: c.id,
      name: c.name,
      color: c.color,
      dailyRatePaise: c.dailyRatePaise,
      quantity: rec?.quantityPresent ?? 0,
      notes: rec?.notes ?? null,
    };
  });
  return { projectId, date, rows, ...sheetTotals(rows) };
}

export async function getSheet(projectId: string, date: string): Promise<AttendanceSheet> {
  const user = await requireUser();
  await assertProjectAccess(user, projectId);
  return buildSheet(user.company.id, projectId, date);
}

export async function setQuantity(
  projectId: string,
  date: string,
  categoryId: string,
  quantity: number,
  notes?: string | null,
): Promise<AttendanceSheet> {
  const user = await requireUser();
  await assertProjectAccess(user, projectId);
  const key = { projectId, date: new Date(date), labourCategoryId: categoryId };
  if (quantity <= 0) {
    await prisma.labourAttendance.deleteMany({ where: { ...key, companyId: user.company.id } });
  } else {
    await prisma.labourAttendance.upsert({
      where: { projectId_date_labourCategoryId: key },
      create: {
        companyId: user.company.id,
        ...key,
        quantityPresent: quantity,
        notes: notes ?? null,
        clientUuid: crypto.randomUUID(),
        clientSeq: BigInt(Date.now()),
      },
      update: { quantityPresent: quantity, ...(notes !== undefined ? { notes } : {}) },
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
      await setQuantity(projectId, date, rec.labourCategoryId, rec.quantityPresent, rec.notes);
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
      category: { select: { name: true, color: true } },
      project: { select: { name: true } },
    },
    orderBy: { date: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectName: r.project.name,
    date: r.date.toISOString().slice(0, 10),
    categoryId: r.labourCategoryId,
    categoryName: r.category.name,
    color: r.category.color,
    quantityPresent: r.quantityPresent,
    notes: r.notes,
  }));
}

export async function listAttendance(filters: AttendanceFilters): Promise<AttendanceRecordItem[]> {
  const user = await requireUser();
  return fetchItems(user, filters);
}

export async function summary(filters: AttendanceFilters): Promise<LabourSummary> {
  const user = await requireUser();
  const [items, categories] = await Promise.all([
    fetchItems(user, filters),
    prisma.labourCategory.findMany({ where: { companyId: user.company.id } }),
  ]);
  const rateOf = (id: string) => categories.find((c) => c.id === id)?.dailyRatePaise ?? null;
  return summarize(items, rateOf);
}
