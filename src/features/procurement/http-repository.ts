import { rpcMethod } from "@/lib/mobile/rpc";
import type { ProcurementRepository } from "./repository";

/**
 * Vendors, purchase orders and payments over the mobile RPC transport — the third
 * implementation of `ProcurementRepository`, beside `demo/` and the
 * Server-Action-backed one in `data.ts`.
 *
 * Pure transport. Every method forwards to the identically named entry in the
 * mobile RPC allowlist, which invokes the very same server function the web app
 * calls, under the caller's real resolved session. No query logic, no
 * authorization, no formatting — anything resembling business logic here would
 * be a second source of truth, which is exactly what this architecture exists
 * to avoid.
 *
 * Annotated as `ProcurementRepository`, so the compiler checks every key and
 * signature against the interface the UI already consumes. Method names match
 * the interface rather than being shortened, so repository, registry and call
 * site share one vocabulary.
 */
export const httpProcurementRepository: ProcurementRepository = {
  listVendors: rpcMethod("procurement", "listVendors"),
  getVendor: rpcMethod("procurement", "getVendor"),
  createVendor: rpcMethod("procurement", "createVendor"),
  updateVendor: rpcMethod("procurement", "updateVendor"),
  setVendorStatus: rpcMethod("procurement", "setVendorStatus"),
  toggleVendorFavorite: rpcMethod("procurement", "toggleVendorFavorite"),
  listMaterials: rpcMethod("procurement", "listMaterials"),
  listMembers: rpcMethod("procurement", "listMembers"),
  addVendorDocument: rpcMethod("procurement", "addVendorDocument"),
  removeVendorDocument: rpcMethod("procurement", "removeVendorDocument"),
  listMaterialCategories: rpcMethod("procurement", "listMaterialCategories"),
  setMaterialCategories: rpcMethod("procurement", "setMaterialCategories"),
  listPurchaseOrders: rpcMethod("procurement", "listPurchaseOrders"),
  getPurchaseOrder: rpcMethod("procurement", "getPurchaseOrder"),
  createPurchaseOrder: rpcMethod("procurement", "createPurchaseOrder"),
  updatePurchaseOrder: rpcMethod("procurement", "updatePurchaseOrder"),
  submitPurchaseOrder: rpcMethod("procurement", "submitPurchaseOrder"),
  approvePurchaseOrder: rpcMethod("procurement", "approvePurchaseOrder"),
  revisePurchaseOrder: rpcMethod("procurement", "revisePurchaseOrder"),
  duplicatePurchaseOrder: rpcMethod("procurement", "duplicatePurchaseOrder"),
  deletePurchaseOrder: rpcMethod("procurement", "deletePurchaseOrder"),
  pendingApprovalCount: rpcMethod("procurement", "pendingApprovalCount"),
  listPayments: rpcMethod("procurement", "listPayments"),
  createPayment: rpcMethod("procurement", "createPayment"),
  deletePayment: rpcMethod("procurement", "deletePayment"),
  getProjectProcurement: rpcMethod("procurement", "getProjectProcurement"),
  vendorAging: rpcMethod("procurement", "vendorAging"),
};
