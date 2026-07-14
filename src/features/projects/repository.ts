import type {
  CreateProjectInput,
  ProjectDetail,
  ProjectFilters,
  ProjectListItem,
  ProjectStage,
  Manager,
  UpdateProjectInput,
} from "./types";

/**
 * The projects data contract. Two implementations satisfy it:
 *  - demo (client, localStorage-backed) — used in demo mode
 *  - server (Prisma + RLS, via server actions) — used with Supabase configured
 * The UI depends only on this interface (clean architecture).
 */
export interface ProjectsRepository {
  list(filters?: ProjectFilters): Promise<ProjectListItem[]>;
  get(id: string): Promise<ProjectDetail | null>;
  create(input: CreateProjectInput): Promise<ProjectDetail>;
  update(id: string, patch: UpdateProjectInput): Promise<ProjectDetail>;
  changeStage(id: string, stage: ProjectStage): Promise<ProjectListItem>;
  assignManager(id: string, pmId: string | null): Promise<ProjectListItem>;
  duplicate(id: string): Promise<ProjectDetail>;
  setArchived(id: string, archived: boolean): Promise<ProjectListItem>;
  remove(id: string): Promise<void>;
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
}
