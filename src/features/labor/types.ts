/** Category-based labour domain (client change request). An attendance record
 *  is a headcount per labour category per project per date — no individual
 *  worker tracking. Money is integer paise. */

export interface LabourCategory {
  id: string;
  name: string;
  color: string; // hex
  /** Optional category-level day rate for labor-cost ESTIMATES (rate × headcount). */
  dailyRatePaise: number | null;
}

export interface CreateCategoryInput {
  name: string;
  color: string;
  dailyRatePaise?: number | null;
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

/** One category row on the daily sheet. quantity 0 = not recorded.
 *  dailyRatePaise is the EFFECTIVE rate: the record's snapshot when recorded,
 *  else the category's current rate (used for new entries). */
export interface SheetRow {
  categoryId: string;
  name: string;
  color: string;
  dailyRatePaise: number | null;
  quantity: number;
  notes: string | null;
}

export interface AttendanceSheet {
  projectId: string;
  date: string; // YYYY-MM-DD
  rows: SheetRow[];
  totalPresent: number;
  estimatedCostPaise: number;
}

/** Flat record for range views and exports. Cost is the stored snapshot-based
 *  value (quantity × rate-at-record-time) — immutable history (ADR-0022). */
export interface AttendanceRecordItem {
  id: string;
  projectId: string;
  projectName: string;
  date: string;
  categoryId: string;
  categoryName: string;
  color: string;
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

export interface CategoryManDays {
  categoryId: string;
  name: string;
  color: string;
  manDays: number;
  estimatedCostPaise: number;
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
