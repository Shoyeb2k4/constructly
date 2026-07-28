import { isDemoMode } from "@/lib/env";
import type { ProjectsRepository } from "./repository";
import { demoRepository } from "./demo/demo-repository";
import * as server from "./server/actions";
import type { ProjectFilters } from "./types";

/**
 * Resolves the active data source. Demo mode uses the client-side repository;
 * otherwise calls the Prisma-backed server actions (RPC). The UI only ever
 * touches `projectsApi` — swapping backends changes nothing above this line.
 */
const serverRepository: ProjectsRepository = {
  list: server.listProjects,
  get: server.getProject,
  create: server.createProject,
  update: server.updateProject,
  changeStage: server.changeStage,
  assignManager: server.assignManager,
  duplicate: server.duplicateProject,
  setArchived: server.setArchived,
  remove: server.removeProject,
  restore: server.restoreProject,
  getRetention: server.getProjectRetention,
  setRetention: server.setProjectRetention,
  toggleFavorite: server.toggleFavorite,
  addDeadline: server.addDeadline,
  toggleDeadline: server.toggleDeadline,
  removeDeadline: server.removeDeadline,
  addNote: server.addNote,
  addDocument: server.addDocument,
  removeDocument: server.removeDocument,
  listManagers: server.listManagers,
};

export const projectsApi: ProjectsRepository = isDemoMode
  ? demoRepository
  : serverRepository;

export const projectKeys = {
  all: ["projects"] as const,
  lists: ["projects", "list"] as const,
  list: (filters?: ProjectFilters) => ["projects", "list", filters ?? {}] as const,
  detail: (id: string) => ["projects", "detail", id] as const,
  managers: ["projects", "managers"] as const,
  retention: ["projects", "retention"] as const,
};
