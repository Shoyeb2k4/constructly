import type { LaborRepository } from "../repository";
import type {
  AttendanceFilters,
  AttendanceRecordItem,
  AttendanceSheet,
  CreateCategoryInput,
  LabourCategory,
  UpdateCategoryInput,
} from "../types";
import { sheetTotals, summarize } from "../calc";
import {
  DEMO_CATEGORIES,
  demoLabourAttendance,
  type CategoryRecord,
  type LabourAttendanceRecord,
} from "./seed";

const K = {
  categories: "constructly.demo.labourCategories.v1",
  attendance: "constructly.demo.labourAttendance.v1",
  projects: "constructly.demo.projects.v1",
};

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function read<T>(key: string, seed: () => T[]): T[] {
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T[];
  } catch {
    /* ignore */
  }
  const seeded = structuredClone(seed());
  write(key, seeded);
  return seeded;
}
function write<T>(key: string, rows: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

const loadCategories = () => read<CategoryRecord>(K.categories, () => DEMO_CATEGORIES);
const loadAttendance = () => read<LabourAttendanceRecord>(K.attendance, () => demoLabourAttendance());

function projectName(id: string): string {
  if (typeof window === "undefined") return "Unknown";
  try {
    const rows = JSON.parse(window.localStorage.getItem(K.projects) ?? "[]") as { id: string; name: string }[];
    return rows.find((p) => p.id === id)?.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

function buildSheet(
  projectId: string,
  date: string,
  categories: CategoryRecord[],
  attendance: LabourAttendanceRecord[],
): AttendanceSheet {
  const todays = attendance.filter((a) => a.projectId === projectId && a.date === date);
  const rows = categories.map((c) => {
    const rec = todays.find((a) => a.labourCategoryId === c.id);
    return {
      categoryId: c.id,
      name: c.name,
      color: c.color,
      // Effective rate: the record's snapshot when recorded, else current.
      dailyRatePaise: rec ? rec.dailyRatePaiseSnapshot : c.dailyRatePaise,
      quantity: rec?.quantityPresent ?? 0,
      notes: rec?.notes ?? null,
    };
  });
  return { projectId, date, rows, ...sheetTotals(rows) };
}

function toItems(records: LabourAttendanceRecord[], categories: CategoryRecord[]): AttendanceRecordItem[] {
  return records.map((r) => {
    const c = categories.find((x) => x.id === r.labourCategoryId);
    return {
      id: r.id,
      projectId: r.projectId,
      projectName: projectName(r.projectId),
      date: r.date,
      categoryId: r.labourCategoryId,
      categoryName: c?.name ?? "Unknown",
      color: c?.color ?? "#64748B",
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
  async listCategories() {
    return loadCategories().map((c) => ({ ...c })) as LabourCategory[];
  },

  async createCategory(input: CreateCategoryInput) {
    const rows = loadCategories();
    if (rows.some((c) => c.name.trim().toLowerCase() === input.name.trim().toLowerCase())) {
      throw new Error("DUPLICATE_NAME");
    }
    const rec: CategoryRecord = {
      id: uid(),
      name: input.name,
      color: input.color,
      dailyRatePaise: input.dailyRatePaise ?? null,
    };
    rows.push(rec);
    write(K.categories, rows);
    return { ...rec };
  },

  async updateCategory(id, patch: UpdateCategoryInput) {
    const rows = loadCategories();
    const rec = rows.find((c) => c.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    Object.assign(rec, {
      ...patch,
      dailyRatePaise: patch.dailyRatePaise !== undefined ? patch.dailyRatePaise : rec.dailyRatePaise,
    });
    write(K.categories, rows);
    return { ...rec };
  },

  async deleteCategory(id) {
    write(K.categories, loadCategories().filter((c) => c.id !== id));
    write(K.attendance, loadAttendance().filter((a) => a.labourCategoryId !== id));
  },

  async getSheet(projectId, date) {
    return buildSheet(projectId, date, loadCategories(), loadAttendance());
  },

  async setQuantity(projectId, date, categoryId, quantity, notes) {
    const categories = loadCategories();
    let attendance = loadAttendance();
    const existing = attendance.find(
      (a) => a.projectId === projectId && a.date === date && a.labourCategoryId === categoryId,
    );
    if (quantity <= 0) {
      attendance = attendance.filter((a) => a !== existing);
    } else if (existing) {
      // Keep the original rate snapshot — editing a headcount never adopts a
      // newer rate; history stays immutable (ADR-0022).
      existing.quantityPresent = quantity;
      existing.estimatedCostPaise = (existing.dailyRatePaiseSnapshot ?? 0) * quantity;
      if (notes !== undefined) existing.notes = notes;
      existing.updatedAt = new Date().toISOString();
    } else {
      const rate = categories.find((c) => c.id === categoryId)?.dailyRatePaise ?? null;
      attendance.push({
        id: uid(),
        projectId,
        date,
        labourCategoryId: categoryId,
        quantityPresent: quantity,
        dailyRatePaiseSnapshot: rate,
        estimatedCostPaise: (rate ?? 0) * quantity,
        notes: notes ?? null,
        clientUuid: uid(),
        updatedAt: new Date().toISOString(),
      });
    }
    write(K.attendance, attendance);
    return buildSheet(projectId, date, categories, attendance);
  },

  async copyPreviousDay(projectId, date) {
    const categories = loadCategories();
    let attendance = loadAttendance();
    const prevDates = attendance
      .filter((a) => a.projectId === projectId && a.date < date)
      .map((a) => a.date)
      .sort();
    const prev = prevDates.at(-1);
    if (prev) {
      const source = attendance.filter((a) => a.projectId === projectId && a.date === prev);
      for (const rec of source) {
        attendance = attendance.filter(
          (a) => !(a.projectId === projectId && a.date === date && a.labourCategoryId === rec.labourCategoryId),
        );
        // Copying into a new day is a NEW recording → snapshot today's rate.
        const rate = categories.find((c) => c.id === rec.labourCategoryId)?.dailyRatePaise ?? null;
        attendance.push({
          ...rec,
          id: uid(),
          date,
          dailyRatePaiseSnapshot: rate,
          estimatedCostPaise: (rate ?? 0) * rec.quantityPresent,
          clientUuid: uid(),
          updatedAt: new Date().toISOString(),
        });
      }
      write(K.attendance, attendance);
    }
    return buildSheet(projectId, date, categories, attendance);
  },

  async listAttendance(filters: AttendanceFilters) {
    const rows = applyFilters(loadAttendance(), filters).sort(
      (a, b) => b.date.localeCompare(a.date),
    );
    return toItems(rows, loadCategories());
  },

  async summary(filters: AttendanceFilters) {
    const items = toItems(applyFilters(loadAttendance(), filters), loadCategories());
    return summarize(items);
  },
};
