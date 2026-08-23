import { rpcMethod } from "@/lib/mobile/rpc";
import type { LaborRepository } from "./repository";

/**
 * Labour and attendance over the mobile RPC transport — the third
 * implementation of `LaborRepository`, beside `demo/` and the
 * Server-Action-backed one in `data.ts`.
 *
 * Pure transport. Every method forwards to the identically named entry in the
 * mobile RPC allowlist, which invokes the very same server function the web app
 * calls, under the caller's real resolved session. No query logic, no
 * authorization, no formatting — anything resembling business logic here would
 * be a second source of truth, which is exactly what this architecture exists
 * to avoid.
 *
 * Annotated as `LaborRepository`, so the compiler checks every key and
 * signature against the interface the UI already consumes. Method names match
 * the interface rather than being shortened, so repository, registry and call
 * site share one vocabulary.
 */
export const httpLaborRepository: LaborRepository = {
  listCategories: rpcMethod("labor", "listCategories"),
  createCategory: rpcMethod("labor", "createCategory"),
  updateCategory: rpcMethod("labor", "updateCategory"),
  deleteCategory: rpcMethod("labor", "deleteCategory"),
  reorderCategories: rpcMethod("labor", "reorderCategories"),
  createSubcategory: rpcMethod("labor", "createSubcategory"),
  updateSubcategory: rpcMethod("labor", "updateSubcategory"),
  deleteSubcategory: rpcMethod("labor", "deleteSubcategory"),
  reorderSubcategories: rpcMethod("labor", "reorderSubcategories"),
  forceDeletePreview: rpcMethod("labor", "forceDeletePreview"),
  forceDeleteCategory: rpcMethod("labor", "forceDeleteCategory"),
  forceDeleteSubcategory: rpcMethod("labor", "forceDeleteSubcategory"),
  getSheet: rpcMethod("labor", "getSheet"),
  setQuantity: rpcMethod("labor", "setQuantity"),
  copyPreviousDay: rpcMethod("labor", "copyPreviousDay"),
  listAttendance: rpcMethod("labor", "listAttendance"),
  summary: rpcMethod("labor", "summary"),
};
