import type { ContractorRemovalBlocker } from "./contractor-removal";
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

/** A create that failed because the explicit code is already taken. Returned
 *  (not thrown) so it survives the Server Action boundary — thrown error
 *  messages are masked in production, which would surface as a raw 500. */
export type DuplicateCodeResult = { duplicateCode: true };

/**
 * The projects data contract. Two implementations satisfy it:
 *  - demo (client, localStorage-backed) — used in demo mode
 *  - server (Prisma + RLS, via server actions) — used with Supabase configured
 * The UI depends only on this interface (clean architecture).
 */
export interface ProjectsRepository {
  list(filters?: ProjectFilters): Promise<ProjectListItem[]>;
  get(id: string): Promise<ProjectDetail | null>;
  create(input: CreateProjectInput): Promise<ProjectDetail | DuplicateCodeResult>;
  update(id: string, patch: UpdateProjectInput): Promise<ProjectDetail>;
  changeStage(id: string, stage: ProjectStage): Promise<ProjectListItem>;
  assignManager(id: string, pmId: string | null): Promise<ProjectListItem>;
  duplicate(id: string): Promise<ProjectDetail>;
  setArchived(id: string, archived: boolean): Promise<ProjectListItem>;
  remove(id: string, confirm: { password: string; reason?: string | null }): Promise<void>;
  restore(id: string): Promise<ProjectListItem>;
  getRetention(): Promise<number | null>;
  setRetention(days: number | null): Promise<number | null>;
  toggleFavorite(id: string): Promise<boolean>;

  addDeadline(projectId: string, title: string, dueDate: string): Promise<ProjectDetail>;
  toggleDeadline(projectId: string, deadlineId: string): Promise<ProjectDetail>;
  removeDeadline(projectId: string, deadlineId: string): Promise<ProjectDetail>;

  addNote(projectId: string, body: string): Promise<ProjectDetail>;
  addDocument(
    projectId: string,
    doc: { filename: string; sizeBytes: number; mimeType: string },
  ): Promise<ProjectDetail>;
  removeDocument(projectId: string, docId: string): Promise<ProjectDetail>;

  listManagers(): Promise<Manager[]>;

  /** Project → contractors (with the labour types + project rates they supply). */
  listProjectContractors(projectId: string): Promise<ProjectContractorItem[]>;
  /** Transactional replace-all of a project's contractor config. */
  setProjectContractors(
    projectId: string,
    rows: ProjectContractorInput[],
  ): Promise<ProjectContractorItem[] | { blockedRemovals: ContractorRemovalBlocker[] }>;
}
