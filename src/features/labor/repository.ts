import type {
  AttendanceFilters,
  AttendanceRecordItem,
  AttendanceSheet,
  CategoryWithSubs,
  CreateCategoryInput,
  CreateSubcategoryInput,
  LabourCategory,
  LabourSubcategory,
  LabourSummary,
  UpdateCategoryInput,
  UpdateSubcategoryInput,
} from "./types";

/**
 * Category → Subcategory labour data contract (ADR-0023). Demo (localStorage)
 * and server (Prisma + RLS) implementations satisfy it.
 */
export interface LaborRepository {
  // Hierarchy
  listCategories(): Promise<CategoryWithSubs[]>;
  createCategory(input: CreateCategoryInput): Promise<LabourCategory>;
  updateCategory(id: string, patch: UpdateCategoryInput): Promise<LabourCategory>;
  /** Cascades: removes subcategories and their attendance (UI confirms). */
  deleteCategory(id: string): Promise<void>;
  reorderCategories(orderedIds: string[]): Promise<void>;

  createSubcategory(input: CreateSubcategoryInput): Promise<LabourSubcategory>;
  /** categoryId in the patch moves the subcategory to another category. */
  updateSubcategory(id: string, patch: UpdateSubcategoryInput): Promise<LabourSubcategory>;
  /** Cascades: removes the subcategory's attendance (UI confirms). */
  deleteSubcategory(id: string): Promise<void>;
  reorderSubcategories(categoryId: string, orderedIds: string[]): Promise<void>;

  // Attendance (one row per project + date + subcategory)
  getSheet(projectId: string, date: string): Promise<AttendanceSheet>;
  /** Upsert a headcount; quantity 0 deletes the row. */
  setQuantity(
    projectId: string,
    date: string,
    subcategoryId: string,
    quantity: number,
    notes?: string | null,
    contractorId?: string | null,
  ): Promise<AttendanceSheet>;
  copyPreviousDay(projectId: string, date: string): Promise<AttendanceSheet>;

  // Range views, reports, exports
  listAttendance(filters: AttendanceFilters): Promise<AttendanceRecordItem[]>;
  summary(filters: AttendanceFilters): Promise<LabourSummary>;
}
