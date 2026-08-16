import { call } from "@/lib/mobile/rpc";
import type { ProjectsRepository, DuplicateCodeResult } from "./repository";
import type {
  ProjectContractorInput,
  CreateProjectInput,
  ProjectContractorItem,
  ProjectDetail,
  ProjectFilters,
  ProjectListItem,
  ProjectStage,
  Manager,
  UpdateProjectInput,
} from "./types";

/**
 * The third implementation of `ProjectsRepository` (alongside `demo/` and the
 * Server-Action-backed `server/`), used by the native app.
 *
 * It is a pure transport adapter: every method forwards to the identically
 * named entry in the mobile RPC allowlist, which invokes the same server action
 * the web app uses. No query logic, no authorization, no formatting — anything
 * that looks like business logic in here would be a bug.
 */
export const httpProjectsRepository: ProjectsRepository = {
  list: (filters?: ProjectFilters) => call<ProjectListItem[]>("projects", "list", [filters ?? {}]),
  get: (id) => call<ProjectDetail | null>("projects", "get", [id]),
  create: (input: CreateProjectInput) =>
    call<ProjectDetail | DuplicateCodeResult>("projects", "create", [input]),
  update: (id, patch: UpdateProjectInput) =>
    call<ProjectDetail>("projects", "update", [id, patch]),
  changeStage: (id, stage: ProjectStage) =>
    call<ProjectListItem>("projects", "changeStage", [id, stage]),
  assignManager: (id, pmId) => call<ProjectListItem>("projects", "assignManager", [id, pmId]),
  duplicate: (id) => call<ProjectDetail>("projects", "duplicate", [id]),
  setArchived: (id, archived) => call<ProjectListItem>("projects", "setArchived", [id, archived]),
  remove: (id, confirm) => call<void>("projects", "remove", [id, confirm]),
  restore: (id) => call<ProjectListItem>("projects", "restore", [id]),
  getRetention: () => call<number | null>("projects", "getRetention"),
  setRetention: (days) => call<number | null>("projects", "setRetention", [days]),
  toggleFavorite: (id) => call<boolean>("projects", "toggleFavorite", [id]),

  addDeadline: (projectId, title, dueDate) =>
    call<ProjectDetail>("projects", "addDeadline", [projectId, title, dueDate]),
  toggleDeadline: (projectId, deadlineId) =>
    call<ProjectDetail>("projects", "toggleDeadline", [projectId, deadlineId]),
  removeDeadline: (projectId, deadlineId) =>
    call<ProjectDetail>("projects", "removeDeadline", [projectId, deadlineId]),

  addNote: (projectId, body) => call<ProjectDetail>("projects", "addNote", [projectId, body]),
  addDocument: (projectId, doc) =>
    call<ProjectDetail>("projects", "addDocument", [projectId, doc]),
  removeDocument: (projectId, docId) =>
    call<ProjectDetail>("projects", "removeDocument", [projectId, docId]),

  listManagers: () => call<Manager[]>("projects", "listManagers"),

  listProjectContractors: (projectId) =>
    call<ProjectContractorItem[]>("projects", "listProjectContractors", [projectId]),
  setProjectContractors: (projectId, rows: ProjectContractorInput[]) =>
    call<ProjectContractorItem[]>("projects", "setProjectContractors", [projectId, rows]),
};
