import { isDemoMode } from "@/lib/env";
import { isNativeClient } from "@/lib/mobile/platform";
import type { ProcurementRepository } from "./repository";
import { demoProcurementRepository } from "./demo/demo-repository";
import { httpProcurementRepository } from "./http-repository";
import * as server from "./server/actions";
import type { PaymentFilters, POFilters, VendorFilters } from "./types";

const serverRepository: ProcurementRepository = {
  listVendors: server.listVendors,
  getVendor: server.getVendor,
  createVendor: server.createVendor,
  updateVendor: server.updateVendor,
  setVendorStatus: server.setVendorStatus,
  toggleVendorFavorite: server.toggleVendorFavorite,
  listMaterials: server.listMaterials,
  listMembers: server.listMembers,
  addVendorDocument: server.addVendorDocument,
  removeVendorDocument: server.removeVendorDocument,
  listMaterialCategories: server.listMaterialCategories,
  setMaterialCategories: server.setMaterialCategories,
  listPurchaseOrders: server.listPurchaseOrders,
  getPurchaseOrder: server.getPurchaseOrder,
  createPurchaseOrder: server.createPurchaseOrder,
  updatePurchaseOrder: server.updatePurchaseOrder,
  submitPurchaseOrder: server.submitPurchaseOrder,
  approvePurchaseOrder: server.approvePurchaseOrder,
  revisePurchaseOrder: server.revisePurchaseOrder,
  duplicatePurchaseOrder: server.duplicatePurchaseOrder,
  deletePurchaseOrder: server.deletePurchaseOrder,
  pendingApprovalCount: server.pendingApprovalCount,
  listPayments: server.listPayments,
  createPayment: server.createPayment,
  deletePayment: server.deletePayment,
  getProjectProcurement: server.getProjectProcurement,
  vendorAging: server.vendorAging,
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
export const procurementApi: ProcurementRepository = isDemoMode
  ? demoProcurementRepository
  : isNativeClient
    ? httpProcurementRepository
    : serverRepository;

export const procurementKeys = {
  all: ["procurement"] as const,
  vendors: (f?: VendorFilters) => ["procurement", "vendors", f ?? {}] as const,
  vendor: (id: string) => ["procurement", "vendor", id] as const,
  vendorAging: (id: string, projectId?: string) => ["procurement", "vendor-aging", id, projectId ?? null] as const,
  materials: ["procurement", "materials"] as const,
  members: ["procurement", "members"] as const,
  materialCategories: ["procurement", "material-categories"] as const,
  pos: (f?: POFilters) => ["procurement", "pos", f ?? {}] as const,
  po: (id: string) => ["procurement", "po", id] as const,
  payments: (f?: PaymentFilters) => ["procurement", "payments", f ?? {}] as const,
  projectProcurement: (projectId: string) => ["procurement", "project", projectId] as const,
  pendingApprovals: ["procurement", "pending-approvals"] as const,
};
