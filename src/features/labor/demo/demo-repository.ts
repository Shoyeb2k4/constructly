import type { LaborRepository } from "../repository";
import type {
  AttendanceFilters,
  AttendanceRecordItem,
  AttendanceSheet,
  CategoryWithSubs,
  CreateCategoryInput,
  CreateSubcategoryInput,
  ForceDeleteImpact,
  ForceDeleteKind,
  SheetGroup,
  SheetRow,
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
  contractors: "constructly.demo.contractors.v1",
  // Legacy flat-model stores (migrated on first load — ADR-0023).
  v1Categories: "constructly.demo.labourCategories.v1",
  v1Attendance: "constructly.demo.labourAttendance.v1",
};

/** Shape of a project's contractor-first config as persisted by the projects
 *  demo repo (self-describing — carries resolved names, so no extra lookups). */
interface DemoProjectContractorRate {
  labourSubcategoryId: string;
  subcategoryName: string;
  categoryId: string;
  categoryName: string;
  ratePaise: number;
  rateUnit: string;
}
interface DemoProjectContractor {
  contractorId: string;
  contractorName: string;
  contractRatePaise: number | null;
  contractRateUnit: string | null;
  labourRates: DemoProjectContractorRate[];
}
interface DemoProjectRec {
  id: string;
  name: string;
  contractors?: DemoProjectContractor[];
}

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

function loadProjectsRaw(): DemoProjectRec[] {
  return readRaw<DemoProjectRec>(K.projects) ?? [];
}
/** Contractor id → name, for attributing orphan/legacy attendance rows. */
function contractorNames(): Map<string, string> {
  const rows = readRaw<{ id: string; name: string }>(K.contractors) ?? [];
  return new Map(rows.map((c) => [c.id, c.name]));
}

/** The configured project+contractor rate for a subcategory, or undefined when
 *  the contractor doesn't supply that subcategory on the project. */
function projectContractorRatePaise(
  projectId: string,
  contractorId: string,
  subcategoryId: string,
): number | undefined {
  const p = loadProjectsRaw().find((x) => x.id === projectId);
  const pc = p?.contractors?.find((c) => c.contractorId === contractorId);
  return pc?.labourRates.find((r) => r.labourSubcategoryId === subcategoryId)?.ratePaise;
}

/** Demo parity for the server's category-delete guard: does ANY project have a
 *  configured labour rate referencing a subcategory in this category? */
function categoryHasAssignmentsDemo(categoryId: string): boolean {
  const subIds = new Set(
    loadSubcategories().filter((s) => s.categoryId === categoryId).map((s) => s.id),
  );
  return loadProjectsRaw().some((p) =>
    p.contractors?.some((c) => c.labourRates.some((r) => subIds.has(r.labourSubcategoryId))),
  );
}

/** Demo parity for the server's subcategory-delete config guard. */
function subcategoryHasAssignmentsDemo(subcategoryId: string): boolean {
  return loadProjectsRaw().some((p) =>
    p.contractors?.some((c) => c.labourRates.some((r) => r.labourSubcategoryId === subcategoryId)),
  );
}

/**
 * Force-delete config removal (demo parity): the project-contractor labour rates
 * are the "config" the server hard-deletes. Count (apply=false) or actually
 * remove (apply=true) every rate referencing a subcategory in `subIds`, and
 * report how many rates / distinct projects were affected.
 */
function collectRatesForSubs(subIds: Set<string>, apply: boolean): { rates: number; projects: number } {
  const projects = loadProjectsRaw();
  let rates = 0;
  const affected = new Set<string>();
  for (const p of projects) {
    for (const c of p.contractors ?? []) {
      const matching = c.labourRates.filter((r) => subIds.has(r.labourSubcategoryId));
      if (matching.length === 0) continue;
      rates += matching.length;
      affected.add(p.id);
      if (apply) c.labourRates = c.labourRates.filter((r) => !subIds.has(r.labourSubcategoryId));
    }
  }
  if (apply && rates > 0) write(K.projects, projects);
  return { rates, projects: affected.size };
}

/** Compute the Force Delete impact from the demo stores (no mutation). */
function demoImpact(kind: ForceDeleteKind, id: string): ForceDeleteImpact {
  const subs = loadSubcategories();
  const name =
    kind === "category"
      ? loadCategories().find((c) => c.id === id && !c.deletedAt)?.name
      : subs.find((s) => s.id === id && !s.deletedAt)?.name;
  if (name === undefined) throw new Error("NOT_FOUND");
  const subIds =
    kind === "subcategory"
      ? new Set([id])
      : new Set(subs.filter((s) => s.categoryId === id && !s.deletedAt).map((s) => s.id));
  const { rates, projects } = collectRatesForSubs(subIds, false);
  const attendancePreserved = loadAttendance().filter((a) => subIds.has(a.labourSubcategoryId)).length;
  return {
    kind,
    id,
    name,
    labourGroups: kind === "category" ? 1 : 0,
    labourTypes: subIds.size,
    projectContractorRates: rates,
    projectContractorAssignments: 0, // demo has no separate assignment store
    attendancePreserved,
    settlementsPreserved: 0, // demo tracks no settlements in this repo
    projectsAffected: projects,
  };
}

/** Demo parity for server eligibility (subcategory-exact): does the contractor
 *  supply this subcategory on this project (a configured rate exists)? */
function isAttributionEligibleDemo(
  projectId: string,
  subcategoryId: string,
  contractorId: string,
): boolean {
  return projectContractorRatePaise(projectId, contractorId, subcategoryId) !== undefined;
}

/** Resolve the effective rate to snapshot: project+contractor+subcategory rate,
 *  falling back to the subcategory's global default (parity with the server). */
function resolveRateDemo(
  projectId: string,
  contractorId: string | null,
  subcategoryId: string,
): number | null {
  if (contractorId != null) {
    const r = projectContractorRatePaise(projectId, contractorId, subcategoryId);
    if (r !== undefined) return r;
  }
  return loadSubcategories().find((s) => s.id === subcategoryId)?.dailyRatePaise ?? null;
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
  subcategories: SubcategoryRecord[],
  attendance: LabourAttendanceRecord[],
): AttendanceSheet {
  const todays = attendance.filter((a) => a.projectId === projectId && a.date === date);
  const config = loadProjectsRaw().find((p) => p.id === projectId)?.contractors ?? [];
  const names = contractorNames();
  const subName = new Map(subcategories.map((s) => [s.id, s.name]));
  const subCat = new Map(subcategories.map((s) => [s.id, s.categoryId]));
  const catName = new Map(loadCategories().map((c) => [c.id, c.name]));

  const attKey = (contractorId: string | null | undefined, subId: string) =>
    `${contractorId ?? ""}|${subId}`;
  const byKey = new Map(todays.map((a) => [attKey(a.contractorId ?? null, a.labourSubcategoryId), a]));
  const consumed = new Set<string>();

  const groups: SheetGroup[] = [...config]
    .sort((a, b) => a.contractorName.localeCompare(b.contractorName))
    .map((pc) => {
      const rows: SheetRow[] = pc.labourRates.map((lr) => {
        const k = attKey(pc.contractorId, lr.labourSubcategoryId);
        const rec = byKey.get(k);
        if (rec) consumed.add(k);
        return {
          subcategoryId: lr.labourSubcategoryId,
          name: lr.subcategoryName,
          categoryId: lr.categoryId,
          categoryName: lr.categoryName,
          dailyRatePaise: rec ? rec.dailyRatePaiseSnapshot : lr.ratePaise,
          quantity: rec?.quantityPresent ?? 0,
          notes: rec?.notes ?? null,
        };
      });
      return {
        contractorId: pc.contractorId,
        contractorName: pc.contractorName,
        contractRatePaise: pc.contractRatePaise,
        contractRateUnit: pc.contractRateUnit,
        configured: true,
        rows,
        ...rowTotals(rows),
      };
    });

  // Leftover recorded rows (de-configured contractor/type, or legacy null).
  const orphans = new Map<string, { contractorId: string | null; name: string; rows: SheetRow[] }>();
  for (const a of todays) {
    const k = attKey(a.contractorId ?? null, a.labourSubcategoryId);
    if (consumed.has(k)) continue;
    const gk = a.contractorId ?? "";
    const cid = a.contractorId ?? null;
    const g = orphans.get(gk) ?? {
      contractorId: cid,
      name: (cid && names.get(cid)) || "Unattributed",
      rows: [],
    };
    const catId = subCat.get(a.labourSubcategoryId) ?? "unknown";
    g.rows.push({
      subcategoryId: a.labourSubcategoryId,
      name: subName.get(a.labourSubcategoryId) ?? "Unknown",
      categoryId: catId,
      categoryName: catName.get(catId) ?? "Unknown",
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

function toItems(records: LabourAttendanceRecord[]): AttendanceRecordItem[] {
  const categories = loadCategories();
  const subcategories = loadSubcategories();
  const names = contractorNames();
  return records.map((r) => {
    const sub = subcategories.find((s) => s.id === r.labourSubcategoryId);
    const cat = sub ? categories.find((c) => c.id === sub.categoryId) : undefined;
    const cid = r.contractorId ?? null;
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
      contractorId: cid,
      contractorName: cid ? (names.get(cid) ?? null) : null,
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
    // Active master data only — soft-deleted groups/types stay in the store so
    // history resolves their names, but are hidden here.
    const subs = loadSubcategories().filter((s) => !s.deletedAt);
    return [...loadCategories()]
      .filter((c) => !c.deletedAt)
      .sort(byOrder)
      .map((c) => ({
        ...c,
        subcategories: subs.filter((s) => s.categoryId === c.id).sort(byOrder),
      }));
  },

  async createCategory(input: CreateCategoryInput) {
    const rows = loadCategories();
    // Only ACTIVE rows collide — a name freed by a soft-delete can be reused.
    if (
      rows.some(
        (c) => !c.deletedAt && c.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
      )
    ) {
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
          !s.deletedAt &&
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
    if (subcategoryHasAssignmentsDemo(id)) {
      throw new Error("SUBCATEGORY_HAS_ASSIGNMENTS");
    }
    write(K.subcategories, loadSubcategories().filter((s) => s.id !== id));
  },

  // ── Owner Force Delete (demo parity) ─────────────────────────────────────
  async forceDeletePreview(kind: ForceDeleteKind, id: string): Promise<ForceDeleteImpact> {
    return demoImpact(kind, id);
  },

  async forceDeleteCategory(id, ack) {
    if (ack !== "DELETE") throw new Error("CONFIRMATION_REQUIRED");
    const cats = loadCategories();
    const cat = cats.find((c) => c.id === id && !c.deletedAt);
    if (!cat) throw new Error("NOT_FOUND");
    const subs = loadSubcategories();
    const subIds = new Set(subs.filter((s) => s.categoryId === id && !s.deletedAt).map((s) => s.id));
    // Remove pure config (project-contractor rates); attendance is left intact.
    collectRatesForSubs(subIds, true);
    // Soft-delete the group + its active types — kept for history readability.
    const now = new Date().toISOString();
    subs.forEach((s) => {
      if (subIds.has(s.id)) s.deletedAt = now;
    });
    cat.deletedAt = now;
    write(K.subcategories, subs);
    write(K.categories, cats);
  },

  async forceDeleteSubcategory(id, ack) {
    if (ack !== "DELETE") throw new Error("CONFIRMATION_REQUIRED");
    const subs = loadSubcategories();
    const sub = subs.find((s) => s.id === id && !s.deletedAt);
    if (!sub) throw new Error("NOT_FOUND");
    collectRatesForSubs(new Set([id]), true);
    sub.deletedAt = new Date().toISOString();
    write(K.subcategories, subs);
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
    return buildSheet(projectId, date, loadSubcategories(), loadAttendance());
  },

  async setQuantity(projectId, date, subcategoryId, quantity, notes, contractorId) {
    const subcategories = loadSubcategories();
    let attendance = loadAttendance();
    // Eligibility parity with the server: a contractor may only be attributed to
    // a subcategory THEY SUPPLY on this project; an ineligible id degrades to
    // null (never rejects, matching the offline sync path). undefined = null.
    let effContractor = contractorId ?? null;
    if (effContractor != null && !isAttributionEligibleDemo(projectId, subcategoryId, effContractor)) {
      effContractor = null;
    }
    // Identity now includes the contractor (Pappu-Centering ≠ Saddam-Centering).
    const existing = attendance.find(
      (a) =>
        a.projectId === projectId &&
        a.date === date &&
        a.labourSubcategoryId === subcategoryId &&
        (a.contractorId ?? null) === effContractor,
    );
    if (quantity <= 0) {
      attendance = attendance.filter((a) => a !== existing);
    } else if (existing) {
      // Keep the original rate snapshot — history stays immutable (ADR-0022).
      existing.quantityPresent = quantity;
      existing.estimatedCostPaise = Math.round((existing.dailyRatePaiseSnapshot ?? 0) * quantity);
      if (notes !== undefined) existing.notes = notes;
      existing.updatedAt = new Date().toISOString();
    } else {
      const rate = resolveRateDemo(projectId, effContractor, subcategoryId);
      attendance.push({
        id: uid(),
        projectId,
        date,
        labourSubcategoryId: subcategoryId,
        quantityPresent: quantity,
        dailyRatePaiseSnapshot: rate,
        estimatedCostPaise: Math.round((rate ?? 0) * quantity),
        notes: notes ?? null,
        contractorId: effContractor,
        clientUuid: uid(),
        updatedAt: new Date().toISOString(),
      });
    }
    write(K.attendance, attendance);
    return buildSheet(projectId, date, subcategories, attendance);
  },

  async copyPreviousDay(projectId, date) {
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
        const cid = rec.contractorId ?? null;
        // Replace the same (subcategory, contractor) slot on the target day.
        attendance = attendance.filter(
          (a) =>
            !(
              a.projectId === projectId &&
              a.date === date &&
              a.labourSubcategoryId === rec.labourSubcategoryId &&
              (a.contractorId ?? null) === cid
            ),
        );
        // Copying into a new day is a NEW recording → snapshot today's rate.
        const rate = resolveRateDemo(projectId, cid, rec.labourSubcategoryId);
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
    return buildSheet(projectId, date, subcategories, attendance);
  },

  async listAttendance(filters: AttendanceFilters) {
    const rows = applyFilters(loadAttendance(), filters).sort((a, b) => b.date.localeCompare(a.date));
    return toItems(rows);
  },

  async summary(filters: AttendanceFilters) {
    return summarize(toItems(applyFilters(loadAttendance(), filters)));
  },
};
