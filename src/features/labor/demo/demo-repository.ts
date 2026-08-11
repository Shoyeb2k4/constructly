import type { LaborRepository } from "../repository";
import type {
  AttendanceFilters,
  AttendanceRecordItem,
  AttendanceSheet,
  CategoryWithSubs,
  CreateCategoryInput,
  CreateSubcategoryInput,
  UpdateCategoryInput,
  UpdateSubcategoryInput,
} from "../types";
import { rowTotals, sheetTotals, summarize } from "../calc";
import {
  DEMO_CATEGORIES,
  DEMO_SUBCATEGORIES,
  demoLabourAttendance,
  type CategoryRecord,
  type SubcategoryRecord,
  type LabourAttendanceRecord,
} from "./seed";

const K = {
  categories: "constructly.demo.labourCategories.v2",
  subcategories: "constructly.demo.labourSubcategories.v2",
  attendance: "constructly.demo.labourAttendance.v2",
  projects: "constructly.demo.projects.v1",
  // Legacy flat-model stores (migrated on first load — ADR-0023).
  v1Categories: "constructly.demo.labourCategories.v1",
  v1Attendance: "constructly.demo.labourAttendance.v1",
};

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function readRaw<T>(key: string): T[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : null;
  } catch {
    return null;
  }
}
function write<T>(key: string, rows: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

/** Demo parity for server eligibility (category-exact): is this contractor
 *  assigned to this project FOR THE SUBCATEGORY'S CATEGORY? The category is
 *  resolved from the subcategory (never trusted from the caller), mirroring
 *  isAttributionEligible on the server. */
/** Demo parity for the server's assignment guard: does ANY project have a
 *  contractor assignment referencing this category? */
function categoryHasAssignmentsDemo(categoryId: string): boolean {
  const projects =
    readRaw<{ contractorAssignments?: { labourCategoryId: string }[] }>(K.projects) ?? [];
  return projects.some((p) =>
    p.contractorAssignments?.some((a) => a.labourCategoryId === categoryId),
  );
}

function isAttributionEligibleDemo(
  projectId: string,
  subcategoryId: string,
  contractorId: string,
): boolean {
  const sub = loadSubcategories().find((s) => s.id === subcategoryId);
  if (!sub) return false;
  const projects =
    readRaw<{ id: string; contractorAssignments?: { contractorId: string; labourCategoryId: string }[] }>(
      K.projects,
    ) ?? [];
  const p = projects.find((x) => x.id === projectId);
  return !!p?.contractorAssignments?.some(
    (a) => a.contractorId === contractorId && a.labourCategoryId === sub.categoryId,
  );
}

interface V1Category { id: string; name: string; color: string; dailyRatePaise: number | null }
interface V1Attendance extends Omit<LabourAttendanceRecord, "labourSubcategoryId"> { labourCategoryId: string }

/**
 * Ensure the v2 hierarchy stores exist. Migrates legacy flat categories:
 * each old category becomes Category → Default Subcategory (same name + rate),
 * and attendance is repointed — no data loss (mirrors migration-labour-hierarchy.sql).
 */
function ensureStores(): void {
  if (typeof window === "undefined") return;
  if (readRaw<CategoryRecord>(K.categories)) return;

  const v1Cats = readRaw<V1Category>(K.v1Categories);
  if (v1Cats && v1Cats.length > 0) {
    const categories: CategoryRecord[] = [];
    const subcategories: SubcategoryRecord[] = [];
    v1Cats.forEach((c, i) => {
      const categoryId = uid();
      categories.push({ id: categoryId, name: c.name, color: c.color ?? null, displayOrder: i });
      // The default subcategory KEEPS the old category id so existing
      // attendance repoints with a field rename only.
      subcategories.push({
        id: c.id,
        categoryId,
        name: c.name,
        dailyRatePaise: c.dailyRatePaise ?? null,
        displayOrder: 0,
      });
    });
    const v1Att = readRaw<V1Attendance>(K.v1Attendance) ?? [];
    const attendance: LabourAttendanceRecord[] = v1Att.map(({ labourCategoryId, ...rest }) => ({
      ...rest,
      labourSubcategoryId: labourCategoryId,
    }));
    write(K.categories, categories);
    write(K.subcategories, subcategories);
    write(K.attendance, attendance);
    return;
  }

  write(K.categories, structuredClone(DEMO_CATEGORIES));
  write(K.subcategories, structuredClone(DEMO_SUBCATEGORIES));
  write(K.attendance, structuredClone(demoLabourAttendance()));
}

function loadCategories(): CategoryRecord[] {
  ensureStores();
  return readRaw<CategoryRecord>(K.categories) ?? structuredClone(DEMO_CATEGORIES);
}
function loadSubcategories(): SubcategoryRecord[] {
  ensureStores();
  return readRaw<SubcategoryRecord>(K.subcategories) ?? structuredClone(DEMO_SUBCATEGORIES);
}
function loadAttendance(): LabourAttendanceRecord[] {
  ensureStores();
  return readRaw<LabourAttendanceRecord>(K.attendance) ?? structuredClone(demoLabourAttendance());
}

function projectName(id: string): string {
  const rows = readRaw<{ id: string; name: string }>(K.projects) ?? [];
  return rows.find((p) => p.id === id)?.name ?? "Unknown";
}

const byOrder = <T extends { displayOrder: number }>(a: T, b: T) => a.displayOrder - b.displayOrder;

function buildSheet(
  projectId: string,
  date: string,
  categories: CategoryRecord[],
  subcategories: SubcategoryRecord[],
  attendance: LabourAttendanceRecord[],
): AttendanceSheet {
  const todays = attendance.filter((a) => a.projectId === projectId && a.date === date);
  const groups = [...categories].sort(byOrder).map((c) => {
    const rows = subcategories
      .filter((s) => s.categoryId === c.id)
      .sort(byOrder)
      .map((s) => {
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

function toItems(records: LabourAttendanceRecord[]): AttendanceRecordItem[] {
  const categories = loadCategories();
  const subcategories = loadSubcategories();
  return records.map((r) => {
    const sub = subcategories.find((s) => s.id === r.labourSubcategoryId);
    const cat = sub ? categories.find((c) => c.id === sub.categoryId) : undefined;
    return {
      id: r.id,
      projectId: r.projectId,
      projectName: projectName(r.projectId),
      date: r.date,
      categoryId: cat?.id ?? "unknown",
      categoryName: cat?.name ?? "Unknown",
      color: cat?.color ?? null,
      subcategoryId: r.labourSubcategoryId,
      subcategoryName: sub?.name ?? "Unknown",
      quantityPresent: r.quantityPresent,
      dailyRatePaiseSnapshot: r.dailyRatePaiseSnapshot,
      estimatedCostPaise: r.estimatedCostPaise,
      notes: r.notes,
    };
  });
}

function applyFilters(records: LabourAttendanceRecord[], f: AttendanceFilters): LabourAttendanceRecord[] {
  let rows = records;
  if (f.projectId && f.projectId !== "ALL") rows = rows.filter((r) => r.projectId === f.projectId);
  if (f.from) rows = rows.filter((r) => r.date >= f.from!);
  if (f.to) rows = rows.filter((r) => r.date <= f.to!);
  return rows;
}

export const demoLaborRepository: LaborRepository = {
  async listCategories(): Promise<CategoryWithSubs[]> {
    const subs = loadSubcategories();
    return [...loadCategories()].sort(byOrder).map((c) => ({
      ...c,
      subcategories: subs.filter((s) => s.categoryId === c.id).sort(byOrder),
    }));
  },

  async createCategory(input: CreateCategoryInput) {
    const rows = loadCategories();
    if (rows.some((c) => c.name.trim().toLowerCase() === input.name.trim().toLowerCase())) {
      throw new Error("DUPLICATE_NAME");
    }
    const rec: CategoryRecord = {
      id: uid(),
      name: input.name,
      color: input.color ?? null,
      displayOrder: rows.length,
    };
    rows.push(rec);
    write(K.categories, rows);
    return { ...rec };
  },

  async updateCategory(id, patch: UpdateCategoryInput) {
    const rows = loadCategories();
    const rec = rows.find((c) => c.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    if (patch.name !== undefined) rec.name = patch.name;
    if (patch.color !== undefined) rec.color = patch.color ?? null;
    write(K.categories, rows);
    return { ...rec };
  },

  async deleteCategory(id) {
    const subIds = new Set(loadSubcategories().filter((s) => s.categoryId === id).map((s) => s.id));
    // Guards (parity with the server): block deletion when the category has
    // recorded attendance (history) OR active project-contractor assignments
    // (config that must only change via the audited setContractorAssignments).
    if (loadAttendance().some((a) => subIds.has(a.labourSubcategoryId))) {
      throw new Error("CATEGORY_HAS_ATTENDANCE");
    }
    if (categoryHasAssignmentsDemo(id)) {
      throw new Error("CATEGORY_HAS_ASSIGNMENTS");
    }
    write(K.categories, loadCategories().filter((c) => c.id !== id));
    write(K.subcategories, loadSubcategories().filter((s) => s.categoryId !== id));
  },

  async reorderCategories(orderedIds) {
    const rows = loadCategories();
    rows.forEach((c) => {
      const i = orderedIds.indexOf(c.id);
      if (i >= 0) c.displayOrder = i;
    });
    write(K.categories, rows);
  },

  async createSubcategory(input: CreateSubcategoryInput) {
    const rows = loadSubcategories();
    if (
      rows.some(
        (s) =>
          s.categoryId === input.categoryId &&
          s.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
      )
    ) {
      throw new Error("DUPLICATE_NAME");
    }
    const rec: SubcategoryRecord = {
      id: uid(),
      categoryId: input.categoryId,
      name: input.name,
      dailyRatePaise: input.dailyRatePaise ?? null,
      displayOrder: rows.filter((s) => s.categoryId === input.categoryId).length,
    };
    rows.push(rec);
    write(K.subcategories, rows);
    return { ...rec };
  },

  async updateSubcategory(id, patch: UpdateSubcategoryInput) {
    const rows = loadSubcategories();
    const rec = rows.find((s) => s.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    if (patch.name !== undefined) rec.name = patch.name;
    if (patch.dailyRatePaise !== undefined) rec.dailyRatePaise = patch.dailyRatePaise ?? null;
    if (patch.categoryId !== undefined && patch.categoryId !== rec.categoryId) {
      rec.categoryId = patch.categoryId!;
      rec.displayOrder = rows.filter((s) => s.categoryId === patch.categoryId).length;
    }
    write(K.subcategories, rows);
    return { ...rec };
  },

  async deleteSubcategory(id) {
    // History guard (parity with the server): block deletion when the
    // subcategory has recorded attendance.
    if (loadAttendance().some((a) => a.labourSubcategoryId === id)) {
      throw new Error("SUBCATEGORY_HAS_ATTENDANCE");
    }
    write(K.subcategories, loadSubcategories().filter((s) => s.id !== id));
  },

  async reorderSubcategories(categoryId, orderedIds) {
    const rows = loadSubcategories();
    rows.forEach((s) => {
      if (s.categoryId !== categoryId) return;
      const i = orderedIds.indexOf(s.id);
      if (i >= 0) s.displayOrder = i;
    });
    write(K.subcategories, rows);
  },

  async getSheet(projectId, date) {
    return buildSheet(projectId, date, loadCategories(), loadSubcategories(), loadAttendance());
  },

  async setQuantity(projectId, date, subcategoryId, quantity, notes, contractorId) {
    const categories = loadCategories();
    const subcategories = loadSubcategories();
    let attendance = loadAttendance();
    // Eligibility parity with the server: only a contractor assigned to this
    // project may be attributed; an ineligible id degrades to null (never
    // rejects, matching the offline sync path). undefined = leave unchanged.
    let effContractor = contractorId;
    if (typeof effContractor === "string" && !isAttributionEligibleDemo(projectId, subcategoryId, effContractor)) {
      effContractor = null;
    }
    const existing = attendance.find(
      (a) => a.projectId === projectId && a.date === date && a.labourSubcategoryId === subcategoryId,
    );
    if (quantity <= 0) {
      attendance = attendance.filter((a) => a !== existing);
    } else if (existing) {
      // Keep the original rate snapshot — history stays immutable (ADR-0022).
      existing.quantityPresent = quantity;
      existing.estimatedCostPaise = Math.round((existing.dailyRatePaiseSnapshot ?? 0) * quantity);
      if (notes !== undefined) existing.notes = notes;
      if (effContractor !== undefined) existing.contractorId = effContractor;
      existing.updatedAt = new Date().toISOString();
    } else {
      const rate = subcategories.find((s) => s.id === subcategoryId)?.dailyRatePaise ?? null;
      attendance.push({
        id: uid(),
        projectId,
        date,
        labourSubcategoryId: subcategoryId,
        quantityPresent: quantity,
        dailyRatePaiseSnapshot: rate,
        estimatedCostPaise: Math.round((rate ?? 0) * quantity),
        notes: notes ?? null,
        contractorId: effContractor ?? null,
        clientUuid: uid(),
        updatedAt: new Date().toISOString(),
      });
    }
    write(K.attendance, attendance);
    return buildSheet(projectId, date, categories, subcategories, attendance);
  },

  async copyPreviousDay(projectId, date) {
    const categories = loadCategories();
    const subcategories = loadSubcategories();
    let attendance = loadAttendance();
    const prev = attendance
      .filter((a) => a.projectId === projectId && a.date < date)
      .map((a) => a.date)
      .sort()
      .at(-1);
    if (prev) {
      const source = attendance.filter((a) => a.projectId === projectId && a.date === prev);
      for (const rec of source) {
        attendance = attendance.filter(
          (a) => !(a.projectId === projectId && a.date === date && a.labourSubcategoryId === rec.labourSubcategoryId),
        );
        // Copying into a new day is a NEW recording → snapshot today's rate.
        const rate = subcategories.find((s) => s.id === rec.labourSubcategoryId)?.dailyRatePaise ?? null;
        attendance.push({
          ...rec,
          id: uid(),
          date,
          dailyRatePaiseSnapshot: rate,
          estimatedCostPaise: Math.round((rate ?? 0) * rec.quantityPresent),
          clientUuid: uid(),
          updatedAt: new Date().toISOString(),
        });
      }
      write(K.attendance, attendance);
    }
    return buildSheet(projectId, date, categories, subcategories, attendance);
  },

  async listAttendance(filters: AttendanceFilters) {
    const rows = applyFilters(loadAttendance(), filters).sort((a, b) => b.date.localeCompare(a.date));
    return toItems(rows);
  },

  async summary(filters: AttendanceFilters) {
    return summarize(toItems(applyFilters(loadAttendance(), filters)));
  },
};
