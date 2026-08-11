import type { ProjectsRepository } from "../repository";
import type {
  ProjectContractorInput,
  CreateProjectInput,
  ProjectContractorItem,
  ProjectDetail,
  ProjectFilters,
  ProjectListItem,
  ProjectStage,
  UpdateProjectInput,
} from "../types";
import { STAGE_LABEL } from "../constants";
import { matchesDeadline, byDeadlineAsc, todayISO } from "../deadline";
import { purgeEligibleAt } from "../retention";
import { demoSeed, DEMO_MANAGERS } from "./seed";
import { demoProjectSpend } from "@/features/budget/spend";
import { demoContractorsRepository } from "@/features/contractors/demo/demo-repository";
import { demoLaborRepository } from "@/features/labor/demo/demo-repository";

const KEY = "constructly.demo.projects.v1";
const RETENTION_KEY = "constructly.demo.projects.retention.v1";
const ACTOR = "Aarav Mehta";

function loadRetention(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(RETENTION_KEY);
  return raw == null || raw === "null" ? null : Number(raw);
}

function load(): ProjectDetail[] {
  if (typeof window === "undefined") return demoSeed();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as ProjectDetail[];
  } catch {
    /* ignore corrupt state */
  }
  const seeded = demoSeed();
  save(seeded);
  return seeded;
}

function save(rows: ProjectDetail[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* quota — non-fatal in demo */
  }
}

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function nextCode(rows: ProjectDetail[]): string {
  const max = rows.reduce((m, p) => {
    const n = Number(/PRJ-(\d+)/.exec(p.code)?.[1] ?? 0);
    return Math.max(m, n);
  }, 0);
  return `PRJ-${String(max + 1).padStart(4, "0")}`;
}

function toItem(p: ProjectDetail): ProjectListItem {
  const spend = demoProjectSpend(p.id);
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    type: p.type,
    stage: p.stage,
    budgetPaise: p.budgetPaise,
    contractValuePaise: p.contractValuePaise,
    procurementBudgetPaise: p.procurementBudgetPaise ?? null,
    usedPaise: spend.laborPaise + spend.procurementPaise,
    startDate: p.startDate,
    expectedCompletionDate: p.expectedCompletionDate,
    pm: p.pm,
    tags: p.tags,
    isFavorite: p.isFavorite,
    archivedAt: p.archivedAt,
    deletedAt: p.deletedAt ?? null,
    deletedReason: p.deletedReason ?? null,
    deletedByName: p.deletedByName ?? null,
    purgeEligibleAt: p.purgeEligibleAt ?? null,
    updatedAt: p.updatedAt,
  };
}

function log(p: ProjectDetail, action: string, summary: string): void {
  p.activity.unshift({
    id: uid(),
    action,
    summary,
    actorName: ACTOR,
    createdAt: new Date().toISOString(),
  });
  p.updatedAt = new Date().toISOString();
}

function mutate<T>(id: string, fn: (p: ProjectDetail, rows: ProjectDetail[]) => T): T {
  const rows = load();
  const p = rows.find((r) => r.id === id);
  if (!p) throw new Error("NOT_FOUND");
  const result = fn(p, rows);
  save(rows);
  return result;
}

/**
 * Resolve contractor-config input into display items by reading the demo
 * contractor + labour-subcategory stores. Dedupes contractors + labour types and
 * drops any whose contractor/subcategory no longer exists (parity with the
 * server's company-ownership validation).
 */
async function resolveContractors(
  rows: ProjectContractorInput[],
): Promise<ProjectContractorItem[]> {
  const [contractors, categories] = await Promise.all([
    demoContractorsRepository.listContractors({}),
    demoLaborRepository.listCategories(),
  ]);
  const cById = new Map(contractors.map((c) => [c.id, c]));
  const subInfo = new Map<
    string,
    { name: string; categoryId: string; categoryName: string }
  >();
  for (const cat of categories)
    for (const s of cat.subcategories)
      subInfo.set(s.id, { name: s.name, categoryId: cat.id, categoryName: cat.name });

  const seenContractor = new Set<string>();
  const items: ProjectContractorItem[] = [];
  for (const r of rows) {
    const contractor = cById.get(r.contractorId);
    if (!contractor || seenContractor.has(r.contractorId)) continue;
    seenContractor.add(r.contractorId);
    const seenSub = new Set<string>();
    const labourRates = [];
    for (const lr of r.labourRates) {
      const info = subInfo.get(lr.labourSubcategoryId);
      if (!info || seenSub.has(lr.labourSubcategoryId)) continue;
      seenSub.add(lr.labourSubcategoryId);
      labourRates.push({
        id: uid(),
        labourSubcategoryId: lr.labourSubcategoryId,
        subcategoryName: info.name,
        categoryId: info.categoryId,
        categoryName: info.categoryName,
        ratePaise: Math.max(0, Math.round(lr.ratePaise || 0)),
        rateUnit: lr.rateUnit ?? "day",
      });
    }
    items.push({
      id: uid(),
      contractorId: contractor.id,
      contractorName: contractor.name,
      contractRatePaise: r.contractRatePaise ?? null,
      contractRateUnit: r.contractRateUnit ?? null,
      labourRates,
    });
  }
  return items;
}

export const demoRepository: ProjectsRepository = {
  async list(filters: ProjectFilters = {}) {
    let rows = load();
    if (filters.includeDeleted) {
      rows = rows.filter((p) => p.deletedAt);
    } else {
      rows = rows.filter((p) => !p.deletedAt);
      if (!filters.includeArchived) rows = rows.filter((p) => !p.archivedAt);
    }
    if (filters.favoritesOnly) rows = rows.filter((p) => p.isFavorite);
    if (filters.stage && filters.stage !== "ALL")
      rows = rows.filter((p) => p.stage === filters.stage);
    if (filters.type && filters.type !== "ALL")
      rows = rows.filter((p) => p.type === filters.type);
    if (filters.pmId && filters.pmId !== "ALL")
      rows = rows.filter((p) => p.pm?.id === filters.pmId);
    if (filters.tag && filters.tag !== "ALL")
      rows = rows.filter((p) => p.tags.includes(filters.tag!));
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (filters.deadline && filters.deadline !== "ALL") {
      const today = todayISO();
      rows = rows.filter((p) =>
        matchesDeadline(p.expectedCompletionDate, p.stage, filters.deadline!, today),
      );
    }
    const sorted =
      filters.sort === "DEADLINE"
        ? rows
            .slice()
            .sort((a, b) => byDeadlineAsc(a, b) || b.updatedAt.localeCompare(a.updatedAt))
        : rows.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const retention = loadRetention();
    return sorted.map((p) => {
      const item = toItem(p);
      if (filters.includeDeleted) {
        item.purgeEligibleAt = purgeEligibleAt(p.deletedAt, retention)?.toISOString() ?? null;
      }
      return item;
    });
  },

  async get(id) {
    const p = load().find((x) => x.id === id);
    if (!p) return null;
    const spend = demoProjectSpend(id);
    return {
      ...p,
      usedPaise: spend.laborPaise + spend.procurementPaise,
      // Backward-compat for projects persisted before this feature existed.
      contractors: p.contractors ?? [],
    };
  },

  async create(input: CreateProjectInput) {
    const rows = load();
    const nowIso = new Date().toISOString();
    const pm = input.pmId
      ? DEMO_MANAGERS.find((m) => m.id === input.pmId) ?? null
      : null;
    const project: ProjectDetail = {
      id: uid(),
      code: input.code ?? nextCode(rows),
      name: input.name,
      type: input.type,
      stage: "CREATED",
      budgetPaise: input.budgetPaise,
      contractValuePaise: input.contractValuePaise,
      procurementBudgetPaise: input.procurementBudgetPaise ?? null,
      usedPaise: 0,
      startDate: input.startDate ?? null,
      expectedCompletionDate: input.expectedCompletionDate ?? null,
      pm,
      tags: input.tags ?? [],
      isFavorite: false,
      archivedAt: null,
      deletedAt: null,
      updatedAt: nowIso,
      createdAt: nowIso,
      clientName: input.clientName ?? null,
      clientContact: input.clientContact ?? null,
      clientPhone: input.clientPhone ?? null,
      clientEmail: input.clientEmail ?? null,
      siteAddress: input.siteAddress ?? null,
      gpsLat: input.gpsLat ?? null,
      gpsLng: input.gpsLng ?? null,
      deadlines: [],
      documents: [],
      notes: [],
      activity: [],
      contractors: [],
    };
    if (input.contractors && input.contractors.length > 0) {
      project.contractors = await resolveContractors(input.contractors);
    }
    log(project, "project.created", "created the project");
    rows.push(project);
    save(rows);
    return project;
  },

  async update(id, patch: UpdateProjectInput) {
    return mutate(id, (p) => {
      Object.assign(p, {
        ...patch,
        pm:
          patch.pmId !== undefined
            ? DEMO_MANAGERS.find((m) => m.id === patch.pmId) ?? null
            : p.pm,
      });
      log(p, "project.updated", "updated project details");
      return p;
    });
  },

  async changeStage(id, stage: ProjectStage) {
    return mutate(id, (p) => {
      p.stage = stage;
      log(p, "stage.changed", `advanced to ${STAGE_LABEL[stage]}`);
      return toItem(p);
    });
  },

  async assignManager(id, pmId) {
    return mutate(id, (p) => {
      p.pm = pmId ? DEMO_MANAGERS.find((m) => m.id === pmId) ?? null : null;
      log(p, "pm.assigned", p.pm ? `assigned ${p.pm.fullName}` : "unassigned manager");
      return toItem(p);
    });
  },

  async duplicate(id) {
    const rows = load();
    const src = rows.find((p) => p.id === id);
    if (!src) throw new Error("NOT_FOUND");
    const nowIso = new Date().toISOString();
    const copy: ProjectDetail = {
      ...structuredClone(src),
      id: uid(),
      code: nextCode(rows),
      name: `${src.name} (copy)`,
      stage: "CREATED",
      isFavorite: false,
      archivedAt: null,
      usedPaise: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      deadlines: [],
      documents: [],
      notes: [],
      activity: [],
    };
    log(copy, "project.duplicated", `duplicated from ${src.code}`);
    rows.push(copy);
    save(rows);
    return copy;
  },

  async setArchived(id, archived) {
    return mutate(id, (p) => {
      p.archivedAt = archived ? new Date().toISOString() : null;
      log(p, archived ? "project.archived" : "project.restored", archived ? "archived the project" : "restored the project");
      return toItem(p);
    });
  },

  async remove(id, confirm) {
    // Demo has no real auth to re-verify; mirror prod behaviour with a soft
    // delete so the recycle bin + restore work end-to-end in the sandbox.
    mutate(id, (p) => {
      p.deletedAt = new Date().toISOString();
      p.deletedReason = (confirm?.reason ?? "").trim() || null;
      p.deletedByName = ACTOR;
      log(p, "project.deleted", `deleted project ${p.code} — ${p.name}`);
    });
  },

  async restore(id) {
    return mutate(id, (p) => {
      p.deletedAt = null;
      p.deletedReason = null;
      p.deletedByName = null;
      log(p, "project.recovered", `restored project ${p.code} — ${p.name}`);
      return toItem(p);
    });
  },

  async getRetention() {
    return loadRetention();
  },

  async setRetention(days) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RETENTION_KEY, days == null ? "null" : String(days));
    }
    return days;
  },

  async toggleFavorite(id) {
    return mutate(id, (p) => {
      p.isFavorite = !p.isFavorite;
      return p.isFavorite;
    });
  },

  async addDeadline(projectId, title, dueDate) {
    return mutate(projectId, (p) => {
      p.deadlines.push({ id: uid(), title, dueDate, completedAt: null });
      log(p, "deadline.added", `added deadline "${title}"`);
      return p;
    });
  },

  async toggleDeadline(projectId, deadlineId) {
    return mutate(projectId, (p) => {
      const d = p.deadlines.find((x) => x.id === deadlineId);
      if (d) d.completedAt = d.completedAt ? null : new Date().toISOString();
      return p;
    });
  },

  async removeDeadline(projectId, deadlineId) {
    return mutate(projectId, (p) => {
      p.deadlines = p.deadlines.filter((x) => x.id !== deadlineId);
      return p;
    });
  },

  async addNote(projectId, body) {
    return mutate(projectId, (p) => {
      p.notes.unshift({
        id: uid(),
        body,
        authorName: ACTOR,
        createdAt: new Date().toISOString(),
        clientUuid: uid(),
      });
      log(p, "note.added", "added a note");
      return p;
    });
  },

  async addDocument(projectId, doc) {
    return mutate(projectId, (p) => {
      const category = doc.mimeType.startsWith("image/")
        ? "PHOTO"
        : doc.mimeType === "application/pdf"
          ? "PDF"
          : "OTHER";
      p.documents.unshift({
        id: uid(),
        category,
        filename: doc.filename,
        sizeBytes: doc.sizeBytes,
        mimeType: doc.mimeType,
        createdAt: new Date().toISOString(),
        uploadedByName: ACTOR,
      });
      log(p, "document.added", `uploaded ${doc.filename}`);
      return p;
    });
  },

  async removeDocument(projectId, docId) {
    return mutate(projectId, (p) => {
      p.documents = p.documents.filter((d) => d.id !== docId);
      return p;
    });
  },

  async listManagers() {
    return DEMO_MANAGERS;
  },

  async listProjectContractors(projectId) {
    const p = load().find((x) => x.id === projectId);
    return p?.contractors ?? [];
  },

  async setProjectContractors(projectId, rows) {
    const resolved = await resolveContractors(rows);
    return mutate(projectId, (p) => {
      p.contractors = resolved;
      const labourTypeCount = resolved.reduce((s, c) => s + c.labourRates.length, 0);
      log(
        p,
        "project.contractors_updated",
        resolved.length === 0
          ? "cleared project contractors"
          : `set ${resolved.length} contractor${resolved.length === 1 ? "" : "s"} (${labourTypeCount} labour type${labourTypeCount === 1 ? "" : "s"})`,
      );
      return resolved;
    });
  },
};
