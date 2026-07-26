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

/* ── Attendance sheet (grouped by category) ──────────────────────────── */

/** One subcategory row. quantity 0 = not recorded. dailyRatePaise is the
 *  EFFECTIVE rate: the record's snapshot when recorded, else current. */
export interface SheetRow {
  subcategoryId: string;
  name: string;
  dailyRatePaise: number | null;
  quantity: number;
  notes: string | null;
  contractorId: string | null;
}

export interface SheetGroup {
  categoryId: string;
  name: string;
  color: string | null;
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
  /** Contractor attributed for this sheet (first attributed row), if any. */
  contractorId: string | null;
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

export interface LabourSummary {
  totalManDays: number;
  estimatedCostPaise: number;
  byCategory: CategoryManDays[];
  byProject: { projectId: string; projectName: string; manDays: number; estimatedCostPaise: number }[];
  trend: LabourTrendPoint[];
}
