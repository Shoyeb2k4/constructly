import { isDemoMode } from "@/lib/env";
import type { LaborRepository } from "./repository";
import { demoLaborRepository } from "./demo/demo-repository";
import * as server from "./server/actions";
import type { AttendanceFilters } from "./types";

const serverRepository: LaborRepository = {
  listCategories: server.listCategories,
  createCategory: server.createCategory,
  updateCategory: server.updateCategory,
  deleteCategory: server.deleteCategory,
  reorderCategories: server.reorderCategories,
  createSubcategory: server.createSubcategory,
  updateSubcategory: server.updateSubcategory,
  deleteSubcategory: server.deleteSubcategory,
  reorderSubcategories: server.reorderSubcategories,
  getSheet: server.getSheet,
  setQuantity: server.setQuantity,
  copyPreviousDay: server.copyPreviousDay,
  listAttendance: server.listAttendance,
  summary: server.summary,
};

export const laborApi: LaborRepository = isDemoMode ? demoLaborRepository : serverRepository;

export const laborKeys = {
  all: ["labor"] as const,
  categories: ["labor", "categories"] as const,
  sheet: (projectId: string, date: string) => ["labor", "sheet", projectId, date] as const,
  attendance: (f: AttendanceFilters) => ["labor", "attendance", f] as const,
  summary: (f: AttendanceFilters) => ["labor", "summary", f] as const,
};
