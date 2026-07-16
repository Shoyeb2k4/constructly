import type {
  AttendanceFilters,
  AttendanceRecordItem,
  AttendanceSheet,
  CreateCategoryInput,
  LabourCategory,
  LabourSummary,
  UpdateCategoryInput,
} from "./types";

/**
 * Category-based labour data contract. Demo (localStorage) and server
 * (Prisma + RLS) implementations satisfy it; the UI depends only here.
 */
export interface LaborRepository {
  // Categories
  listCategories(): Promise<LabourCategory[]>;
  createCategory(input: CreateCategoryInput): Promise<LabourCategory>;
  updateCategory(id: string, patch: UpdateCategoryInput): Promise<LabourCategory>;
  /** Cascades: removes the category's attendance rows too (UI confirms). */
  deleteCategory(id: string): Promise<void>;

  // Attendance (one row per project + date + category)
  getSheet(projectId: string, date: string): Promise<AttendanceSheet>;
  /** Upsert a headcount; quantity 0 deletes the row. */
  setQuantity(
    projectId: string,
    date: string,
    categoryId: string,
    quantity: number,
    notes?: string | null,
  ): Promise<AttendanceSheet>;
  copyPreviousDay(projectId: string, date: string): Promise<AttendanceSheet>;

  // Range views, reports, exports
  listAttendance(filters: AttendanceFilters): Promise<AttendanceRecordItem[]>;
  summary(filters: AttendanceFilters): Promise<LabourSummary>;
}
