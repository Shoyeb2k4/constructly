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

/* ── Attendance sheet (contractor-first) ─────────────────────────────── */

/** One labour-type (subcategory) row under a contractor. quantity 0 = not
 *  recorded. dailyRatePaise is the EFFECTIVE rate: the record's snapshot when
 *  recorded, else the project+contractor configured rate. */
export interface SheetRow {
  subcategoryId: string;
  name: string;
  /** Owning trade category — retained for reports/exports, not for grouping. */
  categoryId: string;
  categoryName: string;
  dailyRatePaise: number | null;
  quantity: number;
  notes: string | null;
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
  quantityPresent: number;
  dailyRatePaiseSnapshot: number | null;
  estimatedCostPaise: number;
  notes: string | null;
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
