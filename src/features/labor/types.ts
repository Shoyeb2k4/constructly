/** Category → Subcategory labour domain (ADR-0023). Attendance is a headcount
 *  per SUBCATEGORY per project per date — no individual worker tracking.
 *  Money is integer paise; costs are stored rate snapshots (ADR-0022). */

export interface LabourCategory {
  id: string;
  name: string;
  color: string | null;
  displayOrder: number;
}

export interface LabourSubcategory {
  id: string;
  categoryId: string;
  name: string;
  /** Optional day rate used only for labour-cost ESTIMATES (rate × headcount). */
  dailyRatePaise: number | null;
  displayOrder: number;
}

export interface CategoryWithSubs extends LabourCategory {
  subcategories: LabourSubcategory[];
}

export interface CreateCategoryInput {
  name: string;
  color?: string | null;
}
export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export interface CreateSubcategoryInput {
  categoryId: string;
  name: string;
  dailyRatePaise?: number | null;
}
/** categoryId in the patch moves the subcategory to another category. */
export type UpdateSubcategoryInput = Partial<CreateSubcategoryInput>;

/* ── Owner Force Delete ──────────────────────────────────────────────── */

export type ForceDeleteKind = "category" | "subcategory";

/**
 * Impact preview for an Owner Force Delete. `remove*` counts are the current
 * master/config rows that will be deactivated or deleted; `*Preserved` counts
 * are the historical/financial records that survive untouched (labour history
 * stays readable via the deactivated — not physically deleted — master row).
 */
export interface ForceDeleteImpact {
  kind: ForceDeleteKind;
  id: string;
  name: string;
  /** Labour groups removed (1 for a category, 0 for a single labour type). */
  labourGroups: number;
  /** Labour types (subcategories) deactivated. */
  labourTypes: number;
  /** Project-contractor rate configurations that will be removed. */
  projectContractorRates: number;
  /** Project-contractor category assignments that will be removed (category only). */
  projectContractorAssignments: number;
  /** Attendance records preserved as read-only history. */
  attendancePreserved: number;
  /** Contractor settlements preserved on affected projects. */
  settlementsPreserved: number;
  /** Distinct projects touched by the removed configuration. */
  projectsAffected: number;
}

/* ── Attendance sheet (contractor-first) ─────────────────────────────── */

/**
 * One labour-type (subcategory) row under a contractor, for ONE agreement.
 *
 * `contractId` is part of the row's IDENTITY, not decoration: a contractor
 * holding two agreements on a project can record the same labour type on the
 * same date under each, and the two rows must never overwrite or clear one
 * another. Every write path carries it.
 *
 * quantity 0 = not recorded. dailyRatePaise is the EFFECTIVE rate: the record's
 * snapshot when already recorded, else the rate resolved for THIS date.
 */
export interface SheetRow {
  subcategoryId: string;
  name: string;
  /** Owning trade category — retained for reports/exports, not for grouping. */
  categoryId: string;
  categoryName: string;
  /** The agreement this row belongs to. null = attendance-only (legacy path). */
  contractId: string | null;
  /** Denormalised agreement name, for display and exports. */
  agreementTitle: string | null;
  dailyRatePaise: number | null;
  quantity: number;
  notes: string | null;
}

/** A commercial agreement a contractor can record labour against on this project. */
export interface SheetAgreement {
  contractId: string;
  title: string;
  reference: string | null;
  status: string;
}

/** A contractor group: the contractor and the labour types they supply on this
 *  project. `configured` is false for a synthesized group holding rows recorded
 *  against a contractor/type no longer configured (or legacy unattributed rows,
 *  contractorId null) — kept visible so history can be seen and cleared. */
export interface SheetGroup {
  contractorId: string | null;
  contractorName: string;
  /** Optional project agreement rate (₹/sq.ft etc.) — display only. */
  contractRatePaise: number | null;
  contractRateUnit: string | null;
  configured: boolean;
  /**
   * True when the contractor is archived. Their already-recorded rows still
   * show (and stay correctable); no blank rows are offered, because the server
   * refuses new attendance for them.
   */
  archived: boolean;
  /**
   * Agreements eligible to take attendance today. Empty = the attendance-only
   * contractor, whose flow is unchanged.
   */
  agreements: SheetAgreement[];
  /**
   * True when two or more agreements are eligible. The UI must make the user
   * pick one before agreement-linked entry — the system never guesses which
   * agreement a day's labour belongs to.
   */
  requiresAgreementChoice: boolean;
  rows: SheetRow[];
  totalPresent: number;
  estimatedCostPaise: number;
}

export interface AttendanceSheet {
  projectId: string;
  date: string; // YYYY-MM-DD
  groups: SheetGroup[];
  totalPresent: number;
  estimatedCostPaise: number;
}

/* ── Records, filters, summaries ─────────────────────────────────────── */

/** Flat record for range views and exports. Cost is the stored snapshot-based
 *  value (quantity × rate-at-record-time) — immutable history. */
export interface AttendanceRecordItem {
  id: string;
  projectId: string;
  projectName: string;
  date: string;
  categoryId: string;
  categoryName: string;
  color: string | null;
  subcategoryId: string;
  subcategoryName: string;
  /** Contractor the labour was attributed to (null = legacy/unattributed). */
  contractorId: string | null;
  contractorName: string | null;
  /** Agreement the labour was attributed to (null = attendance-only). */
  contractId: string | null;
  agreementTitle: string | null;
  quantityPresent: number;
  dailyRatePaiseSnapshot: number | null;
  estimatedCostPaise: number;
  notes: string | null;
}

/**
 * One attendance write. Passed as an object rather than positionally because
 * the row IDENTITY is five fields — project, date, labour type, contractor and
 * AGREEMENT — and a positional call that quietly omits the last one would write
 * to, or clear, another agreement's row.
 */
export interface SetQuantityInput {
  projectId: string;
  /** YYYY-MM-DD. Also the date the rate is resolved as at. */
  date: string;
  subcategoryId: string;
  /** 0 clears the row. Half-days allowed in 0.5 steps. */
  quantity: number;
  notes?: string | null;
  contractorId?: string | null;
  /** The agreement this row belongs to. null = attendance-only (legacy path). */
  contractId?: string | null;
}

export interface AttendanceFilters {
  projectId?: string | "ALL";
  from?: string;
  to?: string;
}

export interface SubcategoryManDays {
  subcategoryId: string;
  name: string;
  manDays: number;
  estimatedCostPaise: number;
}

export interface CategoryManDays {
  categoryId: string;
  name: string;
  color: string | null;
  manDays: number;
  estimatedCostPaise: number;
  subcategories: SubcategoryManDays[];
}

export interface LabourTrendPoint {
  date: string;
  total: number;
}

/** Man-days + cost rolled up per contractor (contractor-first summary). */
export interface ContractorManDays {
  contractorId: string | null;
  name: string;
  manDays: number;
  estimatedCostPaise: number;
}

export interface LabourSummary {
  totalManDays: number;
  estimatedCostPaise: number;
  byContractor: ContractorManDays[];
  byCategory: CategoryManDays[];
  byProject: { projectId: string; projectName: string; manDays: number; estimatedCostPaise: number }[];
  trend: LabourTrendPoint[];
}
