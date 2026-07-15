import type { ProjectsRepository } from "../repository";
import type {
  CreateProjectInput,
  ProjectDetail,
  ProjectFilters,
  ProjectListItem,
  ProjectStage,
  UpdateProjectInput,
} from "../types";
import { STAGE_LABEL } from "../constants";
import { demoSeed, DEMO_MANAGERS } from "./seed";
import { demoProjectSpend } from "@/features/budget/spend";

const KEY = "constructly.demo.projects.v1";
const ACTOR = "Aarav Mehta";

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
    usedPaise: spend.laborPaise + spend.procurementPaise,
    startDate: p.startDate,
    expectedCompletionDate: p.expectedCompletionDate,
    pm: p.pm,
    tags: p.tags,
    isFavorite: p.isFavorite,
    archivedAt: p.archivedAt,
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

export const demoRepository: ProjectsRepository = {
  async list(filters: ProjectFilters = {}) {
    let rows = load();
    if (!filters.includeArchived) rows = rows.filter((p) => !p.archivedAt);
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
    return rows
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toItem);
  },

  async get(id) {
    const p = load().find((x) => x.id === id);
    if (!p) return null;
    const spend = demoProjectSpend(id);
    return { ...p, usedPaise: spend.laborPaise + spend.procurementPaise };
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
      usedPaise: 0,
      startDate: input.startDate ?? null,
      expectedCompletionDate: input.expectedCompletionDate ?? null,
      pm,
      tags: input.tags ?? [],
      isFavorite: false,
      archivedAt: null,
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
    };
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

  async remove(id) {
    save(load().filter((p) => p.id !== id));
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
};
