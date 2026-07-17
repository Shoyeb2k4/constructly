/** Project-management domain types (DTOs). Money is integer paise as `number`
 *  at this boundary — the Prisma layer stores BigInt and converts on the way out. */

export type ProjectType =
  | "RESIDENTIAL"
  | "COMMERCIAL"
  | "INDUSTRIAL"
  | "INFRASTRUCTURE"
  | "RENOVATION"
  | "INTERIOR_FITOUT";

export type ProjectStage =
  | "CREATED"
  | "PLANNING"
  | "ESTIMATION"
  | "PROCUREMENT"
  | "CONSTRUCTION"
  | "QUALITY_INSPECTION"
  | "COMPLETION"
  | "HANDOVER"
  | "CLOSED";

export type DocumentCategory = "DRAWING" | "PDF" | "PHOTO" | "CONTRACT" | "OTHER";

export interface Manager {
  id: string;
  fullName: string;
}

export interface Deadline {
  id: string;
  title: string;
  dueDate: string; // ISO date
  completedAt: string | null;
}

export interface ProjectDocument {
  id: string;
  category: DocumentCategory;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
  uploadedByName?: string;
}

export interface Note {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  clientUuid: string;
}

export interface ActivityEntry {
  id: string;
  action: string;
  summary: string;
  actorName?: string;
  createdAt: string;
}

export interface ProjectListItem {
  id: string;
  code: string;
  name: string;
  type: ProjectType;
  stage: ProjectStage;
  budgetPaise: number;
  contractValuePaise: number;
  /** Dedicated procurement budget (independent of budgetPaise). Null = not set. */
  procurementBudgetPaise: number | null;
  /** Derived spend (POs + labor). 0 until Modules 2–3; demo seeds realistic values. */
  usedPaise: number;
  startDate: string | null;
  expectedCompletionDate: string | null;
  pm: Manager | null;
  tags: string[];
  isFavorite: boolean;
  archivedAt: string | null;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectListItem {
  clientName: string | null;
  clientContact: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  siteAddress: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  createdAt: string;
  deadlines: Deadline[];
  documents: ProjectDocument[];
  notes: Note[];
  activity: ActivityEntry[];
}

export interface ProjectFilters {
  search?: string;
  stage?: ProjectStage | "ALL";
  type?: ProjectType | "ALL";
  pmId?: string | "ALL";
  tag?: string | "ALL";
  includeArchived?: boolean;
  favoritesOnly?: boolean;
}

export interface CreateProjectInput {
  name: string;
  code?: string;
  type: ProjectType;
  clientName?: string | null;
  clientContact?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  siteAddress?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  budgetPaise: number;
  contractValuePaise: number;
  procurementBudgetPaise?: number | null;
  startDate?: string | null;
  expectedCompletionDate?: string | null;
  pmId?: string | null;
  tags?: string[];
}

export type UpdateProjectInput = Partial<CreateProjectInput>;
