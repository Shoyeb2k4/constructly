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
  /** Soft-delete metadata. deletedAt !== null ⇒ in the Owner's recycle bin. */
  deletedAt: string | null;
  deletedReason?: string | null;
  deletedByName?: string | null;
  /** When a soft-deleted project becomes eligible for admin cleanup (retention
   *  policy). null = deleted-but-indefinite, or the project isn't deleted. */
  purgeEligibleAt?: string | null;
  updatedAt: string;
}

/** One labour type a contractor supplies on a project, with its project-specific
 *  rate. Reuses the LabourSubcategory taxonomy (Mason, Helper, Centering, …). */
export interface ProjectContractorLabourRateItem {
  id: string;
  labourSubcategoryId: string;
  subcategoryName: string;
  categoryId: string;
  categoryName: string;
  ratePaise: number;
  rateUnit: string;
}

/** A contractor engaged on a project (contractor-first config). The contractor
 *  is the top-level grouping the Labour module presents; the labour types they
 *  supply hang off `labourRates`. `contractRatePaise` is an OPTIONAL project
 *  agreement figure (₹/sq.ft) — display only, never billed from attendance. */
export interface ProjectContractorItem {
  id: string;
  contractorId: string;
  contractorName: string;
  contractRatePaise: number | null;
  contractRateUnit: string | null;
  labourRates: ProjectContractorLabourRateItem[];
}

/** Write shape: a labour type + project rate under a contractor. */
export interface ProjectContractorLabourRateInput {
  labourSubcategoryId: string;
  ratePaise: number;
  rateUnit?: string;
}

/** Write shape: a contractor engaged on a project + the labour types they supply. */
export interface ProjectContractorInput {
  contractorId: string;
  contractRatePaise?: number | null;
  contractRateUnit?: string | null;
  labourRates: ProjectContractorLabourRateInput[];
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
  contractors: ProjectContractorItem[];
}

/** Project list sort modes. RECENT (last updated) is the default. */
export type ProjectSort = "RECENT" | "DEADLINE";

export interface ProjectFilters {
  search?: string;
  stage?: ProjectStage | "ALL";
  type?: ProjectType | "ALL";
  pmId?: string | "ALL";
  tag?: string | "ALL";
  includeArchived?: boolean;
  /** Owner-only: show the soft-deleted "recycle bin" instead of live projects. */
  includeDeleted?: boolean;
  favoritesOnly?: boolean;
  /** Deadline (expected-completion) window: overdue / today / this week / this month. */
  deadline?: "ALL" | "OVERDUE" | "TODAY" | "WEEK" | "MONTH";
  sort?: ProjectSort;
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
  /** Contractors (with their labour types + project rates) to engage on the
   *  project at creation time. */
  contractors?: ProjectContractorInput[];
}

export type UpdateProjectInput = Partial<CreateProjectInput>;
