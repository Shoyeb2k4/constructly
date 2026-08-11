"use server";

import { prisma } from "@/lib/db/prisma";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { rowTotals, sheetTotals, summarize } from "../calc";
import { isAttributionEligible, resolveAttendanceRate } from "./assignment-eligibility";
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
  const [projectContractors, todays] = await Promise.all([
    prisma.projectContractor.findMany({
      where: { companyId, projectId },
      include: {
        contractor: { select: { name: true } },
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
    prisma.labourAttendance.findMany({
      where: { companyId, projectId, date: new Date(date) },
      include: {
        subcategory: { select: { name: true, categoryId: true, category: { select: { name: true } } } },
        contractor: { select: { name: true } },
      },
    }),
  ]);

  // Index recorded rows by contractor|subcategory; track which are represented
  // by a configured (contractor, labour-type) so leftovers can be surfaced.
  const attKey = (contractorId: string | null, subId: string) => `${contractorId ?? ""}|${subId}`;
  const byKey = new Map(todays.map((a) => [attKey(a.contractorId, a.labourSubcategoryId), a]));
  const consumed = new Set<string>();

  const groups: SheetGroup[] = projectContractors.map((pc) => {
    const rows: SheetRow[] = pc.labourRates.map((lr) => {
      const k = attKey(pc.contractorId, lr.labourSubcategoryId);
      const rec = byKey.get(k);
      if (rec) consumed.add(k);
      return {
        subcategoryId: lr.labourSubcategoryId,
        name: lr.subcategory.name,
        categoryId: lr.subcategory.categoryId,
        categoryName: lr.subcategory.category.name,
        // Effective rate: the record's snapshot when recorded, else the
        // project+contractor configured rate.
        dailyRatePaise: rec ? rec.dailyRatePaiseSnapshot : lr.ratePaise,
        quantity: rec?.quantityPresent ?? 0,
        notes: rec?.notes ?? null,
      };
    });
    return {
      contractorId: pc.contractorId,
      contractorName: pc.contractor.name,
      contractRatePaise: pc.contractRatePaise,
      contractRateUnit: pc.contractRateUnit,
      configured: true,
      rows,
      ...rowTotals(rows),
    };
  });

  // Leftover recorded rows not covered by any configured (contractor, type):
  // a contractor/type de-configured after recording, or legacy unattributed
  // rows (contractorId null). Grouped so history stays visible & clearable, but
  // marked configured:false so they read as "no longer configured".
  const orphans = new Map<string, { contractorId: string | null; name: string; rows: SheetRow[] }>();
  for (const a of todays) {
    const k = attKey(a.contractorId, a.labourSubcategoryId);
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
  projectId: string,
  key: { projectId: string; date: Date; labourSubcategoryId: string; contractorId: string | null },
  contractorId: string | null,
  subcategoryId: string,
  quantity: number,
  notes: string | null | undefined,
): Promise<void> {
  const existing = await prisma.labourAttendance.findFirst({
    where: {
      companyId,
      projectId,
      date: key.date,
      labourSubcategoryId: subcategoryId,
      contractorId,
    },
    select: { id: true, dailyRatePaiseSnapshot: true, projectContractorLabourRateId: true },
  });

  let snapshot: number | null;
  let rateId: string | null;
  if (existing) {
    snapshot = existing.dailyRatePaiseSnapshot;
    rateId = existing.projectContractorLabourRateId;
  } else {
    const resolved = await resolveAttendanceRate(companyId, projectId, contractorId, subcategoryId);
    snapshot = resolved.ratePaise;
    rateId = resolved.projectContractorLabourRateId;
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
        projectId,
        date: key.date,
        labourSubcategoryId: subcategoryId,
        contractorId,
        quantityPresent: quantity,
        dailyRatePaiseSnapshot: snapshot,
        projectContractorLabourRateId: rateId,
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
  const cid = contractorId ?? null;
  const key = { projectId, date: new Date(date), labourSubcategoryId: subcategoryId, contractorId: cid };
  if (quantity <= 0) {
    // Deleting a row: attribution is moot, so no eligibility check (avoids
    // rejecting a legitimate clear). Keyed by contractor so clearing one
    // contractor's row never touches another's on the same subcategory/date.
    await prisma.labourAttendance.deleteMany({ where: { ...key, companyId: user.company.id } });
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
    await writeAttendanceRow(user.company.id, projectId, key, cid, subcategoryId, quantity, notes);
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
      // Preserve the contractor attribution so each contractor's rows copy
      // forward independently (Pappu-Centering and Saddam-Centering stay split).
      await setQuantity(
        projectId,
        date,
        rec.labourSubcategoryId,
        rec.quantityPresent,
        rec.notes,
        rec.contractorId,
      );
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
