import { isDemoMode } from "@/lib/env";
import { isNativeClient } from "@/lib/mobile/platform";
import type { LaborRepository } from "./repository";
import { demoLaborRepository } from "./demo/demo-repository";
import { httpLaborRepository } from "./http-repository";
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
  forceDeletePreview: server.forceDeletePreview,
  forceDeleteCategory: server.forceDeleteCategory,
  forceDeleteSubcategory: server.forceDeleteSubcategory,
  getSheet: server.getSheet,
  setQuantity: server.setQuantity,
  copyPreviousDay: server.copyPreviousDay,
  listAttendance: server.listAttendance,
  summary: server.summary,
};

/**
 * Transport selection, in priority order:
 *   demo mode  → in-browser fixtures (unchanged)
 *   native app → HTTP RPC to the deployed Next backend (Capacitor; no Server
 *                Actions, because the bundle has no same-origin Next server)
 *   web        → Server Actions (unchanged — this is the production path)
 *
 * `isNativeClient` is a build-time constant, so each bundle keeps exactly one
 * of these branches and tree-shakes the rest: the web bundle never carries the
 * RPC client, and the mobile bundle never carries Prisma.
 */
export const laborApi: LaborRepository = isDemoMode
  ? demoLaborRepository
  : isNativeClient
    ? httpLaborRepository
    : serverRepository;

export const laborKeys = {
  all: ["labor"] as const,
  categories: ["labor", "categories"] as const,
  sheet: (projectId: string, date: string) => ["labor", "sheet", projectId, date] as const,
  attendance: (f: AttendanceFilters) => ["labor", "attendance", f] as const,
  summary: (f: AttendanceFilters) => ["labor", "summary", f] as const,
};
